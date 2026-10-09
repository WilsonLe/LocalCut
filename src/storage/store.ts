import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';
import { asEditorError, EditorError, invariant } from '../core/errors';
import { applyOperations, canonical, parseBatch } from '../core/commands';
import type { CommandBatch, EditReceipt } from '../core/commands';
import { assetIds, validateProject } from '../core/model';
import type { Asset, Project, Transcript } from '../core/model';
interface RecordState {
  project: Project;
  undo: Project[];
  redo: Project[];
}
interface SavedReceipt {
  key: string;
  content: string;
  receipt: EditReceipt;
}
export interface Journal {
  id: string;
  target: string;
  kind: 'import' | 'export' | 'derivative';
}
export interface Derivative {
  id: string;
  assetId: string;
  path: string;
  size: number;
  accessed: number;
  kind: string;
}
export class Store {
  private constructor(
    readonly namespace: string,
    readonly db: IDBPDatabase,
    readonly root: FileSystemDirectoryHandle,
  ) {}
  static async open(namespace = 'localcut', recover = true) {
    invariant(
      /^[a-zA-Z0-9_-]{1,80}$/.test(namespace),
      'INVALID_DOCUMENT',
      'Invalid storage namespace',
    );
    invariant(
      typeof indexedDB !== 'undefined' &&
        !!navigator.storage?.getDirectory &&
        !!navigator.locks,
      'UNSUPPORTED_CODEC',
      'IndexedDB, OPFS and Web Locks require secure Chrome',
    );
    const db = await openDB(`${namespace}-v1`, 1, {
      upgrade(db) {
        for (const name of [
          'projects',
          'assets',
          'receipts',
          'transcripts',
          'journal',
          'derivatives',
        ])
          db.createObjectStore(name, {
            keyPath: name === 'receipts' ? 'key' : 'id',
          });
      },
    });
    const root = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle(namespace, { create: true });
    const store = new Store(namespace, db, root);
    if (recover) await store.recover();
    return store;
  }
  async lock<T>(
    key: string,
    mode: 'exclusive' | 'shared',
    fn: () => Promise<T>,
  ): Promise<T> {
    return navigator.locks.request(`${this.namespace}:${key}`, { mode }, fn);
  }
  async lease(key: string): Promise<() => void> {
    let release!: () => void;
    let acquired!: () => void;
    const ready = new Promise<void>((r) => {
        acquired = r;
      }),
      held = new Promise<void>((r) => {
        release = r;
      });
    void this.lock(key, 'shared', async () => {
      acquired();
      await held;
    });
    await ready;
    return release;
  }
  async getProject(id: string): Promise<Project> {
    const record = (await this.db.get('projects', id)) as
      RecordState | undefined;
    invariant(record, 'NOT_FOUND', `Project ${id} missing`);
    return validateProject(record.project);
  }
  async create(project: Project) {
    const value = validateProject(project);
    await this.db.add('projects', {
      id: value.id,
      project: value,
      undo: [],
      redo: [],
    });
    return value;
  }
  async list(): Promise<Project[]> {
    return ((await this.db.getAll('projects')) as RecordState[]).map((r) =>
      validateProject(r.project),
    );
  }
  async deleteProject(id: string) {
    const tx = this.db.transaction(['projects', 'receipts'], 'readwrite');
    await tx.objectStore('projects').delete(id);
    const receipts = (await tx
      .objectStore('receipts')
      .getAll()) as SavedReceipt[];
    for (const r of receipts)
      if (r.receipt.projectId === id)
        await tx.objectStore('receipts').delete(r.key);
    await tx.done;
  }
  async apply(input: CommandBatch) {
    const batch = parseBatch(input);
    return this.commit(
      batch.projectId,
      batch.requestId,
      batch.expectedRevision,
      canonical(batch),
      (state) => {
        const result = applyOperations(state.project, batch.operations);
        state.undo.push(state.project);
        state.undo = state.undo.slice(-100);
        state.redo = [];
        state.project = result.project;
        return result.affectedIds;
      },
    );
  }
  async history(
    projectId: string,
    requestId: string,
    expectedRevision: number,
    direction: 'undo' | 'redo',
  ) {
    return this.commit(
      projectId,
      requestId,
      expectedRevision,
      canonical({ projectId, requestId, expectedRevision, direction }),
      (state) => {
        const from = direction === 'undo' ? state.undo : state.redo,
          to = direction === 'undo' ? state.redo : state.undo;
        const restored = from.pop();
        invariant(restored, 'INVALID_COMMAND', `Nothing to ${direction}`);
        to.push(state.project);
        if (to.length > 100) to.shift();
        state.project = restored;
        return [projectId];
      },
    );
  }
  private async commit(
    projectId: string,
    requestId: string,
    expected: number,
    content: string,
    mutate: (state: RecordState) => string[],
  ): Promise<EditReceipt> {
    invariant(
      requestId.length > 0 && Number.isSafeInteger(expected) && expected >= 0,
      'INVALID_COMMAND',
      'Invalid command envelope',
    );
    const tx = this.db.transaction(
      ['projects', 'receipts', 'assets'],
      'readwrite',
    );
    try {
      const key = `${projectId}:${requestId}`,
        saved = (await tx.objectStore('receipts').get(key)) as
          SavedReceipt | undefined;
      if (saved) {
        invariant(
          saved.content === content,
          'REQUEST_CONFLICT',
          'Request ID reused with different content',
        );
        await tx.done;
        return saved.receipt;
      }
      const state = (await tx.objectStore('projects').get(projectId)) as
        RecordState | undefined;
      invariant(state, 'NOT_FOUND', 'Project missing');
      const revision = state.project.revision;
      invariant(
        revision === expected,
        'REVISION_CONFLICT',
        `Expected revision ${expected}; current ${revision}`,
      );
      const affectedIds = mutate(state);
      state.project = validateProject({
        ...state.project,
        revision: revision + 1,
      });
      await this.validateAssets(state.project, (id) =>
        tx.objectStore('assets').get(id),
      );
      const receipt: EditReceipt = {
        requestId,
        projectId,
        appliedRevision: revision + 1,
        affectedIds,
        warnings: [],
      };
      await tx.objectStore('projects').put({ ...state, id: projectId });
      await tx.objectStore('receipts').put({ key, content, receipt });
      await tx.done;
      return receipt;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* Already completed/aborted. */
      }
      await tx.done.catch(() => {});
      throw asEditorError(error);
    }
  }
  async validateAssets(
    project: Project,
    get: (id: string) => Promise<Asset | undefined> = (id) =>
      this.db.get('assets', id),
  ) {
    for (const assetId of assetIds(project)) {
      const asset = await get(assetId);
      invariant(asset, 'MISSING_ASSET', 'Asset ' + assetId + ' missing');
      for (const clip of project.tracks
        .flatMap((t) => t.clips)
        .filter((c) => c.assetId === assetId)) {
        invariant(
          clip.kind === 'image'
            ? asset.kind === 'image'
            : clip.kind === 'video'
              ? asset.kind === 'video'
              : clip.kind === 'audio'
                ? !!asset.audioCodec
                : true,
          'INVALID_COMMAND',
          'Clip and asset types differ',
        );
        invariant(
          !clip.sourceOutUs || clip.sourceOutUs <= asset.durationUs,
          'INVALID_COMMAND',
          'Clip exceeds source duration',
        );
      }
    }
  }
  async getAsset(id: string): Promise<Asset> {
    const asset = (await this.db.get('assets', id)) as Asset | undefined;
    invariant(asset, 'MISSING_ASSET', `Asset ${id} missing`);
    return asset;
  }
  async file(path: string): Promise<File> {
    try {
      return await (await this.root.getFileHandle(path)).getFile();
    } catch {
      throw new EditorError('MISSING_ASSET', `File ${path} missing`);
    }
  }
  async write(path: string, data: Blob | ReadableStream<Uint8Array>) {
    const handle = await this.root.getFileHandle(path, { create: true });
    const writer = await handle.createWritable();
    try {
      if (data instanceof Blob) await data.stream().pipeTo(writer);
      else await data.pipeTo(writer);
    } catch (e) {
      await writer.abort().catch(() => {});
      throw asEditorError(e);
    }
  }
  async remove(path: string) {
    await this.root.removeEntry(path).catch((e) => {
      if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e;
    });
  }
  async journal(entry: Journal) {
    await this.db.put('journal', entry);
  }
  async finishJournal(id: string) {
    await this.db.delete('journal', id);
  }
  async recover() {
    for (const j of (await this.db.getAll('journal')) as Journal[]) {
      await navigator.locks.request(
        `${this.namespace}:job:${j.id}`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) return;
          if (j.kind === 'import' && (await this.db.get('assets', j.target))) {
            await this.finishJournal(j.id);
            return;
          }
          await this.remove(j.target);
          await this.finishJournal(j.id);
        },
      );
    }
  }
  async derivative(id: string): Promise<Derivative | undefined> {
    const d = (await this.db.get('derivatives', id)) as Derivative | undefined;
    if (d) {
      d.accessed = Date.now();
      await this.db.put('derivatives', d);
    }
    return d;
  }
  async cache(record: Derivative) {
    await this.db.put('derivatives', record);
    await this.evict();
    const size = ((await this.db.getAll('derivatives')) as Derivative[]).reduce(
      (n, r) => n + r.size,
      0,
    );
    if (size > 512 * 1024 * 1024) {
      await this.db.delete('derivatives', record.id);
      throw new EditorError(
        'QUOTA_EXCEEDED',
        'Derivative cache budget is occupied by active jobs',
      );
    }
  }
  async evict(reserveBytes = 0) {
    await this.lock('cache', 'exclusive', async () => {
      const estimate = await navigator.storage.estimate();
      const records = (
        (await this.db.getAll('derivatives')) as Derivative[]
      ).sort((a, b) => a.accessed - b.accessed);
      const available = Math.max(
        0,
        (estimate.quota ?? Infinity) - (estimate.usage ?? 0),
      );
      let size = records.reduce((n, d) => n + d.size, 0);
      const limit = Math.min(
        512 * 1024 * 1024,
        Math.max(0, available + size - reserveBytes),
      );
      for (const r of records) {
        if (size <= limit) break;
        await navigator.locks.request(
          `${this.namespace}:derivative:${r.id}`,
          { ifAvailable: true },
          async (lock) => {
            if (!lock) return;
            await navigator.locks.request(
              this.namespace + ':asset:' + r.assetId,
              { ifAvailable: true },
              async (assetLock) => {
                if (!assetLock) return;
                await this.remove(r.path);
                await this.db.delete('derivatives', r.id);
                size -= r.size;
              },
            );
          },
        );
      }
    });
  }
  async transcript(id: string): Promise<Transcript | undefined> {
    return this.db.get('transcripts', id);
  }
  async saveTranscript(value: Transcript) {
    await this.db.put('transcripts', value);
  }
  close() {
    this.db.close();
  }
}
