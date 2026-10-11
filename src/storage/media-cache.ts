import type { Store } from './store';
import type { TaskCachePolicy } from '../services/task-cache';
import { taskCacheKey } from '../services/task-cache';
import { invariant } from '../core/errors';
import { checkAbort } from '../services/jobs';
import {
  cachedThumbnails,
  sourceIdentity,
  validateThumbnailRequest,
} from './thumbnail-cache';

export async function contactSheetKey(
  assetId: string,
  timesUs: number[],
  width: number,
) {
  validateThumbnailRequest(timesUs, width);
  invariant(
    timesUs.length > 0,
    'INVALID_COMMAND',
    'Contact sheet needs valid timestamps',
  );
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify([width, timesUs])),
  );
  return `contact-sheet-v1-${assetId}-${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function validateWaveformBins(bins: number) {
  invariant(
    Number.isInteger(bins) && bins > 0 && bins <= 100000,
    'INVALID_COMMAND',
    'Invalid waveform bins',
  );
}

export type MediaCacheKind =
  | 'media.thumbnails'
  | 'media.contactSheet'
  | 'media.waveform'
  | 'media.derivative';
/** Persistent artifact verification precedes queue admission. Queue completion
 * cannot resurrect a derivative removed by relink, corruption or eviction. */
export function mediaTaskCache(
  store: Store,
  kind: MediaCacheKind,
): TaskCachePolicy {
  const args = (input: unknown) =>
    input as [string, number[] | number | 'pcm' | 'proxy' | undefined, number?];
  const validate = (input: unknown) => {
    const [, request, width = 320] = args(input);
    if (kind === 'media.thumbnails')
      validateThumbnailRequest(request as number[], width);
    if (kind === 'media.waveform')
      validateWaveformBins((request as number | undefined) ?? 1000);
    if (kind === 'media.derivative')
      invariant(
        request === 'pcm' || request === 'proxy',
        'INVALID_COMMAND',
        'Invalid derivative kind',
      );
  };
  return {
    mode: 'reuse',
    version: 'media-artifacts-v1',
    reuseCompleted: false,
    key: async (input, signal) => {
      validate(input);
      const [assetId, request, width = 320] = args(input);
      if (kind === 'media.contactSheet')
        await contactSheetKey(assetId, request as number[], width);
      return store.lock(
        `asset:${assetId}`,
        'shared',
        async () => {
          checkAbort(signal);
          const asset = await store.getAsset(assetId),
            file = await store.file(assetId);
          const normalized =
            kind === 'media.waveform'
              ? [assetId, request ?? 1000]
              : kind === 'media.derivative'
                ? [assetId, request]
                : [assetId, request, width];
          return taskCacheKey([sourceIdentity(asset, file), normalized]);
        },
        signal,
      );
    },
    read: async (input, signal) => {
      validate(input);
      const [assetId, request, width = 320] = args(input);
      if (kind === 'media.thumbnails') {
        if (!(request as number[]).length) return { value: [] };
        const value = await cachedThumbnails(
          store,
          assetId,
          request as number[],
          width,
          signal,
        );
        return value ? { value } : undefined;
      }
      return store.lock(
        `asset:${assetId}`,
        'shared',
        async () => {
          checkAbort(signal);
          const asset = await store.getAsset(assetId),
            file = await store.file(assetId);
          const source = sourceIdentity(asset, file);
          const bins = (request as number | undefined) ?? 1000;
          const id =
            kind === 'media.contactSheet'
              ? await contactSheetKey(assetId, request as number[], width)
              : kind === 'media.waveform'
                ? `waveform-v1-${assetId}-${bins}`
                : `${request}-v1-${assetId}`;
          return store.lock(
            `derivative:${id}`,
            'exclusive',
            async () => {
              if (kind === 'media.derivative') {
                const record = await store.derivative(id);
                if (!record || record.source !== source) return;
                try {
                  const value = await store.file(record.path);
                  checkAbort(signal);
                  if (value.size === record.size) return { value };
                } catch {
                  checkAbort(signal);
                }
                return;
              }
              const blob = await store.cachedBlob(id, source);
              checkAbort(signal);
              if (!blob) return;
              if (kind === 'media.contactSheet')
                return { value: { blob, timesUs: request } };
              if (blob.size !== bins * 4) return;
              const value = new Float32Array(await blob.arrayBuffer());
              checkAbort(signal);
              if (value.every((peak) => Number.isFinite(peak) && peak >= 0))
                return { value };
            },
            signal,
          );
        },
        signal,
      );
    },
  };
}
