import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
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
export function createTestServer(directory = process.cwd()) {
  return createServer(async (req, res) => {
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
      const base = resolve(directory, root),
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
      // Only content-addressed production URLs are immutable. Entry shims,
      // HTML, manifests and fixtures revalidate against their current bytes.
      const immutable =
        /\/assets\/[^/]+-[\w-]{8,}\.(?:js|css|woff2)$/.test(path) ||
        /\/fonts\/[a-f0-9]{64}\//.test(path);
      const etag = '"' + createHash('sha256').update(data).digest('hex') + '"';
      res.setHeader('ETag', etag);
      res.setHeader(
        'Cache-Control',
        immutable
          ? 'private, max-age=31536000, immutable'
          : 'private, no-cache',
      );
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304);
        res.end();
        return;
      }
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const port = Number(process.env.LOCALCUT_TEST_PORT ?? 4178);
  const server = createTestServer();
  server.listen(port, '127.0.0.1', () =>
    console.log(`LocalCut test server on ${port}`),
  );
}
