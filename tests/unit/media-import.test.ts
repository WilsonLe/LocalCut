import { describe, expect, it, vi } from 'vitest';
import { newProject } from '../../src/core/model';
import type { Asset } from '../../src/core/model';
import type { Job } from '../../src/services/jobs';
import { createMediaImporter } from '../../src/workspace/media-import';
import type {
  MediaImportHost,
  MediaImportEditor,
} from '../../src/workspace/media-import';
import type { ImportBatch } from '../../src/workspace/ImportProgressDialog';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const asset = (id: string): Asset => ({
  id,
  name: id,
  kind: 'image',
  size: 1,
  type: 'image/png',
  durationUs: 1,
  width: 1,
  height: 1,
  rotation: 0,
  status: 'ready',
});
const file = (name: string, path = '') => {
  const value = new File(['synthetic'], name, { type: 'image/png' });
  Object.defineProperty(value, 'webkitRelativePath', { value: path });
  return value;
};

function fixture(expectedJobs: number) {
  const project = newProject('Import owner');
  let currentProjectId: string | null = project.id;
  let batch: ImportBatch | null = null;
  const pending: ReturnType<typeof deferred<Asset>>[] = [];
  const stopped: ReturnType<typeof vi.fn>[] = [];
  const enqueued = deferred<void>();
  const firstEnqueued = deferred<void>();
  const placements: {
    projectId: string;
    assetId: string | null;
    directories: string[];
    folderId: string | null;
  }[] = [];
  const place = vi.fn(
    async (
      projectId: string,
      assetId: string | null,
      directories: string[],
      folderId: string | null,
    ) => {
      placements.push({ projectId, assetId, directories, folderId });
      return { revision: 1, entries: [] };
    },
  );
  const editor: MediaImportEditor = {
    projects: { create: vi.fn(async () => project) },
    assets: {
      import: vi.fn((): Job<Asset> => {
        const result = deferred<Asset>();
        pending.push(result);
        const stop = vi.fn();
        stopped.push(stop);
        if (pending.length === 1) firstEnqueued.resolve();
        if (pending.length === expectedJobs) enqueued.resolve();
        return {
          id: `job-${pending.length}`,
          completion: result.promise,
          cancel: vi.fn(),
          subscribe: () => stop,
        };
      }),
    },
    library: {
      forProject: (id) => ({
        place: (assetId, dirs, parent) =>
          place(id, assetId, dirs ?? [], parent ?? null),
      }),
    },
  };
  const host: MediaImportHost = {
    busy: false,
    browsing: { current: false },
    alive: { current: true },
    lock: { current: false },
    state: { current: { visibleBatchId: null, placement: Promise.resolve() } },
    setImportBatch: (value) => {
      batch = typeof value === 'function' ? value(batch) : value;
    },
    action: async (work) => {
      try {
        await work();
        return true;
      } catch (error) {
        host.error(error);
        return false;
      }
    },
    ensureEditor: vi.fn(async () => editor),
    getProjectId: () => currentProjectId,
    openProject: vi.fn(async (opened) => {
      currentProjectId = opened.id;
    }),
    refresh: vi.fn(async () => {}),
    error: vi.fn(),
    revealMedia: vi.fn(),
  };
  return {
    host,
    editor,
    project,
    pending,
    stopped,
    enqueued: enqueued.promise,
    firstEnqueued: firstEnqueued.promise,
    placements,
    place,
    batch: () => batch,
    navigate: (id: string | null) => {
      currentProjectId = id;
    },
    dismiss: () => {
      host.state.current.visibleBatchId = null;
      batch = null;
    },
  };
}

