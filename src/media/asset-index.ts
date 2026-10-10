import {
  VideoSampleSink,
  AudioSampleSink,
  WavOutputFormat,
  Conversion,
  Output,
  Mp4OutputFormat,
  BufferTarget,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  EncodedAudioPacketSource,
} from 'mediabunny';
import {
  measureFrame,
  selectScenes,
  selectAudioSegments,
} from '../core/asset-index';
import type {
  FrameMetrics,
  IndexScene,
  AudioMetrics,
} from '../core/asset-index';
import { invariant, asEditorError } from '../core/errors';
import { checkAbort } from '../services/jobs';
import type { Progress } from '../services/jobs';
import type { Store } from '../storage/store';
import { AssetIndexStore } from '../storage/asset-index';
import { inputFile } from './assets';
import { audioPrimingFrames } from './audio-priming';
import { normalizeAudioDecoderConfig } from './audio-config';

function size(width: number, height: number, longest: number, even = false) {
  const ratio = Math.min(1, longest / Math.max(width, height));
  const unit = even ? 2 : 1;
  return {
    width: Math.max(unit, Math.round((width * ratio) / unit) * unit),
    height: Math.max(unit, Math.round((height * ratio) / unit) * unit),
  };
}
export async function analyzeAsset(
  store: Store,
  assetId: string,
  runId: string,
  signal: AbortSignal,
  progress: (p: Progress) => void,
  retry = false,
) {
  const index = await AssetIndexStore.open(store.namespace);
  try {
    return await index.lock(
      `analysis:${assetId}`,
      () =>
        index.active(
          runId,
          () =>
            store.lock(
              `asset:${assetId}`,
              'shared',
              async () => {
                const asset = await store.getAsset(assetId);
                invariant(
                  asset.status === 'ready',
                  'INVALID_COMMAND',
                  'Indexing requires ready media',
                );
                const file = await store.file(assetId);
                let run = retry ? await index.get(runId) : undefined;
                if (run)
                  invariant(
                    run.assetId === assetId &&
                      !run.invalidated &&
                      run.source.lastModified === file.lastModified &&
                      run.source.size === file.size,
                    'MISSING_ASSET',
                    'Index source changed; start a new run',
                  );
                if (run?.status === 'complete') return run;
                if (!run) {
                  run = {
                    version: 1,
                    id: runId,
                    assetId,
                    createdAt: Date.now(),
                    source: {
                      size: file.size,
                      lastModified: file.lastModified,
                      kind: asset.kind,
                      width: asset.width,
                      height: asset.height,
                      durationUs: asset.durationUs,
                      hasAudio: asset.kind === 'audio' || !!asset.audioCodec,
                    },
                    status: 'analyzing',
                    invalidated: false,
                    analysis: {
                      version: 1,
                      settings: {
                        sampleRate: 4,
                        analysisWidth: 160,
                        cutThreshold: 0.45,
                        excerptUs: 4000000,
                        ...(asset.kind === 'audio'
                          ? {
                              audio: {
                                windowUs: 250000 as const,
                                silenceRms: 0.005 as const,
                                minSilenceUs: 500000 as const,
                                maxSegmentUs: 30000000 as const,
                              },
                            }
                          : {}),
                      },
                      frames: [],
                      scenes: [],
                      scanMs: 0,
                      generationMs: 0,
                    },
                    requests: [],
                  };
                  await index.create(run, signal);
                }
                try {
                  if (!run.analysis.scenes.length) {
                    const start = performance.now(),
                      dimensions = size(asset.width, asset.height, 160),
                      canvas = new OffscreenCanvas(
                        dimensions.width,
                        dimensions.height,
                      ),
                      ctx = canvas.getContext('2d', {
                        willReadFrequently: true,
                      })!;
                    const frames: FrameMetrics[] = [];
                    let previous: Uint8Array | undefined;
                    const measure = (timeUs: number) => {
                      const value = measureFrame(
                        ctx.getImageData(0, 0, canvas.width, canvas.height)
                          .data,
                        canvas.width,
                        canvas.height,
                        timeUs,
                        previous,
                      );
                      frames.push(value.metrics);
                      previous = value.luma;
                    };
                    let audio: AudioMetrics[] | undefined;
                    if (asset.kind === 'audio') {
                      audio = await scanAudio(
                        file,
                        asset.durationUs,
                        signal,
                        progress,
                      );
                    } else if (asset.kind === 'image') {
                      const bitmap = await createImageBitmap(file);
                      try {
                        ctx.drawImage(
                          bitmap,
                          0,
                          0,
                          canvas.width,
                          canvas.height,
                        );
                        measure(0);
                      } finally {
                        bitmap.close();
                      }
                    } else {
                      const input = inputFile(file);
                      try {
                        const track = await input.getPrimaryVideoTrack();
                        invariant(
                          track,
                          'UNSUPPORTED_CODEC',
                          'Video stream missing',
                        );
                        const sink = new VideoSampleSink(track);
                        function* times() {
                          for (let t = 0; t < asset.durationUs; t += 250000)
                            yield t / 1e6;
                        }
                        let requestedUs = 0;
                        for await (const sample of sink.samplesAtTimestamps(
                          times(),
                        )) {
                          checkAbort(signal);
                          if (sample) {
                            try {
                              sample.draw(
                                ctx,
                                0,
                                0,
                                canvas.width,
                                canvas.height,
                              );
                              measure(
                                Math.max(0, Math.round(sample.timestamp * 1e6)),
                              );
                            } finally {
                              sample.close();
                            }
                          }
                          requestedUs += 250000;
                          progress({
                            stage: 'scan',
                            progress: Math.min(
                              0.3,
                              (requestedUs / asset.durationUs) * 0.3,
                            ),
                          });
                          await new Promise((resolve) =>
                            setTimeout(resolve, 0),
                          );
                        }
                      } finally {
                        input.dispose();
                      }
                    }
                    invariant(
                      audio?.length ?? frames.length,
                      'UNSUPPORTED_CODEC',
                      'No frames available for indexing',
                    );
                    run = await index.update(
                      runId,
                      (r) => {
                        r.analysis.frames = frames;
                        r.analysis.audio = audio;
                        r.analysis.scenes = audio
                          ? selectAudioSegments(audio, asset.durationUs)
                          : selectScenes(
                              frames,
                              asset.durationUs,
                              asset.kind === 'image',
                            );
                        r.analysis.scanMs = performance.now() - start;
                      },
                      signal,
                    );
                  }
                  const generationStart = performance.now();
                  for (let i = 0; i < run.analysis.scenes.length; i++) {
                    const scene = run.analysis.scenes[i]!;
                    checkAbort(signal);
                    progress({
                      stage: 'generate',
                      progress: 0.3 + (0.65 * i) / run.analysis.scenes.length,
                    });
                    if (
                      asset.kind !== 'audio' &&
                      !scene.artifacts.some((a) => a.kind === 'image')
                    ) {
                      const dimensions = size(asset.width, asset.height, 768),
                        canvas = new OffscreenCanvas(
                          dimensions.width,
                          dimensions.height,
                        ),
                        ctx = canvas.getContext('2d')!;
                      if (asset.kind === 'image') {
                        const bitmap = await createImageBitmap(file);
                        try {
                          ctx.drawImage(
                            bitmap,
                            0,
                            0,
                            canvas.width,
                            canvas.height,
                          );
                        } finally {
                          bitmap.close();
                        }
                      } else {
                        const input = inputFile(file);
                        try {
                          const sample = await new VideoSampleSink(
                            (await input.getPrimaryVideoTrack())!,
                          ).getSample(scene.representativeUs / 1e6);
                          invariant(
                            sample,
                            'MISSING_ASSET',
                            'Representative frame missing',
                          );
                          try {
                            sample.draw(ctx, 0, 0, canvas.width, canvas.height);
                          } finally {
                            sample.close();
                          }
                        } finally {
                          input.dispose();
                        }
                      }
                      await index.publishFile(
                        runId,
                        scene.id,
                        await canvas.convertToBlob({
                          type: 'image/jpeg',
                          quality: 0.8,
                        }),
                        'image',
                        signal,
                      );
                    }
                    if (
                      asset.kind === 'audio' &&
                      !scene.artifacts.some((a) => a.kind === 'audio')
                    )
                      await index.publishFile(
                        runId,
                        scene.id,
                        await audioExcerpt(file, scene, signal),
                        'audio',
                        signal,
                      );
                    if (
                      asset.kind === 'video' &&
                      !scene.artifacts.some((a) => a.kind === 'video')
                    )
                      await index.publishFile(
                        runId,
                        scene.id,
                        await excerpt(
                          file,
                          scene,
                          asset.width,
                          asset.height,
                          !!asset.audioCodec,
                          signal,
                        ),
                        'video',
                        signal,
                      );
                  }
                  return await index.update(
                    runId,
                    (r) => {
                      r.status = 'analyzed';
                      r.analysis.generationMs +=
                        performance.now() - generationStart;
                      delete r.error;
                    },
                    signal,
                  );
                } catch (error) {
                  await index
                    .update(runId, (r) => {
                      r.status = signal.aborted ? 'cancelled' : 'failed';
                      r.error = signal.aborted
                        ? 'Cancelled; retry indexing.'
                        : asEditorError(error).code;
                    })
                    .catch(() => {});
                  throw error;
                }
              },
              signal,
            ),
          signal,
        ),
      signal,
    );
  } finally {
    index.close();
  }
}
async function excerpt(
  file: File,
  scene: IndexScene,
  width: number,
  height: number,
  hasAudio: boolean,
  signal: AbortSignal,
) {
  const input = inputFile(file),
    target = new BufferTarget(),
    output = new Output({ format: new Mp4OutputFormat(), target });
  let conversion: Conversion | undefined;
  const abort = () => {
    void conversion?.cancel();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    checkAbort(signal);
    conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      copy: false,
      showWarnings: false,
      tags: {},
      trim: {
        start: scene.excerptStartUs / 1e6,
        end: scene.excerptEndUs / 1e6,
      },
      video: {
        ...size(width, height, 640, true),
        fit: 'contain',
        codec: 'avc',
        bitrate: 1000000,
        frameRate: 15,
        allowTransformationMetadata: false,
        process(sample) {
          // Frame-rate correction can synthesize a sample at the exclusive trim end.
          const end = (scene.excerptEndUs - scene.excerptStartUs) / 1e6;
          if (sample.timestamp >= end - 0.000001) return null;
          sample.setDuration(Math.min(sample.duration, end - sample.timestamp));
          return sample;
        },
      },
      audio: hasAudio
        ? {
            codec: 'aac',
            bitrate: 96000,
            sampleRate: 48000,
            numberOfChannels: 2,
          }
        : { discard: true },
    });
    checkAbort(signal);
    invariant(
      conversion.isValid && conversion.discardedTracks.length === 0,
      'UNSUPPORTED_CODEC',
      'Cannot encode indexing excerpt with all source streams',
    );
    await conversion.execute();
    checkAbort(signal);
    invariant(
      target.buffer,
      'UNSUPPORTED_CODEC',
      'Index excerpt output missing',
    );
    return await finalizeExcerpt(
      new File([target.buffer], 'excerpt.mp4', { type: 'video/mp4' }),
      (scene.excerptEndUs - scene.excerptStartUs) / 1e6,
      hasAudio,
      signal,
    );
  } finally {
    signal.removeEventListener('abort', abort);
    input.dispose();
  }
}
/** Native AAC encoders add priming samples; share the measured export correction.
 * Remux the small generated clip to enforce its exclusive scene endpoint. */
