import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  forgetRecentProject,
  readRecentProject,
  recentProjectKey,
  rememberProject,
} from '../../src/workspace/recent-project';

afterEach(() => vi.unstubAllGlobals());
describe('recent project navigation', () => {
  it('remembers successful selections and only forgets the matching missing project', () => {
    const records = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => records.get(key) ?? null,
      setItem: (key: string, value: string) => records.set(key, value),
      removeItem: (key: string) => records.delete(key),
    });
    expect(readRecentProject()).toBeUndefined();
    rememberProject('first');
    expect(readRecentProject()).toBe('first');
    rememberProject('second');
    forgetRecentProject('first');
    expect(readRecentProject()).toBe('second');
    expect(JSON.parse(records.get(recentProjectKey)!)).toEqual({
      version: 1,
      projectId: 'second',
    });
    forgetRecentProject('second');
    expect(readRecentProject()).toBeUndefined();
  });
  it('rejects malformed, unknown and oversized navigation records', () => {
    for (const text of [
      'null',
      '{',
      '{}',
      JSON.stringify({ version: 2, projectId: 'x' }),
      JSON.stringify({ version: 1, projectId: '' }),
      JSON.stringify({ version: 1, projectId: 4 }),
      JSON.stringify({ version: 1, projectId: 'x'.repeat(201) }),
      ' '.repeat(1501),
    ]) {
      vi.stubGlobal('localStorage', { getItem: () => text });
      expect(readRecentProject()).toBeUndefined();
    }
  });
  it('leaves editing usable when browser UI storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    });
    expect(readRecentProject()).toBeUndefined();
    expect(() => rememberProject('first')).not.toThrow();
    expect(() => forgetRecentProject('first')).not.toThrow();
  });
});
