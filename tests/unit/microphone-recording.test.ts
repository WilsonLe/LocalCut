import { afterEach, expect, it, vi } from 'vitest';
import { startMicrophoneRecording } from '../../src/services/microphone-recording';

afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const stopTrack = vi.fn();
  const stream = { getTracks: () => [{ stop: stopTrack }] };
  class Recorder {
    static current: Recorder;
    state = 'inactive';
    mimeType = 'audio/webm';
    ondataavailable?: ((event: { data: Blob }) => void) | null;
    onstop?: (() => void) | null;
    onerror?: (() => void) | null;
    constructor() {
      Recorder.current = this;
    }
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['recording']) });
      this.onstop?.();
    }
  }
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn(async () => stream) },
  });
  vi.stubGlobal('MediaRecorder', Recorder);
  return { stopTrack, Recorder, stream };
}
it('delivers the final recording chunk and releases all tracks once', async () => {
  const { stopTrack } = fixture();
  const controller = new AbortController();
  const session = await startMicrophoneRecording(controller.signal);
  session.stop();
  expect(await (await session.completion).text()).toBe('recording');
  controller.abort();
  session.stop();
  expect(stopTrack).toHaveBeenCalledTimes(1);
});
it('discards audio on cancellation and releases microphone tracks', async () => {
  const { stopTrack } = fixture();
  const controller = new AbortController();
  const session = await startMicrophoneRecording(controller.signal);
  controller.abort();
  await expect(session.completion).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(stopTrack).toHaveBeenCalledTimes(1);
});
it('releases a late permission result after cancellation before recorder construction', async () => {
  const { stopTrack, stream } = fixture();
  let permit!: (value: unknown) => void;
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: () =>
        new Promise((resolve) => {
          permit = resolve;
        }),
    },
  });
  const controller = new AbortController();
  const starting = startMicrophoneRecording(controller.signal);
  controller.abort();
  permit(stream);
  await expect(starting).rejects.toMatchObject({ name: 'AbortError' });
  expect(stopTrack).toHaveBeenCalledTimes(1);
});
it('fails an oversized capture and removes its transient chunks', async () => {
  const { stopTrack, Recorder } = fixture();
  const session = await startMicrophoneRecording(new AbortController().signal);
  Recorder.current.ondataavailable?.({
    data: new Blob([new Uint8Array(15 * 1024 * 1024 + 1)]),
  });
  await expect(session.completion).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(stopTrack).toHaveBeenCalledTimes(1);
});
