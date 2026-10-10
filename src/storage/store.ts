import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';
import { asEditorError, EditorError, invariant } from '../core/errors';
import { applyOperations, canonical, parseBatch } from '../core/commands';
import type { CommandBatch, EditReceipt } from '../core/commands';
import { legacyCommandReceiptContent } from '../core/receipt-content';
import { repairLegacyIdentities } from '../core/legacy-identities';
import {
  assetIds,
  validateProject,
  validateBackup,
  transcriptSchema,
} from '../core/model';
import { commitWithSignal } from './transaction';
import type { Asset, Project, Transcript, ProjectBackup } from '../core/model';
export interface ProjectVersion {
  id: string;
  number: number;
  createdAt: number;
  kind: 'initial' | 'autosave' | 'restore';
  restoredFrom?: string;
  project: Project;
}
export type ProjectVersionInfo = Omit<ProjectVersion, 'project'> & {
  revision: number;
};
function appendVersion(
  state: RecordState,
  kind: ProjectVersion['kind'],
  restoredFrom?: string,
) {
  const versions = (state.versions ??= []);
  if (
    kind !== 'restore' &&
    versions.at(-1)?.project.revision === state.project.revision
  )
    return versions.at(-1)!;
  const version: ProjectVersion = {
    id: crypto.randomUUID(),
    number: versions.length + 1,
    createdAt: Date.now(),
    kind,
    ...(restoredFrom ? { restoredFrom } : {}),
    project: structuredClone(state.project),
  };
  versions.push(version);
  return version;
}
interface RecordState {
  identityVersion?: 1;
  versions?: ProjectVersion[];
  project: Project;
  undo: Project[];
  redo: Project[];
}
interface SavedReceipt {
  key: string;
  content: string;
  contentVersion?: 2;
  receipt: EditReceipt;
}
export function normalizeState(state: RecordState): RecordState {
  invariant(
    state.identityVersion === undefined || state.identityVersion === 1,
    'INVALID_DOCUMENT',
    'Unsupported stored identity version',
  );
  invariant(
    Array.isArray(state.undo) && Array.isArray(state.redo),
    'INVALID_DOCUMENT',
    'Invalid project history',
  );
  if (state.identityVersion === 1) {
    const normalized = { ...state, project: validateProject(state.project) };
    if (!normalized.versions?.length) appendVersion(normalized, 'initial');
    return normalized;
  }
  // Oldest undo first; redo is a stack, so its reverse is chronological.
  const snapshots = [
    ...state.undo,
    state.project,
    ...[...state.redo].reverse(),
  ];
  const normalized = repairLegacyIdentities(snapshots);
  const result: RecordState = {
    ...state,
    identityVersion: 1,
    project: normalized[state.undo.length]!,
    undo: normalized.slice(0, state.undo.length),
    redo: normalized.slice(state.undo.length + 1).reverse(),
  };
  if (!result.versions?.length) appendVersion(result, 'initial');
  return result;
}
export interface Journal {
  id: string;
  target: string;
  kind: 'import' | 'export' | 'derivative';
  committed?: boolean;
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
    signal?: AbortSignal,
  ): Promise<T> {
    return navigator.locks.request(
      `${this.namespace}:${key}`,
      { mode, signal },
      fn,
    );
  }
  async lease(key: string, signal?: AbortSignal): Promise<() => void> {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    return new Promise((resolve, reject) => {
      void this.lock(
        key,
        'shared',
        async () => {
          resolve(release);
          await held;
        },
        signal,
      ).catch(reject);
    });
  }
  async getProject(id: string): Promise<Project> {
    const tx = this.db.transaction('projects', 'readwrite');
    return commitWithSignal(tx, undefined, async () => {
      const record = (await tx.store.get(id)) as RecordState | undefined;
      invariant(record, 'NOT_FOUND', `Project ${id} missing`);
      const state = normalizeState(record);
      if (record.identityVersion === undefined || !record.versions?.length)
        await tx.store.put({ ...state, id });
      return state.project;
    });
  }
  async create(project: Project) {
    const value = validateProject(project);
    const tx = this.db.transaction(
      ['projects', 'assets', 'transcripts'],
      'readwrite',
    );
    return commitWithSignal(tx, undefined, async () => {
      await this.validateAssets(
        value,
        (id) => tx.objectStore('assets').get(id),
        (id) => tx.objectStore('transcripts').get(id),
      );
      const state: RecordState = {
        identityVersion: 1,
        project: value,
        undo: [],
        redo: [],
      };
      appendVersion(state, 'initial');
      await tx.objectStore('projects').add({ ...state, id: value.id });
      return value;
    });
  }
  async backup(id: string): Promise<ProjectBackup> {
    const tx = this.db.transaction(
      ['projects', 'assets', 'transcripts'],
      'readwrite',
    );
    return commitWithSignal(tx, undefined, async () => {
      const record = (await tx.objectStore('projects').get(id)) as
        RecordState | undefined;
      invariant(record, 'NOT_FOUND', 'Project missing');
      const state = normalizeState(record);
      if (record.identityVersion === undefined || !record.versions?.length)
        await tx.objectStore('projects').put({ ...state, id });
      const project = state.project;
      const transcriptIds = [
        ...new Set(
          project.tracks.flatMap((t) =>
            t.clips.flatMap((c) => (c.transcriptId ? [c.transcriptId] : [])),
          ),
        ),
      ];
      const transcripts = await Promise.all(
        transcriptIds.map(
          (id) => tx.objectStore('transcripts').get(id) as Promise<Transcript>,
        ),
      );
      const ids = [
        ...new Set([
          ...assetIds(project),
          ...transcripts.filter(Boolean).map((t) => t.assetId),
        ]),
      ];
      const assets = await Promise.all(
        ids.map((id) => tx.objectStore('assets').get(id) as Promise<Asset>),
      );
      return validateBackup({
        backupVersion: 1,
        identityVersion: 1,
        project,
        assets,
        transcripts,
      });
    });
  }
  async restore(value: unknown, repairLegacy = false) {
    if (
      repairLegacy &&
      value &&
      typeof value === 'object' &&
      !('identityVersion' in value) &&
      'project' in value
    )
      value = { ...value, project: repairLegacyIdentities([value.project])[0] };
    const backup = validateBackup(value);
    const assets = new Map(
      backup.assets.map((a) => [a.id, crypto.randomUUID()]),
    );
    const transcripts = new Map(
      backup.transcripts.map((t) => [t.id, crypto.randomUUID()]),
    );
    const project = validateProject({
      ...backup.project,
      id: crypto.randomUUID(),
      revision: 0,
      tracks: backup.project.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => ({
          ...c,
          ...(c.assetId ? { assetId: assets.get(c.assetId) } : {}),
          ...(c.transcriptId
            ? { transcriptId: transcripts.get(c.transcriptId) }
            : {}),
        })),
      })),
    });
    const tx = this.db.transaction(
      ['projects', 'assets', 'transcripts'],
      'readwrite',
    );
    try {
      const state: RecordState = {
        identityVersion: 1,
        project,
        undo: [],
        redo: [],
      };
      appendVersion(state, 'initial');
      await tx.objectStore('projects').add({ ...state, id: project.id });
      for (const asset of backup.assets)
        await tx
          .objectStore('assets')
          .add({ ...asset, id: assets.get(asset.id)!, status: 'missing' });
      for (const transcript of backup.transcripts)
        await tx.objectStore('transcripts').add({
          ...transcript,
          id: transcripts.get(transcript.id)!,
          assetId: assets.get(transcript.assetId)!,
        });
      await tx.done;
      return project;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* Already aborted. */
      }
      await tx.done.catch(() => {});
      throw asEditorError(error);
    }
  }
  async list(): Promise<Project[]> {
    const tx = this.db.transaction('projects', 'readwrite');
    return commitWithSignal(tx, undefined, async () => {
      const records = (await tx.store.getAll()) as RecordState[];
      const projects: Project[] = [];
      for (const record of records) {
        const state = normalizeState(record);
        if (record.identityVersion === undefined || !record.versions?.length)
          await tx.store.put({ ...state, id: state.project.id });
        projects.push(state.project);
      }
      return projects;
    });
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
  async versions(projectId: string): Promise<ProjectVersionInfo[]> {
    await this.getProject(projectId);
    const state = (await this.db.get('projects', projectId)) as
      RecordState | undefined;
    invariant(state, 'NOT_FOUND', 'Project missing');
    return (state.versions ?? [])
      .map(({ project, ...info }) => ({ ...info, revision: project.revision }))
      .reverse();
  }
  async version(projectId: string, versionId: string): Promise<ProjectVersion> {
    await this.getProject(projectId);
    const state = (await this.db.get('projects', projectId)) as
      RecordState | undefined;
    invariant(state, 'NOT_FOUND', 'Project missing');
    const version = state.versions?.find((v) => v.id === versionId);
    invariant(version, 'NOT_FOUND', 'Project version missing');
    return { ...version, project: validateProject(version.project) };
  }
  async saveVersion(projectId: string): Promise<ProjectVersion> {
    const tx = this.db.transaction('projects', 'readwrite');
    return commitWithSignal(tx, undefined, async () => {
      const record = (await tx.store.get(projectId)) as RecordState | undefined;
      invariant(record, 'NOT_FOUND', 'Project missing');
      const state = normalizeState(record);
      const version = appendVersion(state, 'autosave');
      await tx.store.put({ ...state, id: projectId });
      return version;
    });
  }
  async restoreVersion(
    projectId: string,
    versionId: string,
    requestId: string,
    expectedRevision: number,
  ) {
    return this.commit(
      projectId,
      requestId,
      expectedRevision,
      canonical({
        projectId,
        versionId,
        requestId,
        expectedRevision,
        action: 'restoreVersion',
      }),
      (state) => {
        const version = state.versions?.find((v) => v.id === versionId);
        invariant(version, 'NOT_FOUND', 'Project version missing');
        // Preserve the current working state, even before its debounce expires.
        appendVersion(state, 'autosave');
        state.undo.push(state.project);
        state.undo = state.undo.slice(-100);
        state.redo = [];
        state.project = validateProject(version.project);
        return [projectId];
      },
      undefined,
      versionId,
    );
  }
  async apply(input: CommandBatch) {
    const batch = parseBatch(input);
    const legacyContent = legacyCommandReceiptContent(input);
    return this.commit(
      batch.projectId,
      batch.requestId,
      batch.expectedRevision,
      canonical(input),
      (state) => {
        const result = applyOperations(state.project, batch.operations);
        state.undo.push(state.project);
        state.undo = state.undo.slice(-100);
        state.redo = [];
        state.project = result.project;
        return result.affectedIds;
      },
      () => legacyContent,
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
    legacyContent: () => string | undefined = () => content,
    restoredFrom?: string,
  ): Promise<EditReceipt> {
    invariant(
      requestId.length > 0 && Number.isSafeInteger(expected) && expected >= 0,
      'INVALID_COMMAND',
      'Invalid command envelope',
    );
    const tx = this.db.transaction(
      ['projects', 'receipts', 'assets', 'transcripts'],
      'readwrite',
    );
    try {
      const key = `${projectId}:${requestId}`,
        saved = (await tx.objectStore('receipts').get(key)) as
          SavedReceipt | undefined;
      if (saved) {
        const expectedContent =
          saved.contentVersion === 2
            ? content
            : saved.contentVersion === undefined
              ? legacyContent()
              : undefined;
        invariant(
          expectedContent !== undefined && saved.content === expectedContent,
          'REQUEST_CONFLICT',
          'Request ID reused with different content',
        );
        await tx.done;
        return saved.receipt;
      }
      const record = (await tx.objectStore('projects').get(projectId)) as
        RecordState | undefined;
      invariant(record, 'NOT_FOUND', 'Project missing');
      const state = normalizeState(record);
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
      await this.validateAssets(
        state.project,
        (id) => tx.objectStore('assets').get(id),
        (id) => tx.objectStore('transcripts').get(id),
      );
      if (restoredFrom) appendVersion(state, 'restore', restoredFrom);
      const receipt: EditReceipt = {
        requestId,
        projectId,
        appliedRevision: revision + 1,
        affectedIds,
        warnings: [],
      };
      await tx.objectStore('projects').put({ ...state, id: projectId });
      await tx
        .objectStore('receipts')
        .put({ key, content, contentVersion: 2, receipt });
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
    getTranscript: (id: string) => Promise<Transcript | undefined> = (id) =>
      this.db.get('transcripts', id),
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
    for (const clip of project.tracks.flatMap((track) => track.clips)) {
      if (!clip.transcriptId) continue;
      const transcript = await getTranscript(clip.transcriptId);
      invariant(
        transcript && transcript.assetId === clip.assetId,
        'INVALID_COMMAND',
        'Clip requires an existing transcript from its source asset',
      );
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
          const current = (await this.db.get('journal', j.id)) as
            Journal | undefined;
          if (!current) return;
          if (
            current.kind === 'import' &&
            current.committed &&
            (await this.db.get('assets', current.target))
          ) {
            await this.finishJournal(current.id);
            return;
          }
          await this.remove(current.target);
          await this.finishJournal(current.id);
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
        reserveBytes === Infinity
          ? 0
          : Math.max(0, available + size - reserveBytes),
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
  async saveTranscript(value: Transcript, signal?: AbortSignal) {
    const parsed = transcriptSchema.safeParse(value);
    invariant(parsed.success, 'INVALID_DOCUMENT', 'Invalid transcript');
    const tx = this.db.transaction(['assets', 'transcripts'], 'readwrite');
    return commitWithSignal(tx, signal, async () => {
      const asset = (await tx.objectStore('assets').get(value.assetId)) as
        Asset | undefined;
      invariant(asset, 'MISSING_ASSET', 'Transcript source asset missing');
      let previous = -1;
      const ids = new Set<string>();
      for (const cue of value.cues) {
        invariant(
          !ids.has(cue.id) &&
            cue.timeUs >= previous &&
            cue.endUs > cue.timeUs &&
            cue.endUs <= asset.durationUs,
          'INVALID_DOCUMENT',
          'Invalid source transcript timing or identity',
        );
        ids.add(cue.id);
        previous = cue.timeUs;
      }
      await tx.objectStore('transcripts').put(parsed.data);
    });
  }
  close() {
    this.db.close();
  }
}
