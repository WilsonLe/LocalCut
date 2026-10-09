import type { Project } from '../core/model';
import { durationUs } from '../core/model';
import { EditorError, invariant, asEditorError } from '../core/errors';
export interface FrameResult {
  timeUs: number;
  revision: number;
  image: ImageBitmap;
}
export interface PreviewSession {
  /** Resolves after initial audio scheduling and video presentation succeed. */
  play(): Promise<void>;
  pause(): void;
  seek(timeUs: number): Promise<void>;
  onError(listener: (error: EditorError) => void): () => void;
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
    audioFrame = 0;
  let controller = new AbortController();
  const listeners = new Set<(error: EditorError) => void>();
  const sources = new Set<AudioBufferSourceNode>();
  const report = (error: unknown) => {
    const structured = asEditorError(error);
    for (const listener of listeners) {
      try {
        listener(structured);
      } catch {
        /* Consumer isolation. */
      }
    }
  };
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
      source.disconnect();
    }
    sources.clear();
  };
  // The native clock keeps moving while decoding. Stop the timeline at the
  // scheduled PCM boundary until pump can resume it with the next block.
  const time = () =>
    playing
      ? Math.min(
          durationUs(snapshot!),
          Math.max(position, (audioFrame * 1e6) / 48000),
          Math.max(
            position,
            position + (audioContext.currentTime - origin) * 1e6,
          ),
        )
      : position;
  const present = async (p: Project, t: number, token: number) => {
    const result = await frame(p, t, controller.signal);
    try {
      if (token === generation && !disposed)
        canvas
          .getContext('2d')!
          .drawImage(result.image, 0, 0, canvas.width, canvas.height);
    } finally {
      result.image.close();
    }
  };
  const pump = async (token: number) => {
    if (!playing || !snapshot || token !== generation) return;
    const until = Math.min(durationUs(snapshot), time() + 500000),
      limit = Math.ceil((until * 48000) / 1e6);
    while (playing && token === generation && audioFrame < limit) {
      const count = Math.min(12000, limit - audioFrame),
        start = audioFrame;
      const channels = await audio(snapshot, start, count, controller.signal);
      if (!playing || token !== generation) break;
      let scheduledAt = origin + (start / 48000 - position / 1e6);
      if (scheduledAt < audioContext.currentTime) {
        // A cold source can outlast the queued audio. Hold at that boundary
        // while decoding, then resume consecutive blocks without skipping or
        // playing overdue buffers on top of one another.
        position = Math.max(position, (start * 1e6) / 48000);
        scheduledAt = audioContext.currentTime + 0.05;
        origin = scheduledAt - (start / 48000 - position / 1e6);
      }
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
      source.start(scheduledAt);
      audioFrame += count;
    }
  };
  const tick = async (token: number) => {
    if (!playing || !snapshot || token !== generation) return;
    try {
      await pump(token);
      if (token !== generation) return;
      await present(snapshot, time(), token);
    } catch (error) {
      if (playing && token === generation) {
        position = time();
        stop();
        report(error);
        throw asEditorError(error);
      }
      return;
    }
    if (!playing || token !== generation) return;
    if (time() >= durationUs(snapshot)) {
      position = durationUs(snapshot);
      stop();
      return;
    }
    animation = requestAnimationFrame(() => {
      // tick reports failures before rejecting; background promises are observed.
      void tick(token).catch(() => {});
    });
  };
  return {
    async play() {
      invariant(!disposed, 'DISPOSED', 'Preview disposed');
      if (playing) return;
      const token = ++generation;
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
      const p = await project();
      if (token !== generation || disposed) return;
      snapshot = p;
      if (position >= durationUs(snapshot)) position = 0;
      // Prepare the first bounded block before starting the clock. Lazy decoding
      // must not consume timeline time while the first audio cache is built.
      try {
        const count = Math.min(
          12000,
          Math.ceil(((durationUs(snapshot) - position) * 48000) / 1e6),
        );
        if (count > 0)
          await audio(
            snapshot,
            Math.round((position * 48000) / 1e6),
            count,
            controller.signal,
          );
        if (token !== generation || disposed) return;
        await present(snapshot, position, token);
      } catch (error) {
        if (token !== generation || disposed) return;
        stop();
        report(error);
        throw asEditorError(error);
      }
      if (token !== generation || disposed) return;
      origin = audioContext.currentTime + 0.05;
      audioFrame = Math.round((position * 48000) / 1e6);
      playing = true;
      await tick(token);
    },
    pause() {
      if (playing) position = time();
      stop();
    },
    async seek(timeUs) {
      invariant(!disposed, 'DISPOSED', 'Preview disposed');
      const resume = playing;
      stop();
      const token = generation;
      const p = await project();
      if (token !== generation || disposed) return;
      invariant(
        Number.isSafeInteger(timeUs) && timeUs >= 0 && timeUs <= durationUs(p),
        'INVALID_COMMAND',
        'Seek outside project',
      );
      snapshot = p;
      position = timeUs;
      try {
        await present(p, timeUs, token);
      } catch (error) {
        if (token === generation && !disposed) throw error;
      }
      if (resume && token === generation && !disposed) await this.play();
    },
    onError(listener) {
      invariant(!disposed, 'DISPOSED', 'Preview disposed');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get currentTimeUs() {
      return Math.round(time());
    },
    dispose() {
      if (playing) position = time();
      disposed = true;
      stop();
      listeners.clear();
    },
  };
}
