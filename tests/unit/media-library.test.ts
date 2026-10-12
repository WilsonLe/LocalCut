import { captureUpload } from '../../src/workspace/folder-upload';
import { describe, it, expect } from 'vitest';
import {
  libraryNameSchema,
  assignLegacyLibrary,
  availableLibraryName,
  libraryPath,
  libraryDescendants,
} from '../../src/core/media-library';
import type { LibraryEntry } from '../../src/core/media-library';
describe('media folder contracts', () => {
  it.each([
    '',
    '.',
    '..',
    '../escape',
    'folder/file',
    'folder\\file',
    'bad\0name',
  ])('rejects unsafe filename %j', (name) => {
    expect(libraryNameSchema.safeParse(name).success).toBe(false);
  });
  it('allocates collision names without overwriting, preserving extensions', () => {
    const entries: LibraryEntry[] = [
      { id: 'a', parentId: null, name: 'clip.mp4', kind: 'asset' },
      { id: 'b', parentId: null, name: 'clip (2).mp4', kind: 'folder' },
    ];
    expect(availableLibraryName(entries, null, 'clip.mp4')).toBe(
      'clip (3).mp4',
    );
    expect(availableLibraryName(entries, 'other', 'clip.mp4')).toBe('clip.mp4');
  });
  it('resolves actual hierarchy and retains descendants under a trashed ancestor', () => {
    const entries: LibraryEntry[] = [
      { id: 'f', parentId: null, name: 'Footage', kind: 'folder' },
      { id: 's', parentId: 'f', name: 'Day 1', kind: 'folder' },
      { id: 'a', parentId: 's', name: 'clip.mp4', kind: 'asset' },
    ];
    expect(libraryPath(entries, 'a')).toBe(
      'media-library/Footage/Day 1/clip.mp4',
    );
    expect(libraryDescendants(entries, 'f').map((entry) => entry.id)).toEqual([
      'f',
      's',
      'a',
    ]);
    entries[0]!.trashed = true;
    expect(libraryPath(entries, 'a')).toBe(
      'media-trash/f/Footage/Day 1/clip.mp4',
    );
  });
});

it('captures a dropped hierarchy synchronously and drains repeated reader batches including empty directories', async () => {
  let batch = 0;
  const empty = {
    name: 'Empty',
    isDirectory: true,
    createReader: () => ({
      readEntries: (done: (entries: unknown[]) => void) => done([]),
    }),
  };
  const file = {
    name: 'image.png',
    isDirectory: false,
    file: (done: (file: File) => void) =>
      done(new File(['bytes'], 'image.png')),
  };
  const root = {
    name: 'Upload',
    isDirectory: true,
    createReader: () => ({
      readEntries: (done: (entries: unknown[]) => void) =>
        done(batch++ === 0 ? [empty] : batch === 2 ? [file] : []),
    }),
  };
  const transfer = {
    items: [{ kind: 'file', webkitGetAsEntry: () => root }],
    files: [],
  } as unknown as DataTransfer;
  const read = captureUpload(transfer);
  const result = await read();
  expect(result.directories).toEqual(['Upload', 'Upload/Empty']);
  expect(result.files[0]!.webkitRelativePath).toBe('Upload/image.png');
  expect(await result.files[0]!.text()).toBe('bytes');
  expect(batch).toBe(3);
});

it('assigns legacy sources, their ancestry and Trash restore parents to existing project owners', () => {
  const entries: LibraryEntry[] = [
    { id: 'folder', parentId: null, name: 'Shots', kind: 'folder' },
    { id: 'a', parentId: 'folder', name: 'A.png', kind: 'asset', assetId: 'a' },
    {
      id: 'b',
      parentId: null,
      previousParentId: 'folder',
      name: 'B.png',
      kind: 'asset',
      assetId: 'b',
      trashed: true,
    },
    {
      id: 'unused',
      parentId: 'folder',
      name: 'Unused.png',
      kind: 'asset',
      assetId: 'unused',
    },
    { id: 'empty', parentId: null, name: 'Empty', kind: 'folder' },
  ];
  const owners = assignLegacyLibrary(
    entries,
    new Map([
      ['project-b', new Set(['b'])],
      ['project-a', new Set(['a'])],
    ]),
  );
  expect(owners['project-a']!.map((e) => e.id)).toEqual([
    'folder',
    'a',
    'unused',
    'empty',
  ]);
  expect(owners['project-b']!.map((e) => e.id)).toEqual(['folder', 'b']);
  expect(owners['project-b']![1]).toMatchObject({
    trashed: true,
    previousParentId: 'folder',
  });
});