async function finalizeExcerpt(
  file: File,
  end: number,
  hasAudio: boolean,
  signal: AbortSignal,
) {
  const input = inputFile(file),
    target = new BufferTarget(),
    output = new Output({ format: new Mp4OutputFormat(), target });
  const abort = () => {
    void output.cancel();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    checkAbort(signal);
    const video = (await input.getPrimaryVideoTrack())!,
      videoSource = new EncodedVideoPacketSource('avc'),
      audio = hasAudio ? await input.getPrimaryAudioTrack() : null,
      audioSource = audio ? new EncodedAudioPacketSource('aac') : null;
    invariant(
      !hasAudio || audioSource,
      'UNSUPPORTED_CODEC',
      'Excerpt lost audio',
    );
    output.addVideoTrack(videoSource, { frameRate: 15 });
    if (audioSource) output.addAudioTrack(audioSource);
    await output.start();
    const config = await video.getDecoderConfig();
    for await (const packet of new EncodedPacketSink(video).packets()) {
      checkAbort(signal);
      if (packet.timestamp >= end) continue;
      await videoSource.add(
        packet.clone({
          duration: Math.min(packet.duration, end - packet.timestamp),
        }),
        { decoderConfig: config! },
      );
    }
    videoSource.close();
    if (audio && audioSource) {
      const config = normalizeAudioDecoderConfig(
          (await audio.getDecoderConfig())!,
        ),
        priming =
          (await audioPrimingFrames({
            codec: 'mp4a.40.2',
            bitrate: 96000,
            sampleRate: 48000,
            numberOfChannels: 2,
          })) / 48000;
      for await (const raw of new EncodedPacketSink(audio).packets()) {
        checkAbort(signal);
        const timestamp = raw.timestamp - priming;
        if (timestamp >= end) continue;
        await audioSource.add(
          raw.clone({
            timestamp,
            duration: Math.min(raw.duration, end - timestamp),
          }),
          { decoderConfig: config },
        );
      }
      audioSource.close();
    }
    await output.finalize();
    checkAbort(signal);
    invariant(
      target.buffer,
      'UNSUPPORTED_CODEC',
      'Excerpt finalization failed',
    );
    return new Blob([target.buffer], { type: 'video/mp4' });
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    signal.removeEventListener('abort', abort);
    input.dispose();
  }
}

