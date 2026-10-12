import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('../../src/workspace/appearance-fonts');
  vi.resetModules();
});

async function setup(
  raw: string | null = null,
  prepare = vi.fn(async () => {}),
) {
  vi.resetModules();
  const catalogRead = vi.fn();
  vi.doMock('../../src/workspace/appearance-fonts', () => {
    catalogRead();
    return {
      appearanceFontChoices: [
        { id: 'sans', family: 'system-ui, sans-serif' },
        { id: 'font-inter', family: '"LocalCut inter", sans-serif' },
        { id: 'font-zilla-slab', family: '"LocalCut zilla-slab", serif' },
      ],
      prepareAppearanceFonts: prepare,
    };
  });
  const css = new Map<string, string>();
  vi.stubGlobal('document', {
    documentElement: {
      classList: { toggle: vi.fn() },
      dataset: {},
      style: {
        setProperty: (key: string, value: string) => css.set(key, value),
      },
    },
  });
  vi.stubGlobal('localStorage', {
    getItem: () => raw,
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: false, addEventListener: vi.fn() }),
    addEventListener: vi.fn(),
  });
  const appearance = await import('../../src/workspace/appearance');
  return { appearance, css, catalogRead, prepare };
}

it('keeps default appearance startup free of the font catalog and font preparation', async () => {
  const { appearance, catalogRead, prepare } = await setup();
  appearance.initializeAppearance();
  expect(appearance.getAppearance().preferences.font).toBe('sans');
  expect(catalogRead).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
});

it('restores a validated bundled face but lets a newer preference supersede pending restoration', async () => {
  const raw = JSON.stringify({
    version: 1,
    preferences: { font: 'font-inter' },
  });
  const restored = await setup(raw);
  restored.appearance.initializeAppearance();
  await vi.waitFor(() =>
    expect(restored.appearance.getAppearance().preferences.font).toBe(
      'font-inter',
    ),
  );
  expect(restored.css.get('--appearance-font-sans')).toContain(
    'LocalCut inter',
  );
  await vi.waitFor(() =>
    expect(restored.appearance.getAppearance().fontLoading).toBe(false),
  );

  const newer = await setup(raw);
  newer.appearance.initializeAppearance();
  newer.appearance.saveAppearance(newer.appearance.defaultAppearance);
  await newer.appearance.loadAppearanceFonts();
  expect(newer.appearance.getAppearance().preferences.font).toBe('sans');
  expect(newer.css.get('--appearance-font-sans')).toBe('system-ui, sans-serif');
});

it('keeps the latest selection and status when an earlier font preparation fails', async () => {
  let rejectEarlier!: (error: Error) => void;
  let resolveLatest!: () => void;
  const prepare = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejectEarlier = reject;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveLatest = resolve;
        }),
    );
  const { appearance, css } = await setup(null, prepare);
  await appearance.loadAppearanceFonts();
  appearance.saveAppearance({
    ...appearance.defaultAppearance,
    font: 'font-inter',
  });
  await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
  appearance.saveAppearance({
    ...appearance.defaultAppearance,
    font: 'font-zilla-slab',
  });
  await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
  rejectEarlier(new Error('old font failure'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(appearance.getAppearance()).toMatchObject({
    fontLoading: true,
    fontError: '',
    preferences: { font: 'font-zilla-slab' },
  });
  resolveLatest();
  await vi.waitFor(() =>
    expect(appearance.getAppearance().fontLoading).toBe(false),
  );
  expect(css.get('--appearance-font-sans')).toContain('LocalCut zilla-slab');
});

it('applies a selected bundled family after lazy preparation from a portable settings import', async () => {
  const { appearance, css } = await setup();
  appearance.saveAppearance({
    ...appearance.defaultAppearance,
    font: 'font-inter',
  });
  await vi.waitFor(() =>
    expect(appearance.getAppearance().fontLoading).toBe(false),
  );
  expect(css.get('--appearance-font-sans')).toContain('LocalCut inter');
});

it('retains a failed selected face and retries without changing saved preferences', async () => {
  const prepare = vi
    .fn()
    .mockRejectedValueOnce(new Error('font unavailable'))
    .mockResolvedValueOnce(undefined);
  const { appearance } = await setup(null, prepare);
  await appearance.loadAppearanceFonts();
  appearance.saveAppearance({
    ...appearance.defaultAppearance,
    font: 'font-inter',
  });
  await vi.waitFor(() =>
    expect(appearance.getAppearance().fontError).toBe('font unavailable'),
  );
  expect(appearance.getAppearance().preferences.font).toBe('font-inter');
  appearance.retryAppearanceFonts();
  await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(appearance.getAppearance()).toMatchObject({
      fontLoading: false,
      fontError: '',
      preferences: { font: 'font-inter' },
    }),
  );
});
