import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../../src/storage/store';
import type { Derivative } from '../../src/storage/store';

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const records = new Map<string, Derivative>();
  const files = new Map<string, Blob>();
  const journals = new Map<string, unknown>();
  const store = Object.assign(Object.create(Store.prototype) as Store, {
    namespace: 'cache-unit',
    db: {
      get: async (_table: string, id: string) => records.get(id),
      getAll: async () => [...records.values()],
      put: async (_table: string, record: Derivative) =>
        records.set(record.id, record),
      delete: async (_table: string, id: string) => records.delete(id),
    },
  });
  store.lock = async (_key, _mode, work) => work();
  store.evict = async () => {};
  store.file = async (path) => {
    const blob = files.get(path);
    if (!blob) throw new Error('missing');
    return new File([blob], path);
  };
  store.write = async (path, blob) => {
    files.set(path, blob as Blob);
  };
  store.remove = async (path) => {
    files.delete(path);
  };
  store.journal = async (journal) => {
    journals.set(journal.id, journal);
  };
  store.finishJournal = async (id) => {
    journals.delete(id);
  };
  return { store, records, files, journals };
}

describe('persistent disposable derivatives', () => {
  it('round trips values and content type, rejecting source changes and same-size corruption', async () => {
    const { store, files, records } = fixture();
    const blob = new Blob([new Float32Array([0.25, 0.75]).buffer], {
      type: 'application/octet-stream',
    });
    const save = () =>
      store.saveCachedBlob(
        'peaks',
        'audio',
        'waveform',
        'source-v1',
        blob,
        new AbortController().signal,
      );
    await save();
    const hit = (await store.cachedBlob('peaks', 'source-v1'))!;
    expect(hit.type).toBe(blob.type);
    expect([...new Float32Array(await hit.arrayBuffer())]).toEqual([
      0.25, 0.75,
    ]);
    expect(await store.cachedBlob('peaks', 'source-v2')).toBeUndefined();
    expect(records.size).toBe(0);
    expect(files.size).toBe(0);
    await save();
    files.set('cache-peaks', new Blob([new Float32Array([0.9, 0.1]).buffer]));
    expect(await store.cachedBlob('peaks', 'source-v1')).toBeUndefined();
    expect(records.size).toBe(0);
  });

  it('reads a valid cache even when LRU writes are denied and rebuilds when cleanup is denied', async () => {
    const { store, records } = fixture();
    await store.saveCachedBlob(
      'tile',
      'image',
      'thumbnail',
      'source',
      new Blob(['pixels']),
      new AbortController().signal,
    );
    const put = vi
      .spyOn(store.db, 'put')
      .mockRejectedValue(new DOMException('full', 'QuotaExceededError'));
    expect(await (await store.cachedBlob('tile', 'source'))!.text()).toBe(
      'pixels',
    );
    put.mockRestore();
    vi.spyOn(store, 'remove').mockRejectedValue(new Error('denied'));
    vi.spyOn(store.db, 'delete').mockRejectedValue(new Error('denied'));
    expect(await store.cachedBlob('tile', 'changed-source')).toBeUndefined();
    expect(records.has('tile')).toBe(true);
  });

  it('rebuilds missing files and ignores legacy records without integrity/source identity', async () => {
    const { store, files, records } = fixture();
    await store.saveCachedBlob(
      'tile',
      'image',
      'thumbnail',
      'source',
      new Blob(['pixels']),
      new AbortController().signal,
    );
    files.clear();
    expect(await store.cachedBlob('tile', 'source')).toBeUndefined();
    records.set('legacy', {
      id: 'legacy',
      assetId: 'image',
      path: 'cache-legacy',
      size: 6,
      accessed: 0,
      kind: 'thumbnail',
    });
    files.set('cache-legacy', new Blob(['pixels']));
    expect(await store.cachedBlob('legacy', 'source')).toBeUndefined();
    expect(files.size).toBe(0);
  });

  it('retries quota writes once without recomputing, then leaves computed previews usable', async () => {
    const { store, records, files, journals } = fixture();
    const evict = vi.spyOn(store, 'evict');
    const write = vi
      .spyOn(store, 'write')
      .mockRejectedValue(new DOMException('full', 'QuotaExceededError'));
    await expect(
      store.saveCachedBlob(
        'tile',
        'image',
        'thumbnail',
        'source',
        new Blob(['pixels']),
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledTimes(2);
    expect(evict.mock.calls.map(([reserve]) => reserve)).toEqual([6, Infinity]);
    expect(records.size).toBe(0);
    expect(files.size).toBe(0);
    expect(journals.size).toBe(0);
  });

  it('cancellation removes a just-written derivative and its journal', async () => {
    const { store, files, records, journals } = fixture();
    const controller = new AbortController();
    store.write = async (path, blob) => {
      files.set(path, blob as Blob);
      controller.abort();
    };
    await expect(
      store.saveCachedBlob(
        'tile',
        'image',
        'thumbnail',
        'source',
        new Blob(['pixels']),
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(files.size).toBe(0);
    expect(records.size).toBe(0);
    expect(journals.size).toBe(0);
  });

  it('relink invalidation removes all selected source derivatives and preserves other assets', async () => {
    const { store, records, files } = fixture();
    for (const [id, asset] of [
      ['pcm', 'audio'],
      ['peaks', 'audio'],
      ['tile', 'other'],
    ])
      await store.saveCachedBlob(
        id!,
        asset!,
        id!,
        'source',
        new Blob(['data']),
        new AbortController().signal,
      );
    await store.invalidateDerivatives('audio');
    expect([...records.keys()]).toEqual(['tile']);
    expect([...files.keys()]).toEqual(['cache-tile']);
  });
  it('evicts display derivatives within the shared budget, skipping active assets and preserving originals', async () => {
    const { store, records, files } = fixture();
    files.set('original', new Blob(['original media']));
    for (const [id, assetId, accessed] of [
      ['peaks', 'pinned', 1],
      ['tile', 'idle', 2],
      ['sheet', 'idle', 3],
    ] as const) {
      records.set(id, {
        id,
        assetId,
        accessed,
        path: 'cache-' + id,
        size: 8,
        kind: id,
      });
      files.set('cache-' + id, new Blob(['12345678']));
    }
    vi.stubGlobal('navigator', {
      storage: { estimate: async () => ({ quota: 24, usage: 24 }) },
      locks: {
        request: async (
          name: string,
          _options: unknown,
          work: (lock: object | null) => Promise<void>,
        ) => work(name.endsWith(':asset:pinned') ? null : {}),
      },
    });
    await Store.prototype.evict.call(store, 16);
    expect([...records.keys()]).toEqual(['peaks']);
    expect([...files.keys()]).toEqual(['original', 'cache-peaks']);
  });
});
