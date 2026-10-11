import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { localizeStoryboardFontFallback } from '../../scripts/storyboard-assets.ts';

test('pinned development and production drawing fonts have no CDN fallback', () => {
  const prod = dirname(
    createRequire(import.meta.url).resolve('@excalidraw/excalidraw'),
  );
  for (const mode of ['dev', 'prod']) {
    const root = join(prod, '..', mode);
    const vendor = readdirSync(root)
      .filter((name) => name.endsWith('.js'))
      .map((name) => readFileSync(join(root, name), 'utf8'))
      .filter((code) => code.includes('"ASSETS_FALLBACK_URL"'));
    assert.equal(vendor.length, 1);
    for (const base of ['/', '/LocalCut/']) {
      const adapted = localizeStoryboardFontFallback(vendor[0], base);
      assert.ok(
        adapted.includes(
          `new URL("${base}storyboard/excalidraw-0.18.1/", window.location.origin).href`,
        ),
      );
      assert.ok(!adapted.includes('https://esm.sh/'));
    }
  }
  assert.throws(() => localizeStoryboardFontFallback('changed vendor'));
});
