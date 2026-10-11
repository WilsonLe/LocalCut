import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

export const STORYBOARD_ASSETS = 'storyboard/excalidraw-0.18.1/';
/** The pinned vendor adds a CDN fallback even with a local asset path. */
export function localizeStoryboardFontFallback(code: string, base = '/') {
  const fallback =
    /`https:\/\/esm\.sh\/\$\{([\w.]+)\.PKG_NAME\s*\?\s*`\$\{\1\.PKG_NAME\}@\$\{\1\.PKG_VERSION\}`\s*:\s*"@excalidraw\/excalidraw"\}\/dist\/prod\/`/g;
  const matches = [...code.matchAll(fallback)];
  if (matches.length !== 1)
    throw new Error(
      'Pinned Excalidraw font fallback changed; inspect before building',
    );
  return code.replace(
    fallback,
    `new URL(${JSON.stringify(base + STORYBOARD_ASSETS)}, window.location.origin).href`,
  );
}
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
  let base = '/';
  return {
    name: 'localcut-storyboard-assets',
    enforce: 'pre',
    config() {
      // Let the same vendor adaptation run in development and production.
      return { optimizeDeps: { exclude: ['@excalidraw/excalidraw'] } };
    },
    configResolved(config) {
      base = config.base;
    },
    transform(code, id) {
      if (
        id.includes('/@excalidraw/excalidraw/dist/') &&
        code.includes('"ASSETS_FALLBACK_URL"')
      )
        return { code: localizeStoryboardFontFallback(code, base), map: null };
    },
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
