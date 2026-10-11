import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

export const STORYBOARD_ASSETS = 'storyboard/excalidraw-0.18.1/';
export function storyboardAssets() {
  const root = join(
    dirname(createRequire(import.meta.url).resolve('@excalidraw/excalidraw')),
    'fonts',
  );
  const files = new Map<string, Buffer>();
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.woff2'))
        files.set('fonts/' + relative(root, full), readFileSync(full));
    }
  };
  walk(root);
  return files;
}
/** Pin all drawing fonts to the installed package and serve only same-origin assets. */
export function localStoryboardAssets(): Plugin {
  const files = storyboardAssets();
  return {
    name: 'localcut-storyboard-assets',
    generateBundle() {
      const hashes: Record<string, string> = {};
      for (const [name, source] of files) {
        this.emitFile({
          type: 'asset',
          fileName: STORYBOARD_ASSETS + name,
          source,
        });
        hashes[name] = createHash('sha256').update(source).digest('hex');
      }
      this.emitFile({
        type: 'asset',
        fileName: STORYBOARD_ASSETS + 'manifest.json',
        source: JSON.stringify(hashes),
      });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? '').split('?')[0]!;
        const start = path.indexOf('/' + STORYBOARD_ASSETS);
        const file =
          start < 0
            ? undefined
            : files.get(path.slice(start + STORYBOARD_ASSETS.length + 1));
        if (!file) return next();
        response.setHeader('Content-Type', 'font/woff2');
        response.end(file);
      });
    },
  };
}
