import {
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  CanvasSource,
  EncodedAudioPacketSource,
  EncodedPacket,
  canEncodeVideo,
  canEncodeAudio,
} from 'mediabunny';
import type { Project } from '../core/model';
import { durationUs } from '../core/model';
import { frameTimeUs } from '../core/timing';
import { invariant } from '../core/errors';
import type { Store } from '../storage/store';
import type { Progress } from '../services/jobs';
import { checkAbort } from '../services/jobs';
import { outputTarget } from './assets';
import { audioPrimingFrames } from './audio-priming';
import { Renderer } from './composition';
export interface ExportOptions {
  format: 'mp4' | 'webm';
  videoBitrate?: number;
  audioBitrate?: number;
}
export interface ExportResult {
  path: string;
  file: File;
  projectId: string;
  revision: number;
  format: 'mp4' | 'webm';
  durationUs: number;
  settings: ExportOptions;
}
export async function preflight(project: Project, options: ExportOptions) {
  invariant(
    options.format === 'mp4' || options.format === 'webm',
    'INVALID_COMMAND',
    'Invalid export format',
  );
  const fps = project.frameRate.num / project.frameRate.den;
  invariant(
    fps > 0 && fps <= 60,
    'UNSUPPORTED_CODEC',
    'Export supports up to60fps',
  );
  const videoCodec: 'avc' | 'vp9' = options.format === 'mp4' ? 'avc' : 'vp9',
    audioCodec: 'aac' | 'opus' = options.format === 'mp4' ? 'aac' : 'opus',
    videoBitrate = options.videoBitrate ?? 8_000_000,
    audioBitrate =
      options.audioBitrate ?? (options.format === 'mp4' ? 192_000 : 128_000);
  invariant(
    Number.isFinite(videoBitrate) &&
      videoBitrate > 0 &&
      Number.isFinite(audioBitrate) &&
      audioBitrate > 0,
    'INVALID_COMMAND',
    'Invalid bitrate',
  );
  const video = await canEncodeVideo(videoCodec, {
      width: project.width,
      height: project.height,
      frameRate: fps,
      bitrate: videoBitrate,
    }),
    audio = await canEncodeAudio(audioCodec, {
      sampleRate: 48000,
      numberOfChannels: 2,
      bitrate: audioBitrate,
    });
  return {
    supported: video && audio,
    video,
    audio,
    videoCodec,
    audioCodec,
    videoBitrate,
    audioBitrate,
  };
}
export async function exportProject(
  store: Store,
  project: Project,
  options: ExportOptions,
  signal: AbortSignal,
  progress: (p: Progress) => void,
  id: string,
): Promise<ExportResult> {
  const caps = await preflight(project, options);
  invariant(
    caps.supported,
    'UNSUPPORTED_CODEC',
    `Cannot encode requested ${options.format} configuration`,
  );
  const duration = durationUs(project);
  invariant(duration > 0, 'INVALID_COMMAND', 'Empty project cannot export');
  const frames = Math.ceil(
      (duration * project.frameRate.num) / (1e6 * project.frameRate.den),
    ),
    endUs = frameTimeUs(frames, project.frameRate),
    renderer = new Renderer(store, project);
  let output: Output | undefined;
  let audioEncoder: AudioEncoder | undefined;
  let target: Awaited<ReturnType<typeof outputTarget>> | undefined;
  const path = `export-${id}.${options.format}`;
  return store.lock(`job:${id}`, 'exclusive', async () => {
    try {
      progress({ stage: 'prepare', progress: 0 });
      await renderer.prepareAudio(signal, progress);
      checkAbort(signal);
      await store.journal({ id, target: path, kind: 'export' });
      target = await outputTarget(store, path);
      output = new Output({
        format:
          options.format === 'mp4'
            ? new Mp4OutputFormat({ fastStart: 'fragmented' })
            : new WebMOutputFormat(),
        target: target.target,
      });
      const video = new CanvasSource(renderer.canvas, {
          codec: caps.videoCodec,
          bitrate: caps.videoBitrate,
        }),
        audio = new EncodedAudioPacketSource(caps.audioCodec);
      output.addVideoTrack(video, {
        frameRate: project.frameRate.num / project.frameRate.den,
      });
      output.addAudioTrack(audio);
      await output.start();
      const audioConfig = {
        codec: caps.audioCodec === 'aac' ? 'mp4a.40.2' : 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: caps.audioBitrate,
      };
      const priming = (await audioPrimingFrames(audioConfig)) / 48000;
      let packetQueue = Promise.resolve();
      let encodingError: unknown;
      const encoder = new AudioEncoder({
        output(chunk, meta) {
          const raw = EncodedPacket.fromEncodedChunk(chunk),
            packet = raw.clone({ timestamp: raw.timestamp - priming });
          if (packet.timestamp >= endUs / 1e6) return;
          const bounded = packet.clone({
            duration: Math.min(packet.duration, endUs / 1e6 - packet.timestamp),
          });
          packetQueue = packetQueue
            .then(() => audio.add(bounded, meta))
            .catch((error) => {
              encodingError = error;
            });
        },
        error(error) {
          encodingError = error;
        },
      });
      audioEncoder = encoder;
      encoder.configure(audioConfig);
      let audioFrame = 0;
      const finalAudioFrame = Math.round((endUs * 48000) / 1e6);
      for (let frame = 0; frame < frames; frame++) {
        checkAbort(signal);
        const startUs = frameTimeUs(frame, project.frameRate),
          nextUs = frameTimeUs(frame + 1, project.frameRate);
        await renderer.frame(startUs, signal);
        await video.add(startUs / 1e6, (nextUs - startUs) / 1e6);
        const nextAudio = Math.min(
          finalAudioFrame,
          Math.round((nextUs * 48000) / 1e6),
        );
        const count = nextAudio - audioFrame;
        if (count) {
          const channels = await renderer.audio(audioFrame, count, signal),
            data = new Float32Array(count * 2);
          data.set(channels[0]!, 0);
          data.set(channels[1]!, count);
          const sample = new AudioData({
            data,
            format: 'f32-planar',
            numberOfChannels: 2,
            numberOfFrames: count,
            sampleRate: 48000,
            timestamp: Math.round((audioFrame * 1e6) / 48000),
          });
          try {
            encoder.encode(sample);
          } finally {
            sample.close();
          }
          if (encoder.encodeQueueSize > 10)
            await new Promise<void>((resolve) =>
              encoder.addEventListener('dequeue', () => resolve(), {
                once: true,
              }),
            );
          await packetQueue;
          if (encodingError) throw encodingError;
          audioFrame = nextAudio;
        }
        if (frame % 10 === 0) {
          progress({ stage: 'encode', progress: frame / frames });
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      checkAbort(signal);
      await encoder.flush();
      await packetQueue;
      encoder.close();
      if (encodingError) throw encodingError;
      video.close();
      audio.close();
      progress({ stage: 'finalize', progress: 0.99 });
      await output.finalize();
      await target.close();
      checkAbort(signal);
      const file = await store.file(path);
      await store.finishJournal(id);
      return {
        path,
        file,
        projectId: project.id,
        revision: project.revision,
        format: options.format,
        durationUs: endUs,
        settings: {
          ...options,
          videoBitrate: caps.videoBitrate,
          audioBitrate: caps.audioBitrate,
        },
      };
    } catch (e) {
      await output?.cancel().catch(() => {});
      await target?.abort();
      await store.remove(path);
      await store.finishJournal(id);
      throw e;
    } finally {
      if (audioEncoder?.state !== 'closed') audioEncoder?.close();
      renderer.dispose();
    }
  });
}
