import { afterEach, expect, it, vi } from 'vitest';
import {
  defaultAppearance,
  getAppearance,
  randomAppearance,
} from '../../src/workspace/appearance';
import {
  importWorkspaceSettings,
  validateWorkspaceSettings,
  workspaceSettings,
} from '../../src/workspace/workspace-settings';

afterEach(() => vi.unstubAllGlobals());
it('imports legacy appearance backups with default size and retains every existing choice', () => {
  const { interfaceSize: _size, ...legacy } = defaultAppearance;
  void _size;
  const settings = { appearance: { ...legacy, theme: 'blue' } };
  expect(() => validateWorkspaceSettings(settings)).not.toThrow();
  const records = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    setItem: (key: string, value: string) => records.set(key, value),
  });
  vi.stubGlobal('document', {
    documentElement: {
      classList: { toggle: vi.fn() },
      style: { setProperty: vi.fn() },
      dataset: {},
    },
  });
  expect(importWorkspaceSettings(settings, true, false)).toEqual([]);
  expect(getAppearance().preferences).toEqual({
    ...defaultAppearance,
    theme: 'blue',
  });
  for (const interfaceSize of ['small', 'large'] as const) {
    expect(
      importWorkspaceSettings(
        { appearance: { ...defaultAppearance, interfaceSize } },
        true,
        false,
      ),
    ).toEqual([]);
    expect(workspaceSettings().appearance?.interfaceSize).toBe(interfaceSize);
    expect(randomAppearance().interfaceSize).toBe(interfaceSize);
  }
});
it('rejects invalid or unknown size fields instead of applying arbitrary CSS from backups', () => {
  for (const interfaceSize of ['75%', 'huge', false, 0.75])
    expect(() =>
      validateWorkspaceSettings({
        appearance: { ...defaultAppearance, interfaceSize },
      }),
    ).toThrow('Invalid appearance');
  expect(() =>
    validateWorkspaceSettings({
      appearance: { ...defaultAppearance, css: 'arbitrary' },
    }),
  ).toThrow('Invalid appearance');
});
