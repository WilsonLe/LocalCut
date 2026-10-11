import { describe, expect, it } from 'vitest';
import {
  defaultWorkspacePreferences,
  parseWorkspacePreferences,
} from '../../src/workspace/preferences';

const record = (preferences: unknown, version = 1) =>
  JSON.stringify({ version, preferences });

describe('local workspace preference validation', () => {
  it('defaults malformed records and unsupported versions', () => {
    for (const raw of [
      null,
      '{',
      'null',
      '[]',
      record([], 1),
      record({ chatWidth: 400 }, 2),
    ])
      expect(parseWorkspacePreferences(raw)).toEqual(
        defaultWorkspacePreferences,
      );
  });
  it('defaults snapping on for legacy/invalid preferences and retains an explicit off choice', () => {
    expect(parseWorkspacePreferences(record({})).timelineSnapping).toBe(true);
    expect(
      parseWorkspacePreferences(record({ timelineSnapping: false }))
        .timelineSnapping,
    ).toBe(false);
    for (const timelineSnapping of ['false', 0, null])
      expect(
        parseWorkspacePreferences(record({ timelineSnapping }))
          .timelineSnapping,
      ).toBe(true);
  });
  it('normalizes bounds and rejects invalid types while retaining valid fields', () => {
    expect(
      parseWorkspacePreferences(
        record({
          chatWidth: 10000,
          chatCollapsed: true,
          mediaOpen: 'true',
          exportFormat: 'webm',
          aiModel: 'vendor/model:free',
          privacy: { includeText: true },
          apiKey: 'never-save',
        }),
      ),
    ).toEqual({
      ...defaultWorkspacePreferences,
      chatWidth: 560,
      chatCollapsed: true,
      exportFormat: 'webm',
      aiModel: 'vendor/model:free',
    });
    expect(parseWorkspacePreferences(record({ chatWidth: -1 })).chatWidth).toBe(
      280,
    );
    expect(
      parseWorkspacePreferences(record({ chatWidth: 401.6 })).chatWidth,
    ).toBe(402);
    for (const chatWidth of ['400', null, true])
      expect(parseWorkspacePreferences(record({ chatWidth })).chatWidth).toBe(
        320,
      );
  });
  it('retains bounded media and timeline sizes with legacy defaults', () => {
    expect(
      parseWorkspacePreferences(
        record({ mediaWidth: 10000, timelineHeight: -1 }),
      ),
    ).toMatchObject({ mediaWidth: 560, timelineHeight: 210 });
    expect(
      parseWorkspacePreferences(
        record({ mediaWidth: '300', timelineHeight: null }),
      ),
    ).toMatchObject({ mediaWidth: 300, timelineHeight: 260 });
    expect(
      parseWorkspacePreferences(
        record({ mediaWidth: 342.5, timelineHeight: 315.6 }),
      ),
    ).toMatchObject({ mediaWidth: 343, timelineHeight: 316 });
  });
  it('retains only a bounded model identifier, never arbitrary text or routing defaults', () => {
    for (const aiModel of [
      '',
      'vendor/model:free',
      '~deepseek/deepseek-pro-latest',
      'a'.repeat(256),
      `~${'a'.repeat(256)}`,
    ])
      expect(parseWorkspacePreferences(record({ aiModel })).aiModel).toBe(
        aiModel,
      );
    for (const aiModel of [
      'openrouter/auto',
      'model with spaces',
      '<script>',
      'https://vendor/model',
      '~',
      '~~vendor/model',
      'a'.repeat(257),
      `~${'a'.repeat(257)}`,
      12,
    ])
      expect(parseWorkspacePreferences(record({ aiModel })).aiModel).toBe('');
  });
});
