import { openDB, type IDBPDatabase } from 'idb';
import { invariant, asEditorError } from '../core/errors';
import {
  libraryNameSchema,
  libraryOperationSchema,
  libraryPath,
  libraryDescendants,
  availableLibraryName,
} from '../core/media-library';
import type {
  LibraryEntry,
  LibrarySnapshot,
  LibraryOperation,
} from '../core/media-library';
import type { Asset } from '../core/model';
import type { Store } from './store';
import { withQuotaRecovery } from './quota';

interface Mutation {
  from?: string;
  to: string;
  kind: 'folder' | 'asset';
  published: boolean;
  removeSource: boolean;
  replace?: boolean;
}

/** Named OPFS library files; immutable editing originals remain in Store's vault. */
export class MediaLibraryStore {
  private closing = false;
  private operations = new Set<Promise<unknown>>();
  private constructor(
    private store: Store,
    private db: IDBPDatabase,
  ) {}
  static async open(store: Store) {
    const db = await openDB(`${store.namespace}-media-library-v1`, 1, {
      upgrade(db) {
        db.createObjectStore('state');
        db.createObjectStore('journal');
      },
    });
    const library = new MediaLibraryStore(store, db);
    try {
      await library.lock(async () => {
        await store.root.getDirectoryHandle('media-library', { create: true });
        await store.root.getDirectoryHandle('media-trash', { create: true });
        await library.recover();
      });
    } catch (error) {
      db.close();
      throw error;
    }
    return library;
  }
  async close() {
    this.closing = true;
    await Promise.allSettled([...this.operations]);
    this.db.close();
  }
  private lock<T>(work: () => Promise<T>) {
    invariant(!this.closing, 'DISPOSED', 'Media library disposed.');
    const operation = this.store.lock('media-library', 'exclusive', work);
    this.operations.add(operation);
    void operation
      .finally(() => this.operations.delete(operation))
      .catch(() => {});
    return operation;
  }
  private async state(): Promise<LibrarySnapshot> {
    return (
      ((await this.db.get('state', 'current')) as
        LibrarySnapshot | undefined) ?? { revision: 0, entries: [] }
    );
  }
  private async parent(path: string, create = false) {
    const parts = path.split('/');
    const name = parts.pop()!;
    let directory = this.store.root;
    for (const part of parts)
      directory = await directory.getDirectoryHandle(part, { create });
    return { directory, name };
  }
  private async remove(path: string) {
    try {
      const { directory, name } = await this.parent(path);
      await directory.removeEntry(name, { recursive: true });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e;
    }
  }
  private async copyFile(source: Blob, path: string) {
    const { directory, name } = await this.parent(path, true);
    const writer = await (
      await directory.getFileHandle(name, { create: true })
    ).createWritable();
    await source.stream().pipeTo(writer);
  }
  private async copy(from: string, to: string, kind: LibraryEntry['kind']) {
    const source = await this.parent(from),
      target = await this.parent(to, true);
    if (kind === 'asset') {
      await this.copyFile(
        await (await source.directory.getFileHandle(source.name)).getFile(),
        to,
      );
    } else {
      const directory = await source.directory.getDirectoryHandle(source.name);
      await target.directory.getDirectoryHandle(target.name, { create: true });
      for await (const [name, handle] of directory.entries())
        await this.copy(
          `${from}/${name}`,
          `${to}/${name}`,
          handle.kind === 'directory' ? 'folder' : 'asset',
        );
    }
  }
  private async bytes(
    path: string,
    kind: LibraryEntry['kind'],
  ): Promise<number> {
    const { directory, name } = await this.parent(path);
    if (kind === 'asset')
      return (await (await directory.getFileHandle(name)).getFile()).size;
    let size = 0;
    for await (const [child, handle] of (
      await directory.getDirectoryHandle(name)
    ).entries())
      size += await this.bytes(
        `${path}/${child}`,
        handle.kind === 'directory' ? 'folder' : 'asset',
      );
    return size;
  }
  private async recover() {
    const pending = (await this.db.get('journal', 'pending')) as
      Mutation | undefined;
    if (!pending) return;
    if (pending.published) {
      if (pending.removeSource && pending.from) await this.remove(pending.from);
    } else if (!pending.replace) await this.remove(pending.to);
    await this.db.delete('journal', 'pending');
  }
  private async mutate(
    next: LibrarySnapshot,
    mutation: Mutation,
    write: () => Promise<void>,
    size: number,
  ) {
    // The journal is durable before touching any named library file.
    await this.db.put('journal', mutation, 'pending');
    try {
      await withQuotaRecovery(
        this.store,
        size,
        new AbortController().signal,
        async () => {
          if (!mutation.replace) await this.remove(mutation.to);
          try {
            await write();
          } catch (e) {
            if (!mutation.replace) await this.remove(mutation.to);
            throw e;
          }
        },
      );
      const tx = this.db.transaction(['state', 'journal'], 'readwrite');
      await tx.objectStore('state').put(next, 'current');
      await tx
        .objectStore('journal')
        .put({ ...mutation, published: true }, 'pending');
      await tx.done;
    } catch (e) {
      await this.recover();
      throw asEditorError(e);
    }
    // Publication is authoritative; cleanup can be retried after reopening.
    await this.recover().catch(() => {});
    return next;
  }
  private folder(state: LibrarySnapshot, id: string | null) {
    if (id === null) return;
    const folder = state.entries.find((entry) => entry.id === id);
    invariant(
      folder?.kind === 'folder' && !this.isTrashed(state, folder),
      'NOT_FOUND',
      'Destination folder is unavailable.',
    );
  }
  private isTrashed(state: LibrarySnapshot, entry: LibraryEntry): boolean {
    return (
      !!entry.trashed ||
      !!(
        entry.parentId &&
        this.isTrashed(
          state,
          state.entries.find((e) => e.id === entry.parentId)!,
        )
      )
    );
  }
  private importName(name: string) {
    const safeName = Array.from(name)
      .map((char) =>
        char === '/' || char === '\\' || char.charCodeAt(0) < 32 ? '_' : char,
      )
      .join('')
      .slice(0, 240);
    return safeName === '.' || safeName === '..' || !safeName.trim()
      ? 'media'
      : safeName;
  }
  private async add(
    state: LibrarySnapshot,
    asset: Asset,
    parentId: string | null = null,
  ) {
    const source = await this.store.file(asset.id);
    const entry: LibraryEntry = {
      id: crypto.randomUUID(),
      kind: 'asset',
      parentId,
      assetId: asset.id,
      sourceSignature: `${source.size}:${source.lastModified}`,
      name: availableLibraryName(
        state.entries,
        parentId,
        this.importName(asset.name),
      ),
    };
    const next = {
      revision: state.revision + 1,
      entries: [...state.entries, entry],
    };
    return this.mutate(
      next,
      {
        to: libraryPath(next.entries, entry.id),
        kind: 'asset',
        published: false,
        removeSource: false,
      },
      async () => this.copyFile(source, libraryPath(next.entries, entry.id)),
      asset.size,
    );
  }
  async list(): Promise<LibrarySnapshot> {
    return this.lock(async () => {
      await this.recover();
      let state = await this.state();
      const assets = (await this.store.db.getAll('assets')) as Asset[];
      for (const asset of assets) {
        if (asset.status !== 'ready') continue;
        await this.store.lock(`asset:${asset.id}`, 'shared', async () => {
          const entries = state.entries.filter(
            (entry) => entry.assetId === asset.id,
          );
          if (!entries.length) {
            try {
              state = await this.add(state, asset);
            } catch (error) {
              if (asEditorError(error).code !== 'MISSING_ASSET') throw error;
            }
            return;
          }
          // Relinking an evicted original invalidates every named library copy.
          let source: File;
          try {
            source = await this.store.file(asset.id);
          } catch {
            return;
          }
          const signature = `${source.size}:${source.lastModified}`;
          for (const entry of entries)
            if (entry.sourceSignature !== signature) {
              const next = structuredClone(state);
              next.revision++;
              next.entries.find((e) => e.id === entry.id)!.sourceSignature =
                signature;
              const to = libraryPath(next.entries, entry.id);
              state = await this.mutate(
                next,
                {
                  to,
                  kind: 'asset',
                  published: false,
                  removeSource: false,
                  replace: true,
                },
                () => this.copyFile(source, to),
                source.size,
              );
            }
        });
      }
      return state;
    });
  }
  async apply(operation: LibraryOperation, expectedRevision: number) {
    const parsed = libraryOperationSchema.safeParse(operation);
    invariant(
      parsed.success,
      'INVALID_COMMAND',
      'Invalid library operation or filename.',
    );
    operation = parsed.data;
    return this.lock(() => this.applyUnlocked(operation, expectedRevision));
  }
  private async applyUnlocked(
    operation: LibraryOperation,
    expectedRevision: number,
  ) {
    await this.recover();
    const state = await this.state();
    invariant(
      state.revision === expectedRevision,
      'REVISION_CONFLICT',
      'Media changed. Refresh and try again.',
    );
    const next = structuredClone(state);
    next.revision++;
    if (operation.type === 'create') {
      this.folder(state, operation.parentId);
      invariant(
        !state.entries.some(
          (entry) =>
            !entry.trashed &&
            entry.parentId === operation.parentId &&
            entry.name === operation.name,
        ),
        'INVALID_COMMAND',
        'A file or folder with that name already exists.',
      );
      const entry: LibraryEntry = {
        id: crypto.randomUUID(),
        name: operation.name,
        kind: 'folder',
        parentId: operation.parentId,
      };
      next.entries.push(entry);
      const to = libraryPath(next.entries, entry.id);
      return this.mutate(
        next,
        { to, kind: 'folder', published: false, removeSource: false },
        async () => {
          const { directory, name } = await this.parent(to, true);
          await directory.getDirectoryHandle(name, { create: true });
        },
        0,
      );
    }
    const entry = next.entries.find((entry) => entry.id === operation.entryId);
    invariant(entry, 'NOT_FOUND', 'Library entry no longer exists.');
    const from = libraryPath(state.entries, entry.id);
    if (operation.type === 'restore') {
      invariant(
        entry.trashed,
        'INVALID_COMMAND',
        'Choose a top-level Trash item to restore.',
      );
      entry.trashed = false;
      const oldParent = state.entries.find(
        (e) => e.id === entry.previousParentId,
      );
      entry.parentId =
        oldParent && !this.isTrashed(state, oldParent) ? oldParent.id : null;
      delete entry.previousParentId;
      entry.name = availableLibraryName(
        next.entries.filter((e) => e.id !== entry.id),
        entry.parentId,
        entry.name,
      );
    } else {
      invariant(
        !this.isTrashed(state, entry),
        'INVALID_COMMAND',
        'Restore this item before editing it.',
      );
      if (operation.type === 'trash') {
        entry.previousParentId = entry.parentId;
        entry.parentId = null;
        entry.trashed = true;
      }
      if (operation.type === 'rename')
        entry.name = libraryNameSchema.parse(operation.name);
      if (operation.type === 'move' || operation.type === 'copy') {
        this.folder(state, operation.parentId);
        invariant(
          !libraryDescendants(state.entries, entry.id).some(
            (e) => e.id === operation.parentId,
          ),
          'INVALID_COMMAND',
          'A folder cannot be placed inside itself.',
        );
        entry.parentId = operation.parentId;
        if (operation.type === 'move' && operation.name)
          entry.name = operation.name;
      }
      if (operation.type === 'copy') {
        const descendants = libraryDescendants(state.entries, entry.id);
        const ids = new Map(
          descendants.map((e) => [e.id, crypto.randomUUID()]),
        );
        const copied = descendants.map((e) => ({
          ...e,
          id: ids.get(e.id)!,
          parentId: e.id === entry.id ? entry.parentId : ids.get(e.parentId!)!,
        }));
        copied[0]!.name = availableLibraryName(
          state.entries,
          entry.parentId,
          entry.name,
        );
        next.entries = [...state.entries, ...copied];
        const to = libraryPath(next.entries, copied[0]!.id);
        return this.mutate(
          next,
          { from, to, kind: entry.kind, published: false, removeSource: false },
          () => this.copy(from, to, entry.kind),
          await this.bytes(from, entry.kind),
        );
      }
      invariant(
        entry.trashed ||
          !next.entries.some(
            (e) =>
              e.id !== entry.id &&
              !e.trashed &&
              e.parentId === entry.parentId &&
              e.name === entry.name,
          ),
        'INVALID_COMMAND',
        'A file or folder with that name already exists.',
      );
    }
    const to = libraryPath(next.entries, entry.id);
    if (to === from) return state;
    return this.mutate(
      next,
      { from, to, kind: entry.kind, published: false, removeSource: true },
      () => this.copy(from, to, entry.kind),
      await this.bytes(from, entry.kind),
    );
  }
  async place(
    assetId: string | null,
    relativeDirectories: string[],
    parentId: string | null,
  ) {
    for (const name of relativeDirectories)
      invariant(
        libraryNameSchema.safeParse(name).success,
        'INVALID_COMMAND',
        'Invalid upload folder path.',
      );
    return this.lock(async () => {
      await this.recover();
      let state = await this.state();
      this.folder(state, parentId);
      for (const name of relativeDirectories) {
        const existing = state.entries.find(
          (e) => !e.trashed && e.parentId === parentId && e.name === name,
        );
        invariant(
          !existing || existing.kind === 'folder',
          'INVALID_COMMAND',
          'An upload folder conflicts with an existing file.',
        );
        if (existing) parentId = existing.id;
        else {
          state = await this.applyUnlocked(
            { type: 'create', name, parentId },
            state.revision,
          );
          parentId = state.entries.find(
            (e) => e.parentId === parentId && e.name === name,
          )!.id;
        }
      }
      if (assetId) {
        let entry = state.entries.find(
          (e) => e.assetId === assetId && !e.trashed,
        );
        if (!entry) {
          state = await this.add(
            state,
            await this.store.getAsset(assetId),
            parentId,
          );
          entry = state.entries.find((e) => e.assetId === assetId)!;
        }
        if (entry.parentId !== parentId) {
          const name = availableLibraryName(
            state.entries.filter((e) => e.id !== entry.id),
            parentId,
            this.importName((await this.store.getAsset(assetId)).name),
          );
          state = await this.applyUnlocked(
            { type: 'move', entryId: entry.id, parentId, name },
            state.revision,
          );
        }
      }
      return state;
    });
  }
  async file(entryId: string) {
    return this.lock(async () => {
      await this.recover();
      const state = await this.state(),
        entry = state.entries.find((e) => e.id === entryId);
      invariant(entry?.kind === 'asset', 'NOT_FOUND', 'Choose a media file.');
      const { directory, name } = await this.parent(
        libraryPath(state.entries, entryId),
      );
      return (await directory.getFileHandle(name)).getFile();
    });
  }
  async download(entryId: string): Promise<File> {
    return this.lock(async () => {
      await this.recover();
      const state = await this.state(),
        entry = state.entries.find((e) => e.id === entryId);
      invariant(entry, 'NOT_FOUND', 'Library entry no longer exists.');
      const path = libraryPath(state.entries, entryId);
      if (entry.kind === 'asset') {
        const { directory, name } = await this.parent(path);
        return (await directory.getFileHandle(name)).getFile();
      }
      const { Zip, ZipPassThrough } = await import('fflate');
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      const zip = new Zip((error, data) => {
        if (error) throw error;
        chunks.push(new Uint8Array(data));
      });
      for (const node of libraryDescendants(state.entries, entry.id)) {
        const nodePath = libraryPath(state.entries, node.id);
        const relative = nodePath.slice(path.length - entry.name.length);
        const part = new ZipPassThrough(
          relative + (node.kind === 'folder' ? '/' : ''),
        );
        zip.add(part);
        if (node.kind === 'asset') {
          const { directory, name } = await this.parent(nodePath);
          const reader = (await (await directory.getFileHandle(name)).getFile())
            .stream()
            .getReader();
          try {
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              part.push(value);
            }
          } finally {
            reader.releaseLock();
          }
        }
        part.push(new Uint8Array(), true);
      }
      zip.end();
      return new File(chunks, `${entry.name}.zip`, { type: 'application/zip' });
    });
  }
}
