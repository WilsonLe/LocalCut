import { describe, expect, it } from 'vitest';
import type { LibrarySnapshot } from '../../src/core/media-library';
import {
  libraryContext,
  resolveLibraryAssets,
} from '../../src/ai/library-context';

const library: LibrarySnapshot = {
  revision: 7,
  entries: [
    { id: 'trip', parentId: null, kind: 'folder', name: 'Sydney' },
    { id: 'nested', parentId: 'trip', kind: 'folder', name: 'Day 1' },
    {
      id: 'entry',
      parentId: 'nested',
      kind: 'asset',
      name: 'secret.mov',
      assetId: 'clip',
      sourceSignature: 'private signature',
    },
    {
      id: 'duplicate',
      parentId: 'trip',
      kind: 'asset',
      name: 'copy.mov',
      assetId: 'clip',
    },
    { id: 'empty', parentId: null, kind: 'folder', name: 'Failed upload' },
    {
      id: 'trash',
      parentId: null,
      kind: 'folder',
      name: 'Sydney',
      trashed: true,
    },
    { id: 'trash-nested', parentId: 'trash', kind: 'folder', name: 'Day 1' },
    {
      id: 'trash-entry',
      parentId: 'trash-nested',
      kind: 'asset',
      name: 'secret-trash.mov',
      assetId: 'trashed',
    },
    {
      id: 'other',
      parentId: null,
      kind: 'asset',
      name: 'unrelated.png',
      assetId: 'other',
    },
  ],
};
describe('truthful registered library discovery', () => {
  it('distinguishes nested withheld assets from empty registered folders without disclosing their IDs/names/signatures', () => {
    const result = libraryContext(library, {}, new Set(), {});
    expect(result).toMatchObject({
      source: 'registered_project_media',
      registeredContentsResolved: true,
      childrenResolved: false,
      registeredAssetCount: 2,
      authorizedAssetCount: 0,
      status: 'assets_withheld',
    });
    expect(result.entries.find((entry) => entry.id === 'trip')).toMatchObject({
      childCount: 2,
      assetCount: 1,
      childrenResolved: false,
    });
    expect(result.entries.find((entry) => entry.id === 'empty')).toMatchObject({
      assetCount: 0,
      childrenResolved: true,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /secret|signature|Sydney|"clip"|"trashed"\s*:\s*true/,
    );
    expect(
      libraryContext(library, { folderId: 'empty' }, new Set(), {}),
    ).toMatchObject({
      status: 'no_registered_media',
      childrenResolved: true,
      registeredAssetCount: 0,
    });
  });
  it('paginates authorized entries and distinguishes shallow inspection from recursive counts', () => {
    const allowed = new Set(['clip']);
    const first = libraryContext(
      library,
      { folderId: 'trip', limit: 1 },
      allowed,
      { includeAssetNames: true },
    );
    expect(first).toMatchObject({
      total: 3,
      nextOffset: 1,
      registeredAssetCount: 1,
      childrenResolved: true,
    });
    expect(first.entries[0]!.name).toBe('Day 1');
    const second = libraryContext(
      library,
      { folderId: 'trip', offset: 1, limit: 2 },
      allowed,
      {},
    );
    expect(second).toMatchObject({ total: 3, nextOffset: null });
    expect(second.entries).toHaveLength(2);
    const shallow = libraryContext(
      library,
      { folderId: 'trip', recursive: false },
      allowed,
      {},
    );
    expect(shallow.entries.map((entry) => entry.id)).toEqual([
      'nested',
      'duplicate',
    ]);
    expect(shallow.entries[0]).toMatchObject({
      assetCount: 1,
      childrenResolved: true,
    });
  });
  it('resolves only the named container, deduplicates assets and excludes inherited Trash', () => {
    expect(
      resolveLibraryAssets(library, { folderId: 'trip' }, new Set(), true),
    ).toMatchObject({
      revision: 7,
      assetIds: ['clip'],
      assetCount: 1,
      status: 'resolved',
      indexingSubmitted: false,
    });
    expect(
      resolveLibraryAssets(library, { folderId: null }, new Set(), true)
        .assetIds,
    ).toEqual(['clip', 'other']);
    expect(
      resolveLibraryAssets(library, { folderId: 'trip' }, new Set(), false),
    ).toMatchObject({
      assetIds: [],
      withheldAssetCount: 1,
      childrenResolved: false,
      status: 'assets_withheld',
    });
    expect(() =>
      resolveLibraryAssets(
        library,
        { folderId: 'trash-nested' },
        new Set(['trashed']),
        true,
      ),
    ).toThrow('Trash');
    expect(() =>
      resolveLibraryAssets(
        library,
        { folderId: 'foreign-project' },
        new Set(),
        true,
      ),
    ).toThrow('not in this project');
    const trash = libraryContext(
      library,
      { folderId: 'trash', includeTrashed: true },
      new Set(['trashed']),
      {},
    );
    expect(trash.entries.every((entry) => entry.trashed)).toBe(true);
    expect(trash.registeredAssetCount).toBe(1);
  });
});
