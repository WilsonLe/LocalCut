/** Browser capture owns only transient media; the caller imports the delivered File. */
export const RECORDING_MAX_BYTES = 256 * 1024 * 1024;
export const RECORDING_MAX_MS = 30 * 60 * 1000;

export interface ScreenRecording {
  stream: MediaStream;
  startedAt: number;
  completion: Promise<{ file: File; limited: boolean }>;
  stop(): void;
  dispose(): void;
}

export function screenRecordingSupported() {
  return (
    globalThis.isSecureContext &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  );
}

export async function startScreenRecording(
  audio: boolean,
  signal: AbortSignal,
): Promise<ScreenRecording> {
  if (!screenRecordingSupported())
    throw new Error(
      'Screen recording needs a supported desktop browser on HTTPS or localhost.',
    );
  signal.throwIfAborted();
  // Invoke directly from the user's click, before any asynchronous setup.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 },
    audio,
  });
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    stream.getTracks().forEach((track) => track.stop());
  };
  let recorder: MediaRecorder;
  try {
    signal.throwIfAborted();
    if (!stream.getVideoTracks().some((track) => track.readyState === 'live'))
      throw new Error(
        'The selected source is no longer available. Choose it again.',
      );
    const hasAudio = stream.getAudioTracks().length > 0;
    const mimeType = (
      hasAudio
        ? [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/mp4;codecs=avc1,mp4a.40.2',
          ]
        : [
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/mp4;codecs=avc1',
          ]
    ).find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType)
      throw new Error('This browser cannot record a supported video format.');
    recorder = new MediaRecorder(stream, { mimeType });
  } catch (error) {
    release();
    throw error;
  }
  let resolve!: (result: { file: File; limited: boolean }) => void;
  let reject!: (error: unknown) => void;
  const completion = new Promise<{ file: File; limited: boolean }>(
    (done, fail) => {
      resolve = done;
      reject = fail;
    },
  );
  // Also handle disposal before the caller can subscribe.
  void completion.catch(() => {});
  let chunks: Blob[] = [];
  let size = 0;
  let settled = false;
  let stopping = false;
  let limited = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    clearTimeout(timer);
    signal.removeEventListener('abort', dispose);
    stream
      .getVideoTracks()
      .forEach((track) => track.removeEventListener('ended', stop));
    recorder.ondataavailable = null;
    recorder.onstop = null;
    recorder.onerror = null;
    release();
    chunks = [];
  };
  const fail = (error: unknown) => {
    if (settled) return;
    settled = true;
    if (recorder.state !== 'inactive') recorder.stop();
    cleanup();
    reject(error);
  };
  function stop() {
    if (settled || stopping) return;
    stopping = true;
    // stop queues the final dataavailable before stop; retain those bytes.
    if (recorder.state !== 'inactive') recorder.stop();
    release();
  }
  function dispose() {
    fail(new DOMException('Recording discarded', 'AbortError'));
  }
  recorder.ondataavailable = (event) => {
    if (settled || !event.data.size) return;
    size += event.data.size;
    if (size > RECORDING_MAX_BYTES) {
      fail(new Error('Recording exceeded 256 MiB. Try a shorter recording.'));
      return;
    }
    chunks.push(event.data);
    // Leave headroom for the final chunk; oversized final chunks fail explicitly.
    if (size >= RECORDING_MAX_BYTES * 0.9) {
      limited = true;
      stop();
    }
  };
  recorder.onerror = () =>
    fail(new Error('Recording failed. Choose a source and try again.'));
  recorder.onstop = () => {
    if (settled) return;
    if (!size) {
      fail(
        new Error('No video was recorded. Record for longer and try again.'),
      );
      return;
    }
    settled = true;
    const type = recorder.mimeType;
    const extension = type.startsWith('video/mp4') ? 'mp4' : 'webm';
    const date = new Date().toISOString().replace(/[:.]/g, '-');
    const file = new File(chunks, `Screen recording ${date}.${extension}`, {
      type,
    });
    cleanup();
    resolve({ file, limited });
  };
  stream
    .getVideoTracks()
    .forEach((track) => track.addEventListener('ended', stop));
  signal.addEventListener('abort', dispose, { once: true });
  try {
    recorder.start(1000);
    timer = setTimeout(() => {
      limited = true;
      stop();
    }, RECORDING_MAX_MS);
  } catch (error) {
    fail(error);
    throw error;
  }
  return { stream, startedAt: performance.now(), completion, stop, dispose };
}

export function screenRecordingError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError')
      return 'Screen sharing was cancelled or denied. Choose a source again and allow access in your browser or system settings.';
    if (error.name === 'NotReadableError')
      return 'The source could not be captured. Check screen-recording permission in system settings, then try again.';
    if (error.name === 'NotFoundError')
      return 'No screen or window is available to record.';
  }
  return error instanceof Error
    ? error.message
    : 'Recording failed. Try again.';
}
