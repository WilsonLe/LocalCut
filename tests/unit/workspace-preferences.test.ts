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
