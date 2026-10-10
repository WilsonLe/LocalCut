import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';
import type {
  AssetIndexRun,
  IndexArtifact,
  IndexLabel,
  IndexRequestManifest,
} from '../core/asset-index';
import { indexLabelSchema } from '../core/asset-index';
import { EditorError, invariant, asEditorError } from '../core/errors';
import { checkAbort } from '../services/jobs';
import { commitWithSignal } from './transaction';

interface PendingFile {
  id: string;
  runId: string;
}
/** Retained index evidence is deliberately outside the disposable derivative cache. */
export class AssetIndexStore {
  private constructor(
    readonly namespace: string,
    private db: IDBPDatabase,
    private root: FileSystemDirectoryHandle,
  ) {}
  static async open(namespace: string) {
    invariant(
      /^[a-zA-Z0-9_-]{1,80}$/.test(namespace),
      'INVALID_DOCUMENT',
      'Invalid namespace',
    );
    const db = await openDB(`${namespace}-asset-index-v1`, 1, {
      upgrade(db) {
        db.createObjectStore('runs', { keyPath: 'id' }).createIndex(
          'assetId',
          'assetId',
        );
        db.createObjectStore('journal', { keyPath: 'id' });
      },
    });
    try {
      const owner = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle(namespace, { create: true });
      const root = await owner.getDirectoryHandle('asset-index', {
        create: true,
      });
      const store = new AssetIndexStore(namespace, db, root);
      await store.recover();
      return store;
    } catch (e) {
      db.close();
      throw e;
    }
  }
  lock<T>(key: string, work: () => Promise<T>, signal?: AbortSignal) {
    return navigator.locks.request(
      `${this.namespace}:asset-index:${key}`,
      { signal },
      work,
    );
  }
  active<T>(runId: string, work: () => Promise<T>, signal?: AbortSignal) {
    return this.lock(`active:${runId}`, work, signal);
  }
  async list(assetId?: string): Promise<AssetIndexRun[]> {
    const records = assetId
      ? await this.db.getAllFromIndex('runs', 'assetId', assetId)
      : await this.db.getAll('runs');
    return records.sort(
      (a: AssetIndexRun, b: AssetIndexRun) =>
        b.createdAt - a.createdAt || b.id.localeCompare(a.id),
    );
  }
  async get(id: string): Promise<AssetIndexRun> {
    const run = await this.db.get('runs', id);
    invariant(run && run.version === 1, 'NOT_FOUND', 'Index run missing');
    return run;
  }
  async create(run: AssetIndexRun, signal: AbortSignal) {
    checkAbort(signal);
    const tx = this.db.transaction('runs', 'readwrite');
    await commitWithSignal(tx, signal, () => tx.store.add(run));
  }
  async update(
    id: string,
    mutate: (run: AssetIndexRun) => void,
    signal?: AbortSignal,
  ) {
    return this.lock(
      `record:${id}`,
      async () => {
        checkAbort(signal ?? new AbortController().signal);
        const tx = this.db.transaction('runs', 'readwrite');
        return commitWithSignal(tx, signal, async () => {
          const run = (await tx.store.get(id)) as AssetIndexRun | undefined;
          invariant(run, 'NOT_FOUND', 'Index run missing');
          invariant(
            !run.invalidated,
            'MISSING_ASSET',
            'Index source has changed; reindex the asset',
          );
          mutate(run);
          await tx.store.put(run);
          return run;
        });
      },
      signal,
    );
  }
  async publishFile(
    runId: string,
    sceneId: string,
    blob: Blob,
    kind: 'image' | 'video' | 'audio',
    signal: AbortSignal,
  ) {
    const artifact: IndexArtifact = {
      id: crypto.randomUUID(),
      kind,
      type:
        kind === 'image'
          ? 'image/jpeg'
          : kind === 'video'
            ? 'video/mp4'
            : 'audio/wav',
      size: blob.size,
    };
    return this.lock(
      `file:${artifact.id}`,
      async () => {
        checkAbort(signal);
        await this.db.put('journal', {
          id: artifact.id,
          runId,
        } satisfies PendingFile);
        try {
          const writer = await (
            await this.root.getFileHandle(artifact.id, { create: true })
          ).createWritable();
          try {
            await blob.stream().pipeTo(writer, { signal });
          } catch (e) {
            await writer.abort().catch(() => {});
            throw e;
          }
          await this.lock(
            `record:${runId}`,
            async () => {
              const tx = this.db.transaction(['runs', 'journal'], 'readwrite');
              await commitWithSignal(tx, signal, async () => {
                const run = (await tx.objectStore('runs').get(runId)) as
                  AssetIndexRun | undefined;
                invariant(
                  run && !run.invalidated,
                  'MISSING_ASSET',
                  'Index run/source unavailable',
                );
                const scene = run.analysis.scenes.find((s) => s.id === sceneId);
                invariant(scene, 'INVALID_DOCUMENT', 'Index scene missing');
                scene.artifacts.push(artifact);
                await tx.objectStore('runs').put(run);
                await tx.objectStore('journal').delete(artifact.id);
              });
            },
            signal,
          );
          return artifact;
        } catch (e) {
          // A successfully committed artifact is retained even after late cancellation.
          const run = await this.get(runId).catch(() => undefined);
          if (
            !run?.analysis.scenes.some((s) =>
              s.artifacts.some((a) => a.id === artifact.id),
            )
          ) {
            await this.root.removeEntry(artifact.id).catch(() => {});
            await this.db.delete('journal', artifact.id);
          }
          throw asEditorError(e);
        }
      },
      signal,
    );
  }
  async artifact(runId: string, artifactId: string) {
    const run = await this.get(runId);
    const artifact = run.analysis.scenes
      .flatMap((s) => s.artifacts)
      .find((a) => a.id === artifactId);
    invariant(artifact, 'NOT_FOUND', 'Index artifact missing');
    const file = await (await this.root.getFileHandle(artifact.id)).getFile();
    return new File([file], artifact.id, { type: artifact.type });
  }
  async request(
    id: string,
    manifest: IndexRequestManifest,
    signal: AbortSignal,
  ) {
    invariant(
      manifest.prompt.length <= 500000 && manifest.model.length <= 256,
      'INVALID_DOCUMENT',
      'Index request too large',
    );
    return this.update(
      id,
      (run) => {
        run.requests.push(manifest);
        run.status = 'labeling';
        delete run.error;
      },
      signal,
    );
  }
  async response(
    id: string,
    requestId: string,
    response: string,
    label: IndexLabel | undefined,
    sceneId: string | undefined,
    model: string | undefined,
    usage: IndexRequestManifest['usage'],
    signal: AbortSignal,
  ) {
    invariant(
      response.length <= 65536,
      'INVALID_DOCUMENT',
      'Index response too large',
    );
    if (label) indexLabelSchema.parse(label);
    return this.update(
      id,
      (run) => {
        const request = run.requests.find((r) => r.id === requestId);
        invariant(
          request && request.sceneId === sceneId,
          'INVALID_DOCUMENT',
          'Index request mismatch',
        );
        request.response = response;
        request.actualModel = model;
        request.usage = usage;
        request.label = label;
        if (label && sceneId) {
          const scene = run.analysis.scenes.find((s) => s.id === sceneId);
          invariant(scene, 'INVALID_DOCUMENT', 'Index scene mismatch');
          scene.label = label;
        } else if (label && request.purpose !== 'summary-part') {
          invariant(
            run.analysis.scenes.length > 0 &&
              run.analysis.scenes.every((s) => s.label),
            'INVALID_DOCUMENT',
            'Complete each scene label before publishing the asset summary',
          );
          run.label = label;
          run.status = 'complete';
        }
      },
      signal,
    );
  }
  async invalidate(assetId: string) {
    const tx = this.db.transaction('runs', 'readwrite');
    for (const run of await tx.store.index('assetId').getAll(assetId))
      await tx.store.put({ ...run, invalidated: true });
    await tx.done;
  }
  async remove(id: string) {
    return this.active(id, async () => {
      const run = await this.get(id);
      // Keep a tombstone until all files have been removed, so an interrupted
      // explicit deletion is recoverable and cannot remain active chat context.
      await this.lock(`record:${id}`, async () => {
        const tx = this.db.transaction('runs', 'readwrite');
        const current = await tx.store.get(id);
        invariant(current, 'NOT_FOUND', 'Index run missing');
        await tx.store.put({ ...current, deleting: true, invalidated: true });
        await tx.done;
      });
      await this.erase(run);
    });
  }
  private async erase(run: AssetIndexRun) {
    for (const artifact of run.analysis.scenes.flatMap((s) => s.artifacts))
      await this.root.removeEntry(artifact.id).catch((e) => {
        if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e;
      });
    await this.db.delete('runs', run.id);
  }
  private async recover() {
    for (const file of (await this.db.getAll('journal')) as PendingFile[])
      await navigator.locks.request(
        `${this.namespace}:asset-index:file:${file.id}`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock || !(await this.db.get('journal', file.id))) return;
          await this.root.removeEntry(file.id).catch((e) => {
            if (!(e instanceof DOMException && e.name === 'NotFoundError'))
              throw e;
          });
          await this.db.delete('journal', file.id);
        },
      );
    for (const run of await this.list())
      if (
        run.deleting ||
        run.status === 'analyzing' ||
        run.status === 'labeling'
      )
        await navigator.locks.request(
          `${this.namespace}:asset-index:active:${run.id}`,
          { ifAvailable: true },
          async (lock) => {
            if (!lock) return;
            if (run.deleting) {
              await this.erase(run);
              return;
            }
            await this.update(run.id, (current) => {
              if (
                current.status === 'analyzing' ||
                current.status === 'labeling'
              ) {
                current.status = 'cancelled';
                current.error = 'Interrupted; retry indexing.';
              }
            }).catch((e) => {
              if (!(e instanceof EditorError && e.code === 'MISSING_ASSET'))
                throw e;
            });
          },
        );
  }
  close() {
    this.db.close();
  }
}
