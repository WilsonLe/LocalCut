import { afterEach, expect, it, vi } from 'vitest';
import {
  RECORDING_MAX_BYTES,
  RECORDING_MAX_MS,
  startScreenRecording,
} from '../../src/services/screen-recording';

class Track extends EventTarget {
  readyState = 'live';
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
}
class Recorder {
  static instances: Recorder[] = [];
  static isTypeSupported = vi.fn((type: string) =>
    type.startsWith('video/webm;codecs=vp9'),
  );
  state = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_stream: unknown, options: { mimeType: string }) {
    this.mimeType = options.mimeType;
    Recorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(['final bytes']) });
      this.onstop?.();
    });
  }
}
function setup(audio = false) {
  const video = new Track();
  const sound = new Track();
  const tracks = audio ? [video, sound] : [video];
  const stream = {
    getTracks: () => tracks,
    getVideoTracks: () => [video],
    getAudioTracks: () => (audio ? [sound] : []),
  };
  const getDisplayMedia = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } });
  vi.stubGlobal('MediaRecorder', Recorder);
  return {
    video,
    sound,
    stream,
    getDisplayMedia,
    abort: new AbortController(),
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Recorder.instances = [];
  Recorder.isTypeSupported
    .mockReset()
    .mockImplementation((type: string) =>
      type.startsWith('video/webm;codecs=vp9'),
    );
});
it('asks immediately, includes available audio, retains final chunk and releases all tracks', async () => {
  const { abort, getDisplayMedia, video, sound } = setup(true);
  const pending = startScreenRecording(true, abort.signal);
  expect(getDisplayMedia).toHaveBeenCalledWith({
    video: { frameRate: 30 },
    audio: true,
  });
  const recording = await pending;
  Recorder.instances[0]!.ondataavailable?.({ data: new Blob(['first bytes']) });
  recording.stop();
  recording.stop();
  const { file, limited } = await recording.completion;
  expect(await file.text()).toBe('first bytesfinal bytes');
  expect(file.type).toBe('video/webm;codecs=vp9,opus');
  expect(limited).toBe(false);
  expect(video.readyState).toBe('ended');
  expect(sound.readyState).toBe('ended');
});
it('external stop-sharing finalizes once and audio-free streams use video-only encoding', async () => {
  const { abort, video } = setup();
  const recording = await startScreenRecording(true, abort.signal);
  video.dispatchEvent(new Event('ended'));
  expect((await recording.completion).file.type).toBe('video/webm;codecs=vp9');
});
it('dismissal while the picker is pending releases a late stream without starting a recorder', async () => {
  const { abort, getDisplayMedia, stream, video } = setup();
  let grant!: (stream: unknown) => void;
  getDisplayMedia.mockImplementation(
    () =>
      new Promise((resolve) => {
        grant = resolve;
      }),
  );
  const pending = startScreenRecording(false, abort.signal);
  abort.abort();
  grant(stream);
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(video.readyState).toBe('ended');
  expect(Recorder.instances).toHaveLength(0);
});
it('discard drops queued recording data and releases capture', async () => {
  const { abort, video } = setup();
  const recording = await startScreenRecording(false, abort.signal);
  abort.abort();
  recording.dispose();
  await expect(recording.completion).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(video.readyState).toBe('ended');
});
it('recorder failures and unsupported encoding release capture', async () => {
  const { abort, video } = setup();
  const recording = await startScreenRecording(false, abort.signal);
  Recorder.instances[0]!.onerror?.();
  await expect(recording.completion).rejects.toThrow('Recording failed');
  expect(video.readyState).toBe('ended');
  const next = setup();
  Recorder.isTypeSupported.mockReturnValue(false);
  await expect(startScreenRecording(false, next.abort.signal)).rejects.toThrow(
    'supported video format',
  );
  expect(next.video.readyState).toBe('ended');
});
it('stops at duration/size limits and rejects an oversized final chunk', async () => {
  vi.useFakeTimers();
  const { abort } = setup();
  const recording = await startScreenRecording(false, abort.signal);
  await vi.advanceTimersByTimeAsync(RECORDING_MAX_MS);
  expect((await recording.completion).limited).toBe(true);
  const next = setup();
  const oversized = await startScreenRecording(false, next.abort.signal);
  Recorder.instances
    .at(-1)!
    .ondataavailable?.({ data: { size: RECORDING_MAX_BYTES + 1 } as Blob });
  await expect(oversized.completion).rejects.toThrow('exceeded 256 MiB');
  expect(next.video.readyState).toBe('ended');
});
