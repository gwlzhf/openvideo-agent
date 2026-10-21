// Static file server for dist/, bound to loopback. A request that resolves outside dist/ (through .. or a symlink)
// is refused with 403; a missing file gets 404.
import {createReadStream} from 'node:fs';
import {realpath, stat} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const MIME_BY_EXTENSION = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.wav', 'audio/wav'],
  ['.mp3', 'audio/mpeg'],
]);
const mimeFor = file => MIME_BY_EXTENSION.get(path.extname(file).toLowerCase()) ?? 'application/octet-stream';
const isInside = (root, target) => {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

function respond(res, status, body) {
  res.writeHead(status, {'Content-Type': 'text/plain; charset=utf-8'});
  res.end(body);
}

export async function serve(port = 0) {
  const root = await realpath('dist');
  const server = http.createServer(async (req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = urlPath.replace(/^\/+/, '') || 'index.html';
    try {
      const target = await realpath(path.resolve(root, relative));
      if (!isInside(root, target)) return respond(res, 403, 'forbidden');
      const info = await stat(target);
      if (!info.isFile()) return respond(res, 404, 'not found');
      res.writeHead(200, {'Content-Type': mimeFor(target), 'Content-Length': info.size});
      createReadStream(target).pipe(res);
    } catch {
      respond(res, 404, 'not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  return {server, url: `http://127.0.0.1:${server.address().port}`};
}
