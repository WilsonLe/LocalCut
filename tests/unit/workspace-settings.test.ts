import { afterEach, expect, it, vi } from 'vitest';
import { TEXT_FONTS } from '../../src/core/text-library';
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

import {
  defaultWorkspacePreferences,
  getWorkspacePreferences,
} from '../../src/workspace/preferences';

afterEach(() => vi.unstubAllGlobals());
it('imports legacy provider settings through the single OpenRouter migration without credentials or backups', () => {
  const records = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => records.set(key, value),
  });
  const aiProviders = JSON.stringify({
    profiles: [
      {
        id: 'chatgpt',
        name: 'ChatGPT',
        kind: 'chatgpt',
        accessToken: 'SECRET',
      },
      { id: 'openrouter', name: 'OpenRouter', kind: 'openrouter' },
    ],
    routes: {
      llm: [
        { providerId: 'openrouter', model: 'selected' },
        { providerId: 'chatgpt', model: 'backup' },
      ],
      tts: [{ providerId: 'openrouter', model: 'speech', voice: 'Kore' }],
      stt: [{ providerId: 'local', model: 'whisper' }],
    },
  });
  const workspace = { ...defaultWorkspacePreferences, aiProviders };
  expect(importWorkspaceSettings({ workspace }, false, true)).toEqual([]);
  const stored = records.get('localcut.workspace-preferences.v1')!;
  expect(stored).not.toMatch(/SECRET|chatgpt|backup/);
  expect(JSON.parse(JSON.parse(stored).preferences.aiProviders)).toEqual({
    profiles: [{ id: 'openrouter', name: 'OpenRouter', kind: 'openrouter' }],
    routes: {
      llm: [{ providerId: 'openrouter', model: 'selected' }],
      tts: [{ providerId: 'openrouter', model: 'speech', voice: 'Kore' }],
      stt: [{ providerId: 'local', model: 'whisper' }],
    },
  });
  expect(workspace.aiProviders).toBe(aiProviders);
  expect(() =>
    validateWorkspaceSettings({ workspace: { ...workspace, chatWidth: -1 } }),
  ).toThrow('Invalid workspace settings');
});
it('accepts the complete text font catalog in appearance backups and rejects unknown faces', () => {
  for (const font of TEXT_FONTS) {
    expect(() =>
      validateWorkspaceSettings({
        appearance: { ...defaultAppearance, font: font.id, heading: font.id },
      }),
    ).not.toThrow();
  }
  for (const font of [
    'font-not-in-the-catalog',
    'url(https://example.com/font)',
    'inherit',
  ]) {
    expect(() =>
      validateWorkspaceSettings({ appearance: { ...defaultAppearance, font } }),
    ).toThrow('Invalid appearance');
  }
});
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

it('imports legacy snapping defaults and retains explicit off in portable settings', () => {
  const { timelineSnapping: _snapping, ...legacy } =
    defaultWorkspacePreferences;
  void _snapping;
  const records = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => records.set(key, value),
  });
  expect(
    importWorkspaceSettings(
      { workspace: { ...legacy, timelineSnapping: false } },
      false,
      true,
    ),
  ).toEqual([]);
  expect(getWorkspacePreferences().preferences.timelineSnapping).toBe(false);
  expect(workspaceSettings().workspace?.timelineSnapping).toBe(false);
  expect(importWorkspaceSettings({ workspace: legacy }, false, true)).toEqual(
    [],
  );
  expect(getWorkspacePreferences().preferences.timelineSnapping).toBe(true);
  for (const timelineSnapping of ['false', 0, null as unknown as boolean])
    expect(() =>
      validateWorkspaceSettings({ workspace: { ...legacy, timelineSnapping } }),
    ).toThrow('Invalid workspace settings');
});
