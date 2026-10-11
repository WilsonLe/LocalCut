import type { Asset } from '../core/model';
import { invariant } from '../core/errors';
import { checkAbort } from '../services/jobs';
import type { Store } from './store';

export function sourceIdentity(asset: Asset, file: File) {
  return JSON.stringify([
    file.size,
    file.lastModified,
    asset.kind,
    asset.durationUs,
    asset.width,
    asset.height,
    asset.rotation,
    asset.videoCodec,
    asset.audioCodec,
    asset.sampleRate,
    asset.channels,
  ]);
}

export function validateThumbnailRequest(timesUs: number[], width: number) {
  invariant(
    timesUs.length <= 1000 &&
      timesUs.every((t) => Number.isSafeInteger(t) && t >= 0),
    'INVALID_COMMAND',
    'Invalid thumbnail times',
  );
  invariant(
    Number.isSafeInteger(width) && width > 0 && width <= 4096,
    'INVALID_COMMAND',
    'Invalid thumbnail width',
  );
}

export function thumbnailKey(asset: Asset, width: number, timeUs: number) {
  return `thumbnail-v1-${asset.id}-${width}-${asset.kind === 'image' ? 0 : timeUs}`;
}

/** Read display artifacts without loading codecs or creating generation tasks. */
export async function cachedThumbnails(
  store: Store,
  assetId: string,
  timesUs: number[],
  width: number,
  signal: AbortSignal,
) {
  validateThumbnailRequest(timesUs, width);
  return store.lock(
    `asset:${assetId}`,
    'shared',
    async () => {
      checkAbort(signal);
      const file = await store.file(assetId);
      const asset = await store.getAsset(assetId);
      invariant(
        asset.kind === 'image' || asset.videoCodec,
        'UNSUPPORTED_CODEC',
        'Asset has no video',
      );
      const source = sourceIdentity(asset, file);
      const results: { timeUs: number; blob: Blob }[] = [];
      for (const timeUs of timesUs) {
        checkAbort(signal);
        const id = thumbnailKey(asset, width, timeUs);
        const blob = await store.lock(
          `derivative:${id}`,
          'exclusive',
          () => store.cachedBlob(id, source),
          signal,
        );
        checkAbort(signal);
        if (!blob) return;
        results.push({ timeUs, blob });
      }
      checkAbort(signal);
      return results;
    },
    signal,
  );
}
