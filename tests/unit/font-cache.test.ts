import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('revalidates a corrupt font once and never publishes unchecked bytes', async () => {
  vi.stubGlobal('__LOCALCUT_FONT_REVISION__', 'a'.repeat(64));
  const valid = new TextEncoder().encode('verified font');
  const sha256 = Buffer.from(
    await crypto.subtle.digest('SHA-256', valid),
  ).toString('hex');
  const manifest = {
    family: 'LocalCut inter',
    files: [{ file: 'latin.woff2', unicodeRange: 'U+0000-00FF', sha256 }],
  };
  const requests: { url: string; cache?: RequestCache }[] = [];
  let corrupt = true;
  vi.stubGlobal('fetch', async (url: URL, options: RequestInit) => {
    requests.push({ url: url.href, cache: options.cache });
    if (url.pathname.endsWith('manifest.json'))
      return new Response(JSON.stringify(manifest));
    return new Response(
      !corrupt && options.cache === 'reload' ? valid : 'corrupt',
    );
  });
  const add = vi.fn();
  vi.stubGlobal('document', { fonts: { add } });
  vi.stubGlobal(
    'FontFace',
    class {
      async load() {
        return this;
      }
    },
  );
  const { ensureTextFont } = await import('../../src/media/fonts');
  await expect(
    ensureTextFont({ text: 'Hello', fontFamily: 'font-inter' }),
  ).rejects.toMatchObject({ code: 'MISSING_ASSET' });
  expect(add).not.toHaveBeenCalled();
  expect(requests.map((r) => r.cache)).toEqual([
    'default',
    'default',
    'reload',
  ]);
  corrupt = false;
  await ensureTextFont({ text: 'Hello', fontFamily: 'font-inter' });
  expect(add).toHaveBeenCalledTimes(1);
  expect(requests.slice(-2).map((r) => r.cache)).toEqual(['default', 'reload']);
  expect(
    requests.every((r) => r.url.includes(`/fonts/${'a'.repeat(64)}/inter/`)),
  ).toBe(true);
});
