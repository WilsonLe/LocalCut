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

it('prepares every selected-family subset and shares verified faces with authored text', async () => {
  const bytes = new TextEncoder().encode('verified font');
  const sha256 = Buffer.from(
    await crypto.subtle.digest('SHA-256', bytes),
  ).toString('hex');
  const manifest = {
    family: 'LocalCut inter',
    files: [
      { file: 'latin.woff2', unicodeRange: 'U+0000-00FF', sha256 },
      { file: 'vietnamese.woff2', unicodeRange: 'U+1E00-1EFF', sha256 },
    ],
  };
  const requests: string[] = [];
  vi.stubGlobal('fetch', async (url: URL) => {
    requests.push(url.pathname);
    return new Response(
      url.pathname.endsWith('manifest.json') ? JSON.stringify(manifest) : bytes,
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
  const { ensureTextFont, ensureFontFamily } =
    await import('../../src/media/fonts');
  await ensureTextFont({ text: 'Hello', fontFamily: 'font-inter' });
  expect(add).toHaveBeenCalledTimes(1);
  await ensureFontFamily('font-inter');
  expect(add).toHaveBeenCalledTimes(2);
  expect(requests.filter((url) => url.endsWith('.woff2'))).toHaveLength(2);
  await ensureTextFont({ text: 'Tiếng Việt', fontFamily: 'font-inter' });
  await ensureFontFamily('font-inter');
  await ensureFontFamily('sans');
  expect(requests).toHaveLength(3);
  expect(add).toHaveBeenCalledTimes(2);
});