describe('workspace media import ownership', () => {
  it('enqueues the complete selection and keeps late placements in the initiating project after dismissal/navigation', async () => {
    const f = fixture(2);
    const result = createMediaImporter(f.host)(
      [file('one.png', 'trip/day/one.png'), file('.DS_Store'), file('two.png')],
      'destination',
    );
    await f.enqueued;
    expect(f.batch()?.files.map(({ status }) => status)).toEqual([
      'queued',
      'skipped',
      'queued',
    ]);
    f.dismiss();
    f.navigate('another-project');
    f.pending[1]!.resolve(asset('two'));
    f.pending[0]!.resolve(asset('one'));
    expect(await result).toBe(true);
    expect(f.placements).toEqual([
      {
        projectId: f.project.id,
        assetId: 'one',
        directories: ['trip', 'day'],
        folderId: 'destination',
      },
      {
        projectId: f.project.id,
        assetId: 'two',
        directories: [],
        folderId: 'destination',
      },
    ]);
    expect(f.batch()).toBeNull();
    expect(f.host.revealMedia).not.toHaveBeenCalled();
    expect(f.host.refresh).not.toHaveBeenCalled();
    for (const stop of f.stopped) expect(stop).toHaveBeenCalledOnce();
  });

  it('serializes placements across render hosts and recovers the queue after a failed placement', async () => {
    const f = fixture(2),
      release = deferred<void>();
    const entered = deferred<void>();
    f.place.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      throw new Error('Folder conflict');
    });
    const first = createMediaImporter(f.host)([file('one.png')]);
    await f.firstEnqueued;
    f.pending[0]!.resolve(asset('one'));
    await entered.promise;
    const second = createMediaImporter({ ...f.host })([file('two.png')]);
    await f.enqueued;
    f.pending[1]!.resolve(asset('two'));
    await Promise.resolve();
    expect(f.place).toHaveBeenCalledTimes(1);
    release.resolve();
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(f.placements).toEqual([
      {
        projectId: f.project.id,
        assetId: 'two',
        directories: [],
        folderId: null,
      },
    ]);
    expect(f.batch()?.files[0]?.status).toBe('completed');
    expect(f.host.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Folder conflict' }),
    );
    for (const stop of f.stopped) expect(stop).toHaveBeenCalledOnce();
  });

  it('retains successful imports alongside failures and keeps cancellation quiet', async () => {
    const f = fixture(3);
    const result = createMediaImporter(f.host)([
      file('cancel.png'),
      file('broken.png'),
      file('ready.png'),
    ]);
    await f.enqueued;
    f.pending[0]!.reject(
      Object.assign(new Error('Cancelled'), { code: 'CANCELLED' }),
    );
    const failure = new Error('Decoder unavailable');
    f.pending[1]!.reject(failure);
    f.pending[2]!.resolve(asset('ready'));
    expect(await result).toBe(false);
    expect(f.batch()?.running).toBe(false);
    expect(f.batch()?.files.map(({ status }) => status)).toEqual([
      'cancelled',
      'failed',
      'completed',
    ]);
    expect(f.host.error).toHaveBeenCalledExactlyOnceWith(failure);
    expect(f.placements.map(({ assetId }) => assetId)).toEqual(['ready']);
    for (const stop of f.stopped) expect(stop).toHaveBeenCalledOnce();
  });

  it('does not publish placements or view updates after unmount', async () => {
    const f = fixture(1);
    const result = createMediaImporter(f.host)([file('one.png')]);
    await f.enqueued;
    const previous = f.batch();
    f.host.alive.current = false;
    f.pending[0]!.resolve(asset('one'));
    expect(await result).toBe(false);
    expect(f.placements).toEqual([]);
    expect(f.batch()).toBe(previous);
    expect(f.host.revealMedia).not.toHaveBeenCalled();
    expect(f.stopped[0]).toHaveBeenCalledOnce();
  });

  it.each(['busy', 'browsing', 'locked', 'empty'])(
    'keeps the %s guard inert',
    async (guard) => {
      const f = fixture(0);
      if (guard === 'busy') f.host.busy = true;
      if (guard === 'browsing') f.host.browsing.current = true;
      if (guard === 'locked') f.host.lock.current = true;
      expect(
        await createMediaImporter(f.host)(
          guard === 'empty' ? [] : [file('one.png')],
        ),
      ).toBe(false);
      expect(f.host.ensureEditor).not.toHaveBeenCalled();
      expect(f.batch()).toBeNull();
    },
  );

  it('creates the initial project explicitly and preserves directory-only uploads', async () => {
    const f = fixture(0);
    f.navigate(null);
    expect(await createMediaImporter(f.host)([], null, ['trip/day'])).toBe(
      true,
    );
    expect(f.editor.projects.create).toHaveBeenCalledWith('Untitled project');
    expect(f.placements).toEqual([
      {
        projectId: f.project.id,
        assetId: null,
        directories: ['trip', 'day'],
        folderId: null,
      },
    ]);
    expect(f.host.refresh).toHaveBeenCalledOnce();
    expect(f.host.openProject).toHaveBeenCalledOnce();
  });
});
