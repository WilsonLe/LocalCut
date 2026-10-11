import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readProjectCatalogCache,
  writeProjectCatalogCache,
  projectCatalogCacheKey,
} from '../../src/workspace/project-catalog-cache';

const summary = {
  id: 'saved-project',
  name: 'My film',
  clipCount: 2,
  durationUs: 5000000,
};
let records: Map<string, string>;
beforeEach(() => {
  records = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => records.set(key, value),
    removeItem: (key: string) => records.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('display-only project catalog cache', () => {
  it('distinguishes no cache from a verified empty catalog and replaces removed rows', () => {
    expect(readProjectCatalogCache()).toBeNull();
    writeProjectCatalogCache([summary]);
    expect(readProjectCatalogCache()).toEqual([summary]);
    writeProjectCatalogCache([]);
    expect(readProjectCatalogCache()).toEqual([]);
  });
  it('reads only whitelisted summary fields, never an editable document', () => {
    records.set(
      projectCatalogCacheKey,
      JSON.stringify({
        version: 1,
        projects: [
          { ...summary, tracks: [{ clips: [] }], credentials: 'untrusted' },
        ],
      }),
    );
    expect(readProjectCatalogCache()).toEqual([summary]);
  });
  it('retains archive state but excludes covers and mutation authority', () => {
    writeProjectCatalogCache([
      {
        ...summary,
        archived: true,
        revision: 3,
        catalogRevision: 2,
        thumbnail: new Blob(['image']),
        thumbnailSource: { assetId: 'private-source', timeUs: 0 },
      },
    ]);
    expect(readProjectCatalogCache()).toEqual([{ ...summary, archived: true }]);
    expect(records.get(projectCatalogCacheKey)).not.toContain('private-source');
    expect(records.get(projectCatalogCacheKey)).not.toContain('thumbnail');
  });
  it('rejects malformed, unknown, ambiguous and oversized records', () => {
    for (const value of [
      'broken',
      'null',
      JSON.stringify({ version: 2, projects: [] }),
      JSON.stringify({ version: 1, projects: [summary, summary] }),
      JSON.stringify({
        version: 1,
        projects: [{ ...summary, durationUs: -1 }],
      }),
      JSON.stringify({
        version: 1,
        projects: [{ ...summary, clipCount: 0.5 }],
      }),
      JSON.stringify({ version: 1, projects: [{ ...summary, id: '' }] }),
      JSON.stringify({ version: 1, projects: Array(1001).fill(summary) }),
      ' '.repeat(512 * 1024 + 1),
    ]) {
      records.set(projectCatalogCacheKey, value);
      expect(readProjectCatalogCache()).toBeNull();
    }
  });
  it('discards oversized results rather than keeping an obsolete catalog', () => {
    writeProjectCatalogCache([summary]);
    writeProjectCatalogCache(Array(1001).fill(summary));
    expect(readProjectCatalogCache()).toBeNull();
  });
  it('tolerates blocked reads and writes without affecting project storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    });
    expect(readProjectCatalogCache()).toBeNull();
    expect(() => writeProjectCatalogCache([summary])).not.toThrow();
  });
});
