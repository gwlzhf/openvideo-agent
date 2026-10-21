// Bundles the film into dist/: client.js (the film, React, GSAP and the product components), index.html with the
// stylesheets inlined, and copies of public/ and assets/. Also writes evidence/component-imports.json, the esbuild
// metafile listing every source file that went into the bundle.
import {build} from 'esbuild';
import {existsSync} from 'node:fs';
import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import config from './product-config.mjs';

// Extensions that are copied into dist/ and referenced by URL rather than inlined.
const FILE_LOADED_EXTENSIONS = ['.png', '.jpg', '.svg', '.woff', '.woff2', '.ttf'];

// The product's node_modules are searched first, then the film's own.
function moduleSearchPaths(plan) {
  const productDir = config.repoDir || plan.repo;
  const roots = [productDir, '.'];
  return roots.filter(Boolean).map(dir => path.resolve(dir, 'node_modules'));
}

function bundleOptions(plan) {
  return {
    entryPoints: ['src/mount.jsx'],
    outfile: 'dist/client.js',
    bundle: true,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    minify: true,
    legalComments: 'none',
    metafile: true,
    logLevel: 'error',
    nodePaths: moduleSearchPaths(plan),
    alias: {
      ...config.aliases,
      react: path.resolve('node_modules/react'),
      'react-dom': path.resolve('node_modules/react-dom'),
    },
    define: {'process.env.NODE_ENV': '"production"', 'process.env': '{}', ...config.define},
    external: config.external,
    loader: {
      '.js': 'jsx',
      '.css': 'css',
      ...Object.fromEntries(FILE_LOADED_EXTENSIONS.map(ext => [ext, 'file'])),
      ...config.loaders,
    },
    assetNames: 'assets/[name]-[hash]',
    ...config.esbuild,
  };
}

// Order matters: the film's own styles come last so they win over everything before them.
const STYLESHEETS = ['assets/fallback/tokens.css', 'src/product.css', 'dist/client.css', 'src/film.css'];

function documentFor(plan, css) {
  const lang = plan.lang ?? 'zh-CN';
  const title = plan.product ?? 'film';
  return [
    '<!doctype html>',
    `<html lang="${lang}">`,
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${title}</title>`,
    `<style>${css}</style>`,
    '<body><div id="film-root"></div><script src="client.js"></script></body>',
    '</html>',
  ].join('');
}

const plan = JSON.parse(await readFile('plan.json', 'utf8'));
await rm('dist', {recursive: true, force: true});
await mkdir('dist', {recursive: true});

const result = await build(bundleOptions(plan));
await mkdir('evidence', {recursive: true});
await writeFile('evidence/component-imports.json', JSON.stringify(result.metafile, null, 2));

const bundled = await readFile('dist/client.js', 'utf8');
if (!plan.demo && bundled.includes('data-film-placeholder')) {
  throw new Error('placeholder markup is still in the bundle; connect the real product components first');
}

const css = (await Promise.all(STYLESHEETS.filter(existsSync).map(file => readFile(file, 'utf8')))).join('\n');
await rm('dist/client.css', {force: true});
await writeFile('dist/index.html', documentFor(plan, css));

// static folders are copied as they are: public/ to the root, assets/ under dist/assets
for (const [from, to] of [['public', 'dist'], ['assets', 'dist/assets']]) {
  if (existsSync(from)) await cp(from, to, {recursive: true});
}

console.log('Built dist/index.html; imports recorded in evidence/component-imports.json');
