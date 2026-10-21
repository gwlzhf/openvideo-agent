// Connects the film to a product's source. The product repository is only read, never edited.
//   repoDir   where the product's node_modules live (defaults to plan.repo)
//   aliases   the product's import aliases, and framework modules mapped to the adapters in src/adapters/
//   external  bare imports to leave out of the bundle; they must resolve at runtime
//   loaders   extra esbuild loaders          define   extra compile-time constants
//   esbuild   extra esbuild options, e.g. to relax the product's TypeScript settings
export default {
  repoDir: null,
  aliases: {},
  // e.g. aliases: {'@': '/abs/product/src', 'next/image': new URL('./src/adapters/next-image.jsx', import.meta.url).pathname},
  external: [],
  loaders: {},
  define: {},
  esbuild: {},
  // e.g. esbuild: {tsconfigRaw: {compilerOptions: {verbatimModuleSyntax: false}}},
};
