import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
};
const port = Number(process.env.LOCALCUT_TEST_PORT ?? 4178);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') {
      res.end('ok');
      return;
    }
    let root = 'dist-root',
      path = url.pathname;
    if (path.startsWith('/LocalCut/')) {
      root = 'dist';
      path = path.slice('/LocalCut'.length);
    } else if (path.startsWith('/fixtures/')) {
      root = 'tests/fixtures';
      path = path.slice('/fixtures'.length);
    }
    const base = resolve(root),
      file = resolve(base, '.' + decodeURIComponent(path));
    if (file !== base && !file.startsWith(base + '/')) {
      res.writeHead(403);
      res.end();
      return;
    }
    let target = file;
    if ((await stat(target)).isDirectory())
      target = resolve(target, 'index.html');
    const data = await readFile(target);
    res.setHeader(
      'Content-Type',
      types[extname(target)] ?? 'application/octet-stream',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log(`LocalCut test server on ${port}`),
);
