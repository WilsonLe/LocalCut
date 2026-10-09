import type { Project } from '../core/model';
import { durationUs } from '../core/model';
import { EditorError, invariant } from '../core/errors';
export interface FrameResult {
  timeUs: number;
  revision: number;
  image: ImageBitmap;
}
export interface PreviewSession {
  play(): Promise<void>;
  pause(): void;
  seek(timeUs: number): Promise<void>;
  readonly currentTimeUs: number;
  dispose(): void;
}
export function createPreviewSession(
  project: () => Promise<Project>,
  canvas: HTMLCanvasElement,
  audioContext: AudioContext,
  frame: (p: Project, t: number, signal: AbortSignal) => Promise<FrameResult>,
  audio: (
    p: Project,
    start: number,
    count: number,
    signal: AbortSignal,
  ) => Promise<Float32Array[]>,
): PreviewSession {
  let snapshot: Project | undefined,
    position = 0,
    origin = 0,
    playing = false,
    disposed = false,
    animation = 0,
    generation = 0,
    audioFrame = 0,
    pumpBusy = false;
  let controller = new AbortController();
  const sources = new Set<AudioBufferSourceNode>();
  const stop = () => {
    playing = false;
    generation++;
    controller.abort();
    controller = new AbortController();
    cancelAnimationFrame(animation);
    for (const source of sources) {
      try {
        source.stop();
      } catch {
        /* Already stopped. */
      }
    }
    sources.clear();
  };
  const time = () =>
    playing
      ? Math.min(
          durationUs(snapshot!),
          position + (audioContext.currentTime - origin) * 1e6,
        )
      : position;
  const present = async (p: Project, t: number, token: number) => {
    const result = await frame(p, t, controller.signal);
    try {
      if (token === generation && !disposed) {
        canvas
          .getContext('2d')!
          .drawImage(result.image, 0, 0, canvas.width, canvas.height);
      }
    } finally {
      result.image.close();
    }
  };
  const pump = async () => {
    if (pumpBusy || !playing || !snapshot) return;
    pumpBusy = true;
    const token = generation;
    try {
      const until = Math.min(durationUs(snapshot), time() + 500000),
        limit = Math.ceil((until * 48000) / 1e6);
      while (playing && token === generation && audioFrame < limit) {
        const count = Math.min(12000, limit - audioFrame),
          start = audioFrame;
        const channels = await audio(snapshot, start, count, controller.signal);
        if (!playing || token !== generation) break;
        const buffer = audioContext.createBuffer(2, count, 48000);
        for (let i = 0; i < 2; i++)
          buffer.copyToChannel(new Float32Array(channels[i]!), i);
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        sources.add(source);
        source.onended = () => {
          sources.delete(source);
          source.disconnect();
        };
        source.start(
          Math.max(
            audioContext.currentTime,
            origin + (start / 48000 - position / 1e6),
          ),
        );
        audioFrame += count;
      }
    } finally {
      pumpBusy = false;
    }
  };
  const tick = async () => {
    if (!playing || !snapshot) return;
    const token = generation,
      t = time();
    try {
      await pump();
      if (token !== generation) return;
      await present(snapshot, t, token);
    } catch (e) {
      if (playing && token === generation) {
        position = time();
        stop();
        throw e;
      }
    }
    if (!playing || token !== generation) return;
    if (t >= durationUs(snapshot)) {
      position = durationUs(snapshot);
      stop();
      return;
    }
    animation = requestAnimationFrame(() => {
      void tick().catch(() => {});
    });
  };
  return {
    async play() {
      invariant(!disposed, 'DISPOSED', 'Preview disposed');
      if (playing) return;
      if (audioContext.state !== 'running') {
        if (!navigator.userActivation.hasBeenActive)
          throw new EditorError(
            'PLAYBACK_BLOCKED',
            'Audio playback requires user activation',
          );
        await audioContext.resume();
      }
      invariant(
        audioContext.state === 'running',
        'PLAYBACK_BLOCKED',
        'Audio context is suspended',
      );
      snapshot = await project();
      if (position >= durationUs(snapshot)) position = 0;
      origin = audioContext.currentTime + 0.05;
      audioFrame = Math.round((position * 48000) / 1e6);
      playing = true;
      generation++;
      void tick().catch(() => {});
    },
    pause() {
      if (playing) position = time();
      stop();
    },
    async seek(timeUs) {
      invariant(!disposed, 'DISPOSED', 'Preview disposed');
      snapshot = await project();
      invariant(
        Number.isSafeInteger(timeUs) &&
          timeUs >= 0 &&
          timeUs <= durationUs(snapshot),
        'INVALID_COMMAND',
        'Seek outside project',
      );
      const resume = playing;
      stop();
      position = timeUs;
      await present(snapshot, timeUs, generation);
      if (resume) await this.play();
    },
    get currentTimeUs() {
      return Math.round(time());
    },
    dispose() {
      disposed = true;
      stop();
    },
  };
}
