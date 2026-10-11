import { withQuotaRecovery } from '../storage/quota';
import { commitWithSignal } from '../storage/transaction';
import {
  Input,
  BlobSource,
  MP4,
  QTFF,
  WEBM,
  MP3,
  WAVE,
  VideoSampleSink,
  AudioSampleSink,
  Conversion,
  Output,
  WavOutputFormat,
  WebMOutputFormat,
  StreamTarget,
} from 'mediabunny';
import type { StreamTargetChunk } from 'mediabunny';
import type { Asset } from '../core/model';
import { EditorError, invariant } from '../core/errors';
import { checkAbort } from '../services/jobs';
import type { Progress } from '../services/jobs';
import type { Store } from '../storage/store';
import { contactSheetKey, validateWaveformBins } from '../storage/media-cache';
import {
  sourceIdentity,
  thumbnailKey,
  validateThumbnailRequest,
} from '../storage/thumbnail-cache';
export const inputFormats = [MP4, QTFF, WEBM, MP3, WAVE];
export function inputFile(file: Blob) {
  return new Input({ source: new BlobSource(file), formats: inputFormats });
}
export async function inspect(
  file: Blob,
  name: string,
  id: string = crypto.randomUUID(),
): Promise<Asset> {
  const signature = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const matches = (offset: number, bytes: number[]) =>
    bytes.every((value, index) => signature[offset + index] === value);
  const imageType = matches(0, [137, 80, 78, 71, 13, 10, 26, 10])
    ? 'image/png'
    : matches(0, [255, 216, 255])
      ? 'image/jpeg'
      : matches(0, [82, 73, 70, 70]) && matches(8, [87, 69, 66, 80])
        ? 'image/webp'
        : undefined;
  if (imageType || file.type.startsWith('image/')) {
    invariant(imageType, 'UNSUPPORTED_CODEC', 'Unsupported image');
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new EditorError('UNSUPPORTED_CODEC', 'Cannot decode image', {
        format: imageType,
      });
    }
    const asset: Asset = {
      id,
      name,
      kind: 'image',
      size: file.size,
      type: imageType,
      durationUs: 0,
      width: bitmap.width,
      height: bitmap.height,
      rotation: 0,
      status: 'ready',
    };
    bitmap.close();
    return asset;
  }
  const input = inputFile(file);
  try {
    const videos = await input.getVideoTracks(),
      audios = await input.getAudioTracks();
    invariant(
      videos.length <= 1 && audios.length <= 1,
      'AMBIGUOUS_STREAM',
      'Import requires at most one video and one audio stream',
    );
    const video = videos[0],
      audio = audios[0];
    invariant(video || audio, 'UNSUPPORTED_CODEC', 'No supported media stream');
    for (const track of [...videos, ...audios])
      invariant(
        await track.canDecode(),
        'UNSUPPORTED_CODEC',
        `Cannot decode ${track.codec}`,
      );
    const durationUs = Math.round((await input.computeDuration()) * 1e6);
    invariant(durationUs > 0, 'INVALID_DOCUMENT', 'Media has no duration');
    return {
      id,
      name,
      kind: video ? 'video' : 'audio',
      size: file.size,
      type: file.type,
      durationUs,
      width: video ? await video.getDisplayWidth() : 0,
      height: video ? await video.getDisplayHeight() : 0,
      rotation: video ? await video.getRotation() : 0,
      frameRate: video
        ? (await video.computePacketStats(120)).averagePacketRate
        : undefined,
      videoCodec: video?.codec ?? undefined,
      audioCodec: audio?.codec ?? undefined,
      sampleRate: audio ? await audio.getSampleRate() : undefined,
      channels: audio ? await audio.getNumberOfChannels() : undefined,
      status: 'ready',
    };
  } finally {
    input.dispose();
  }
}
export async function importAsset(
  store: Store,
  file: Blob,
  name: string,
  signal: AbortSignal,
  progress: (p: Progress) => void,
  jobId: string,
  relinkId?: string,
) {
  checkAbort(signal);
  progress({ stage: 'inspect', progress: 0 });
  const asset = await inspect(file, name, relinkId);
  if (relinkId) {
    const existing = await store.getAsset(relinkId);
    invariant(
      existing.size === asset.size &&
        existing.kind === asset.kind &&
        existing.durationUs === asset.durationUs,
      'INVALID_DOCUMENT',
      'Replacement does not match source metadata',
    );
  }
  return withQuotaRecovery(store, file.size, signal, () =>
    store.lock(
      `asset:${asset.id}`,
      'exclusive',
      () =>
        store.lock(
          `job:${jobId}`,
          'exclusive',
          async () => {
            if (relinkId) {
              let exists = true;
              try {
                await store.file(relinkId);
              } catch {
                exists = false;
              }
              invariant(
                !exists,
                'INVALID_COMMAND',
                'Ready originals cannot be replaced',
              );
              // Conservative invalidation also covers replacement with identical metadata.
              await store.invalidateDerivatives(relinkId);
              const { AssetIndexStore } =
                await import('../storage/asset-index');
              const index = await AssetIndexStore.open(store.namespace);
              try {
                await index.invalidate(relinkId);
              } finally {
                index.close();
              }
            }
            await store.journal({
              id: jobId,
              target: asset.id,
              kind: 'import',
            });
            try {
              progress({ stage: 'store', progress: 0.3 });
              await store.write(
                asset.id,
                file.stream().pipeThrough(
                  new TransformStream({
                    transform(chunk, controller) {
                      checkAbort(signal);
                      controller.enqueue(chunk);
                    },
                  }),
                ),
              );
              checkAbort(signal);
              const tx = store.db.transaction(
                ['assets', 'journal'],
                'readwrite',
              );
              await commitWithSignal(tx, signal, async () => {
                await tx.objectStore('assets').put(asset);
                await tx.objectStore('journal').put({
                  id: jobId,
                  target: asset.id,
                  kind: 'import',
                  committed: true,
                });
              });
              // Recovery can remove a committed journal if cleanup is interrupted.
              await store.finishJournal(jobId).catch(() => {});
              progress({ stage: 'ready', progress: 1 });
              return asset;
            } catch (e) {
              await store.remove(asset.id);
              await store.finishJournal(jobId);
              throw e;
            }
          },
          signal,
        ),
      signal,
    ),
  );
}
export async function outputTarget(store: Store, path: string) {
  const file = await store.root.getFileHandle(path, { create: true }),
    writer = await file.createWritable();
  let closed = false;
  const writable = new WritableStream<StreamTargetChunk>({
    write: (chunk) =>
      writer.write({
        type: 'write',
        position: chunk.position,
        data: chunk.data,
      }),
    close: async () => {
      closed = true;
      await writer.close();
    },
    abort: async () => {
      closed = true;
      await writer.abort();
    },
  });
  return {
    target: new StreamTarget(writable, {
      chunked: true,
      chunkSize: 1024 * 1024,
    }),
    close: async () => {
      if (!closed) {
        closed = true;
        await writer.close();
      }
    },
    abort: async () => {
      if (!closed) {
        closed = true;
        await writer.abort().catch(() => {});
      }
    },
  };
}
export async function convertCache(
  store: Store,
  assetId: string,
  kind: 'pcm' | 'proxy',
  signal: AbortSignal,
  progress: (p: Progress) => void,
  jobId: string,
) {
  const cached = await store.derivative(`${kind}-v1-${assetId}`);
  const asset = await store.getAsset(assetId);
  const reserve = cached
    ? 0
    : Math.ceil(
        (asset.durationUs / 1e6) *
          (kind === 'pcm' ? 48000 * 2 * 4 : 2_128_000 / 8) *
          1.1,
      ) +
      1024 * 1024;
  return withQuotaRecovery(store, reserve, signal, () =>
    convertCacheAttempt(store, assetId, kind, signal, progress, jobId),
  );
}
async function convertCacheAttempt(
  store: Store,
  assetId: string,
  kind: 'pcm' | 'proxy',
  signal: AbortSignal,
  progress: (p: Progress) => void,
  jobId: string,
) {
  const id = `${kind}-v1-${assetId}`;
  return store.lock(
    `derivative:${id}`,
    'exclusive',
    async () => {
      checkAbort(signal);
      const asset = await store.getAsset(assetId);
      const original = await store.file(assetId);
      const source = sourceIdentity(asset, original);
      const old = await store.derivative(id);
      if (old) {
        try {
          const file = await store.file(old.path);
          if (old.source === source && file.size === old.size) return file;
        } catch {
          // Rebuild a missing disposable file.
        }
        await store.remove(old.path);
        await store.db.delete('derivatives', id);
      }
      invariant(
        kind === 'pcm' ? asset.audioCodec : asset.videoCodec,
        'UNSUPPORTED_CODEC',
        `Asset has no ${kind === 'pcm' ? 'audio' : 'video'}`,
      );
      const input = inputFile(original),
        path = `cache-${id}`;
      let target: Awaited<ReturnType<typeof outputTarget>> | undefined;
      let conversion: Conversion | undefined;
      return store.lock(
        `job:${jobId}`,
        'exclusive',
        async () => {
          await store.journal({ id: jobId, target: path, kind: 'derivative' });
          const cancel = () => {
            void conversion?.cancel();
          };
          signal.addEventListener('abort', cancel, { once: true });
          try {
            target = await outputTarget(store, path);
            const output = new Output({
              format:
                kind === 'pcm' ? new WavOutputFormat() : new WebMOutputFormat(),
              target: target.target,
            });
            conversion = await Conversion.init({
              input,
              output,
              tracks: 'primary',
              copy: false,
              showWarnings: false,
              video:
                kind === 'pcm'
                  ? { discard: true }
                  : {
                      height: Math.min(720, asset.height),
                      codec: 'vp9',
                      bitrate: 2_000_000,
                    },
              audio:
                kind === 'pcm'
                  ? { codec: 'pcm-f32', sampleRate: 48000, numberOfChannels: 2 }
                  : { codec: 'opus', sampleRate: 48000, numberOfChannels: 2 },
            });
            invariant(
              conversion.isValid,
              'UNSUPPORTED_CODEC',
              'Cannot generate derivative',
            );
            const lost = conversion.discardedTracks.filter((t) =>
              kind === 'pcm'
                ? t.track.isAudioTrack()
                : t.track.isAudioTrack() || t.track.isVideoTrack(),
            );
            invariant(
              !lost.length,
              'UNSUPPORTED_CODEC',
              'Derivative would drop required stream',
            );
            conversion.onProgress = (v) => {
              checkAbort(signal);
              progress({ stage: kind, progress: v });
            };
            checkAbort(signal);
            await conversion.execute();
            checkAbort(signal);
            await target.close();
            const file = await store.file(path);
            await store.cache({
              id,
              assetId,
              path,
              size: file.size,
              accessed: Date.now(),
              kind,
              source,
            });
            await store.finishJournal(jobId);
            return file;
          } catch (e) {
            await conversion?.cancel().catch(() => {});
            await target?.abort();
            await store.remove(path);
            await store.finishJournal(jobId);
            throw e;
          } finally {
            signal.removeEventListener('abort', cancel);
            input.dispose();
          }
        },
        signal,
      );
    },
    signal,
  );
}
export async function thumbnails(
  store: Store,
  assetId: string,
  timesUs: number[],
  signal: AbortSignal,
  width = 320,
) {
  validateThumbnailRequest(timesUs, width);
  return store.lock(
    `asset:${assetId}`,
    'shared',
    async () => {
      checkAbort(signal);
      const file = await store.file(assetId),
        asset = await store.getAsset(assetId);
      return thumbnailTiles(store, asset, file, timesUs, signal, width);
    },
    signal,
  );
}
// Both callers hold one original lease; never reacquire it behind a queued relink.
async function thumbnailTiles(
  store: Store,
  asset: Asset,
  file: File,
  timesUs: number[],
  signal: AbortSignal,
  width: number,
) {
  const assetId = asset.id;
  invariant(
    asset.kind === 'image' || asset.videoCodec,
    'UNSUPPORTED_CODEC',
    'Asset has no video',
  );
  const source = sourceIdentity(asset, file);
  const height = Math.max(1, Math.round((width * asset.height) / asset.width));
  const results: { timeUs: number; blob: Blob }[] = [];
  // Open a native decoder only after a cache miss, and reuse it within this batch.
  let input: Input | undefined, sink: VideoSampleSink | undefined;
  let firstTimestamp = 0;
  try {
    for (const timeUs of timesUs) {
      checkAbort(signal);
      // Still-image pixels do not depend on the requested presentation timestamp.
      const id = thumbnailKey(asset, width, timeUs);
      const blob = await store.lock(
        `derivative:${id}`,
        'exclusive',
        async () => {
          const cached = await store.cachedBlob(id, source);
          checkAbort(signal);
          if (cached) return cached;
          const canvas = new OffscreenCanvas(width, height),
            ctx = canvas.getContext('2d')!;
          if (asset.kind === 'image') {
            const bitmap = await createImageBitmap(file);
            try {
              ctx.drawImage(bitmap, 0, 0, width, height);
            } finally {
              bitmap.close();
            }
          } else {
            if (!input) {
              input = inputFile(file);
              const track = await input.getPrimaryVideoTrack();
              invariant(track, 'UNSUPPORTED_CODEC', 'Asset has no video');
              sink = new VideoSampleSink(track);
              firstTimestamp = await track.getFirstTimestamp();
            }
            // Camera/recording containers may begin after timestamp zero.
            const sample = await sink!.getSample(
              Math.max(firstTimestamp, timeUs / 1e6),
            );
            invariant(sample, 'MISSING_ASSET', 'No frame at requested time');
            try {
              sample.draw(ctx, 0, 0, width, height);
            } finally {
              sample.close();
            }
          }
          checkAbort(signal);
          const blob = await canvas.convertToBlob({
            type: 'image/webp',
            quality: 0.8,
          });
          await store.saveCachedBlob(
            id,
            assetId,
            'thumbnail',
            source,
            blob,
            signal,
          );
          return blob;
        },
        signal,
      );
      checkAbort(signal);
      results.push({ timeUs, blob });
      await new Promise((r) => setTimeout(r, 0));
    }
    return results;
  } finally {
    input?.dispose();
  }
}

