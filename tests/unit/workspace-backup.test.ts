import { afterEach, describe, expect, it, vi } from 'vitest';
import * as media from '../../src/media/assets';
import { zipSync, strToU8 } from 'fflate';
import { newProject, validateProject } from '../../src/core/model';
import {
  MAX_ARCHIVE_BYTES,
  remapWorkspaceBackup,
  selectWorkspaceBackup,
  validateWorkspaceBackup,
  validateWorkspaceSelection,
} from '../../src/storage/workspace-backup';
import {
  readWorkspaceArchive,
  restoreWorkspace,
} from '../../src/storage/workspace-transfer';
import type { WorkspaceBackup } from '../../src/storage/workspace-backup';
import type { Store } from '../../src/storage/store';
afterEach(() => vi.restoreAllMocks());
const blank = (): WorkspaceBackup => ({
  format: 'localcut-workspace',
  workspaceVersion: 1,
  createdAt: 1,
  projects: [
    { project: newProject('one'), versions: [] },
    { project: newProject('two'), versions: [] },
  ],
  assets: [],
  transcripts: [],
  files: [],
});
const blob = (bytes: Uint8Array) =>
  new Blob([bytes.slice().buffer as ArrayBuffer]);
describe('workspace backup validation and selection', () => {
  it('selects copies without mutating the source or replacing identities', () => {
    const b = blank();
    const original = structuredClone(b);
    const selected = selectWorkspaceBackup(b, {
      projectIds: [b.projects[1]!.project.id],
      includeVersions: false,
      assetIds: [],
    });
    const mapped = remapWorkspaceBackup(selected, new Set());
    expect(mapped.records).toHaveLength(1);
    expect(mapped.records[0]!.project.name).toBe('two');
    expect(mapped.records[0]!.project.id).not.toBe(b.projects[1]!.project.id);
    expect(mapped.records[0]!.project.revision).toBe(0);
    expect(b).toEqual(original);
  });
  it.each([
    'version',
    'duplicate',
    'unknown',
    'versionOwner',
    'restoredFrom',
    'bounds',
  ])('rejects malformed %s before persistence', (kind) => {
    const b = blank();
    if (kind === 'version') b.workspaceVersion = 2 as 1;
    if (kind === 'duplicate') b.projects.push(b.projects[0]!);
    if (kind === 'unknown') Object.assign(b, { credentials: 'never allowed' });
    if (kind === 'versionOwner')
      b.projects[0]!.versions.push({
        id: 'v',
        number: 1,
        createdAt: 0,
        kind: 'initial',
        project: b.projects[1]!.project,
      });
    if (kind === 'restoredFrom')
      b.projects[0]!.versions.push({
        id: 'v',
        number: 1,
        createdAt: 0,
        kind: 'restore',
        restoredFrom: 'unknown',
        project: b.projects[0]!.project,
      });
    if (kind === 'bounds') b.projects[0]!.project.width = -1;
    expect(() => validateWorkspaceBackup(b)).toThrow();
  });
  it('rejects invalid selections rather than silently omitting them', () => {
    const b = blank();
    expect(() =>
      selectWorkspaceBackup(b, {
        projectIds: ['absent'],
        includeVersions: true,
        assetIds: [],
      }),
    ).toThrow();
    expect(() =>
      selectWorkspaceBackup(b, {
        projectIds: [],
        includeVersions: true,
        assetIds: ['absent'],
      }),
    ).toThrow();
  });
  it('rejects malformed runtime selections including truthy non-boolean versions', () => {
    for (const selection of [
      null,
      { projectIds: [], assetIds: [], includeVersions: 'false' },
      { projectIds: 'project', assetIds: [], includeVersions: true },
      { projectIds: [], assetIds: [], includeVersions: true, unknown: true },
    ])
      expect(() => validateWorkspaceSelection(selection)).toThrow();
  });
  it('accepts metadata JSON and existing project backup envelopes only explicitly', async () => {
    const b = blank();
    expect(
      (await readWorkspaceArchive(new Blob([JSON.stringify(b)]))).backup
        .projects,
    ).toHaveLength(2);
    const legacy = new Blob([
      JSON.stringify({
        backupVersion: 1,
        identityVersion: 1,
        project: b.projects[0]!.project,
        assets: [],
        transcripts: [],
      }),
    ]);
    await expect(readWorkspaceArchive(legacy)).rejects.toMatchObject({
      code: 'INVALID_DOCUMENT',
    });
    expect(
      (await readWorkspaceArchive(legacy, undefined, true)).backup.projects,
    ).toHaveLength(1);
  });
  it('checks ZIP paths, inflated size limits, corruption and undeclared entries', async () => {
    const json = strToU8(JSON.stringify(blank()));
    const valid = zipSync({ 'workspace.json': json });
    expect(
      (await readWorkspaceArchive(blob(valid))).backup.projects,
    ).toHaveLength(2);
    await expect(
      readWorkspaceArchive(
        blob(zipSync({ 'workspace.json': json, '../evil': new Uint8Array() })),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' });
    await expect(
      readWorkspaceArchive(
        blob(zipSync({ 'workspace.json': json, 'assets/0': new Uint8Array() })),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' });
    const stored = zipSync({ 'workspace.json': json }, { level: 0 });
    const changed = stored.slice();
    const name = strToU8('"name":"one"');
    const atName = changed.findIndex((_, i) =>
      name.every((n, j) => changed[i + j] === n),
    );
    expect(atName).toBeGreaterThan(0);
    changed[atName + 8] = 'x'.charCodeAt(0);
    await expect(readWorkspaceArchive(blob(changed))).rejects.toMatchObject({
      code: 'INVALID_DOCUMENT',
    });
    const huge = valid.slice();
    const view = new DataView(huge.buffer);
    let at = 0;
    while (view.getUint32(at, true) !== 0x02014b50) at++;
    view.setUint32(at + 24, MAX_ARCHIVE_BYTES + 1, true);
    await expect(readWorkspaceArchive(blob(huge))).rejects.toMatchObject({
      code: 'INVALID_DOCUMENT',
    });
    await expect(
      readWorkspaceArchive(blob(valid.subarray(0, valid.length - 5))),
    ).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' });
  });
  it('removes staged files/journals and releases recovery locks on write failure', async () => {
    const b = blank();
    const source = new Blob(['original']);
    const bytes = new Uint8Array(await source.arrayBuffer());
    const sha = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    )
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('');
    b.assets = [
      {
        id: 'asset',
        name: 'asset.png',
        kind: 'image',
        size: source.size,
        type: 'image/png',
        durationUs: 0,
        width: 1,
        height: 1,
        rotation: 0,
        status: 'ready',
      },
    ];
    b.projects[0]!.project = validateProject({
      ...b.projects[0]!.project,
      tracks: [
        {
          id: 'track',
          kind: 'video',
          clips: [
            {
              id: 'clip',
              kind: 'image',
              assetId: 'asset',
              startUs: 0,
              durationUs: 1000000,
              opacity: 1,
              speed: 1,
              gain: 1,
            },
          ],
        },
      ],
    });
    vi.spyOn(media, 'inspect').mockResolvedValue(b.assets[0]!);
    b.files = [
      { assetId: 'asset', path: 'assets/0', size: source.size, sha256: sha },
    ];
    const release = vi.fn();
    const remove = vi.fn(async () => {});
    const finishJournal = vi.fn(async () => {});
    const journal = vi.fn(async () => {});
    const capturedArchive = { backup: b, files: new Map([['asset', source]]) };
    const store = {
      evict: async () => {},
      lease: async () => release,
      journal,
      write: async (_path: string, stream: ReadableStream<Uint8Array>) => {
        // The caller changed its Map from a progress handler; publication still
        // consumes the same immutable bytes that passed hash/metadata checks.
        expect(await new Response(stream).text()).toBe('original');
        throw new DOMException('Full', 'QuotaExceededError');
      },
      remove,
      finishJournal,
    } as unknown as Store;
    await expect(
      restoreWorkspace(
        store,
        capturedArchive,
        {
          projectIds: [b.projects[0]!.project.id],
          includeVersions: true,
          assetIds: ['asset'],
        },
        new AbortController().signal,
        (event) => {
          if (event.stage === 'Restoring originals')
            capturedArchive.files.set('asset', new Blob(['changed']));
        },
      ),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    expect(remove).toHaveBeenCalledTimes(3);
    expect(finishJournal).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });
});