async function scanAudio(
  file: File,
  durationUs: number,
  signal: AbortSignal,
  progress: (p: Progress) => void,
): Promise<AudioMetrics[]> {
  const input = inputFile(file),
    bins = Math.ceil(durationUs / 250000),
    energy = new Float64Array(bins),
    peaks = new Float32Array(bins),
    counts = new Uint32Array(bins);
  let nextYield = 0;
  try {
    const track = await input.getPrimaryAudioTrack();
    invariant(track, 'UNSUPPORTED_CODEC', 'Audio stream missing');
    for await (const sample of new AudioSampleSink(track).samples()) {
      try {
        checkAbort(signal);
        for (let channel = 0; channel < sample.numberOfChannels; channel++) {
          const data = new Float32Array(sample.numberOfFrames);
          sample.copyTo(data, { planeIndex: channel, format: 'f32-planar' });
          for (let i = 0; i < data.length; i++) {
            const bin = Math.floor(
              (sample.timestamp + i / sample.sampleRate) * 4,
            );
            if (bin < 0 || bin >= bins) continue;
            const value = data[i]!;
            energy[bin]! += value * value;
            peaks[bin] = Math.max(peaks[bin]!, Math.abs(value));
            counts[bin]!++;
          }
        }
        progress({
          stage: 'scan',
          progress: Math.min(
            0.3,
            (((sample.timestamp + sample.duration) * 1e6) / durationUs) * 0.3,
          ),
        });
        if (sample.timestamp >= nextYield) {
          nextYield = sample.timestamp + 1;
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      } finally {
        sample.close();
      }
    }
    return [...energy].map((sum, i) => ({
      timeUs: i * 250000,
      rms: counts[i] ? Math.sqrt(sum / counts[i]!) : 0,
      peak: peaks[i]!,
    }));
  } finally {
    input.dispose();
  }
}
async function audioExcerpt(
  file: File,
  scene: IndexScene,
  signal: AbortSignal,
) {
  const input = inputFile(file),
    target = new BufferTarget(),
    output = new Output({ format: new WavOutputFormat(), target });
  let conversion: Conversion | undefined;
  const abort = () => {
    void conversion?.cancel();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    checkAbort(signal);
    conversion = await Conversion.init({
      input,
      output,
      copy: false,
      tracks: 'primary',
      tags: {},
      trim: {
        start: scene.excerptStartUs / 1e6,
        end: scene.excerptEndUs / 1e6,
      },
      video: { discard: true },
      audio: { codec: 'pcm-s16', sampleRate: 48000, numberOfChannels: 2 },
      showWarnings: false,
    });
    checkAbort(signal);
    invariant(
      conversion.isValid && conversion.discardedTracks.length === 0,
      'UNSUPPORTED_CODEC',
      'Cannot generate audio indexing excerpt',
    );
    await conversion.execute();
    checkAbort(signal);
    invariant(target.buffer, 'UNSUPPORTED_CODEC', 'Audio excerpt missing');
    return await boundAudioExcerpt(
      new File([target.buffer], 'excerpt.wav'),
      (scene.excerptEndUs - scene.excerptStartUs) / 1e6,
      signal,
    );
  } finally {
    signal.removeEventListener('abort', abort);
    input.dispose();
  }
}
async function boundAudioExcerpt(file: File, end: number, signal: AbortSignal) {
  const input = inputFile(file),
    target = new BufferTarget(),
    output = new Output({ format: new WavOutputFormat(), target });
  const abort = () => {
    void output.cancel();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const track = (await input.getPrimaryAudioTrack())!,
      source = new EncodedAudioPacketSource('pcm-s16'),
      config = (await track.getDecoderConfig())!;
    output.addAudioTrack(source);
    await output.start();
    let remaining = Math.floor(end * 48000);
    for await (const raw of new EncodedPacketSink(track).packets()) {
      checkAbort(signal);
      const frames = Math.min(remaining, raw.data.length / 4);
      if (frames <= 0) break;
      await source.add(
        raw.clone({
          data: raw.data.subarray(0, frames * 4),
          duration: frames / 48000,
        }),
        { decoderConfig: config },
      );
      remaining -= frames;
    }
    source.close();
    await output.finalize();
    checkAbort(signal);
    invariant(
      target.buffer,
      'UNSUPPORTED_CODEC',
      'Audio excerpt finalization failed',
    );
    return new Blob([target.buffer], { type: 'audio/wav' });
  } catch (error) {
    await output.cancel().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    input.dispose();
  }
}
