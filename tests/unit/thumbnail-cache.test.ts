import { describe, expect, it, vi } from 'vitest';
import {
  cachedThumbnails,
  sourceIdentity,
} from '../../src/storage/thumbnail-cache';
import type { Store } from '../../src/storage/store';
import type { Asset } from '../../src/core/model';

function fixture(kind = 'image') {
  const asset = {
    id: 'asset',
    kind,
    width: 32,
    height: 16,
    videoCodec: kind === 'video' ? 'vp9' : undefined,
  } as Asset;
  const file = new File(['source'], 'asset', { lastModified: 1 });
  const read = vi.fn(
    async (id: string, source: string): Promise<Blob | undefined> => {
      expect(id).toContain('thumbnail-v1-');
      expect(source).toBe(sourceIdentity(asset, file));
      return new Blob(['pixels']);
    },
  );
  const lock = vi.fn(
    async (_key: string, _mode: string, work: () => Promise<unknown>) => work(),
  );
  const store = {
    lock,
    file: async () => file,
    getAsset: async () => asset,
    cachedBlob: read,
  } as unknown as Store;
  return {
    store,
    asset,
    file,
    read,
    lock,
    signal: new AbortController().signal,
  };
}

describe('thumbnail cache lookup before scheduling', () => {
  it('returns reordered still-image times using the shared source and tile identity', async () => {
    const f = fixture();
    const result = await cachedThumbnails(
      f.store,
      'asset',
      [100, 0, 100],
      32,
      f.signal,
    );
    expect(result?.map((tile) => tile.timeUs)).toEqual([100, 0, 100]);
    expect(f.read.mock.calls).toEqual(
      Array.from({ length: 3 }, () => [
        'thumbnail-v1-asset-32-0',
        sourceIdentity(f.asset, f.file),
      ]),
    );
    expect(f.lock.mock.calls.map(([key, mode]) => [key, mode])).toEqual([
      ['asset:asset', 'shared'],
      ...Array.from({ length: 3 }, () => [
        'derivative:thumbnail-v1-asset-32-0',
        'exclusive',
      ]),
    ]);
  });

  it('treats an incomplete video batch as a miss', async () => {
    const f = fixture('video');
    f.read
      .mockResolvedValueOnce(new Blob(['pixels']))
      .mockResolvedValueOnce(undefined);
    expect(
      await cachedThumbnails(f.store, 'asset', [0, 100], 64, f.signal),
    ).toBeUndefined();
    expect(f.read.mock.calls.map(([id]) => id)).toEqual([
      'thumbnail-v1-asset-64-0',
      'thumbnail-v1-asset-64-100',
    ]);
  });

  it('rejects invalid requests before reading storage', async () => {
    const f = fixture();
    for (const [times, width] of [
      [[0], 0],
      [[-1], 32],
      [[0.5], 32],
    ] as const) {
      await expect(
        cachedThumbnails(f.store, 'asset', [...times], width, f.signal),
      ).rejects.toMatchObject({ code: 'INVALID_COMMAND' });
    }
    expect(f.lock).not.toHaveBeenCalled();
  });

  it('returns no work for an empty valid request and rejects audio', async () => {
    const f = fixture();
    expect(await cachedThumbnails(f.store, 'asset', [], 32, f.signal)).toEqual(
      [],
    );
    expect(f.read).not.toHaveBeenCalled();
    const audio = fixture('audio');
    await expect(
      cachedThumbnails(audio.store, 'asset', [0], 32, audio.signal),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CODEC' });
  });

  it('does not return a cache hit or miss after cancellation during a read', async () => {
    for (const result of [new Blob(['pixels']), undefined]) {
      const f = fixture();
      const controller = new AbortController();
      f.read.mockImplementation(async () => {
        controller.abort();
        return result;
      });
      await expect(
        cachedThumbnails(f.store, 'asset', [0], 32, controller.signal),
      ).rejects.toMatchObject({ code: 'CANCELLED' });
    }
  });
});