export async function contactSheet(
  store: Store,
  assetId: string,
  timesUs: number[],
  signal: AbortSignal,
  width = 320,
) {
  const id = await contactSheetKey(assetId, timesUs, width);
  return store.lock(
    `asset:${assetId}`,
    'shared',
    () =>
      store.lock(
        `derivative:${id}`,
        'exclusive',
        async () => {
          checkAbort(signal);
          const file = await store.file(assetId),
            asset = await store.getAsset(assetId);
          const source = sourceIdentity(asset, file);
          // A sheet hit also avoids regenerating any evicted individual tiles.
          const cached = await store.cachedBlob(id, source);
          checkAbort(signal);
          if (cached) return { blob: cached, timesUs };
          const items = await thumbnailTiles(
            store,
            asset,
            file,
            timesUs,
            signal,
            width,
          );
          const images: ImageBitmap[] = [];
          try {
            for (const item of items) {
              checkAbort(signal);
              images.push(await createImageBitmap(item.blob));
            }
            const columns = Math.ceil(Math.sqrt(items.length));
            const canvas = new OffscreenCanvas(
              columns * width,
              Math.ceil(items.length / columns) * images[0]!.height,
            );
            const ctx = canvas.getContext('2d')!;
            for (let i = 0; i < images.length; i++) {
              checkAbort(signal);
              ctx.drawImage(
                images[i]!,
                (i % columns) * width,
                Math.floor(i / columns) * images[0]!.height,
              );
            }
            const blob = await canvas.convertToBlob({ type: 'image/png' });
            await store.saveCachedBlob(
              id,
              assetId,
              'contact-sheet',
              source,
              blob,
              signal,
            );
            checkAbort(signal);
            return { blob, timesUs };
          } finally {
            for (const image of images) image.close();
          }
        },
        signal,
      ),
    signal,
  );
}
export async function pcmWindow(
  file: File,
  startFrame: number,
  count: number,
): Promise<Float32Array[]> {
  const input = inputFile(file),
    channels = [new Float32Array(count), new Float32Array(count)];
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return channels;
    const sink = new AudioSampleSink(track);
    for await (const sample of sink.samples(
      Math.max(0, startFrame / 48000),
      Math.max(0, (startFrame + count) / 48000),
    )) {
      try {
        const offset = Math.round(sample.timestamp * 48000) - startFrame;
        for (let channel = 0; channel < 2; channel++) {
          const data = new Float32Array(sample.numberOfFrames);
          sample.copyTo(data, {
            planeIndex: Math.min(channel, sample.numberOfChannels - 1),
            format: 'f32-planar',
          });
          const from = Math.max(0, -offset),
            to = Math.min(data.length, count - offset);
          if (to > from)
            channels[channel]!.set(
              data.subarray(from, to),
              Math.max(0, offset),
            );
        }
      } finally {
        sample.close();
      }
    }
    return channels;
  } finally {
    input.dispose();
  }
}
export async function waveform(
  store: Store,
  assetId: string,
  signal: AbortSignal,
  progress: (p: Progress) => void,
  jobId: string,
  bins = 1000,
) {
  validateWaveformBins(bins);
  return store.lock(
    `asset:${assetId}`,
    'shared',
    () => {
      const id = `waveform-v1-${assetId}-${bins}`;
      return store.lock(
        `derivative:${id}`,
        'exclusive',
        async () => {
          checkAbort(signal);
          const asset = await store.getAsset(assetId);
          const original = await store.file(assetId);
          const source = sourceIdentity(asset, original);
          const cached = await store.cachedBlob(id, source);
          checkAbort(signal);
          if (cached && cached.size === bins * 4) {
            const peaks = new Float32Array(await cached.arrayBuffer());
            if (peaks.every((value) => Number.isFinite(value) && value >= 0)) {
              progress({ stage: 'waveform-cache', progress: 1 });
              return peaks;
            }
          }
          const file = await convertCache(
            store,
            assetId,
            'pcm',
            signal,
            progress,
            jobId,
          );
          const total = Math.ceil((asset.durationUs * 48000) / 1e6),
            values = new Float32Array(bins);
          for (let start = 0; start < total; start += 48000) {
            checkAbort(signal);
            const data = await pcmWindow(
              file,
              start,
              Math.min(48000, total - start),
            );
            for (let i = 0; i < data[0]!.length; i++) {
              const bin = Math.min(
                bins - 1,
                Math.floor(((start + i) * bins) / total),
              );
              values[bin] = Math.max(
                values[bin]!,
                Math.abs(data[0]![i]!),
                Math.abs(data[1]![i]!),
              );
            }
            progress({
              stage: 'waveform',
              progress: Math.min(1, (start + 48000) / total),
            });
            await new Promise((r) => setTimeout(r, 0));
          }
          await store.saveCachedBlob(
            id,
            assetId,
            'waveform',
            source,
            new Blob([values.buffer], { type: 'application/octet-stream' }),
            signal,
          );
          checkAbort(signal);
          return values;
        },
        signal,
      );
    },
    signal,
  );
}
