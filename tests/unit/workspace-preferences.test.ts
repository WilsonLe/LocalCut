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
  it('drops retired AI and chat settings while retaining local editor preferences', () => {
    expect(
      parseWorkspacePreferences(
        record({
          chatWidth: 400,
          chatCollapsed: true,
          aiModel: 'old-model',
          aiProviders: '{"key":"never-save"}',
          apiKey: 'never-save',
          mediaOpen: true,
          exportFormat: 'webm',
        }),
      ),
    ).toEqual({
      ...defaultWorkspacePreferences,
      mediaOpen: true,
      exportFormat: 'webm',
    });
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
});
