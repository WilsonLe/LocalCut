/** A user-initiated microphone session; stopping delivers audio, aborting discards it. */
export async function startMicrophoneRecording(signal: AbortSignal) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const release = () => stream.getTracks().forEach((track) => track.stop());
  let recorder: MediaRecorder;
  try {
    signal.throwIfAborted();
    recorder = new MediaRecorder(stream);
  } catch (error) {
    release();
    throw error;
  }
  let resolve!: (audio: Blob) => void;
  let reject!: (error: unknown) => void;
  const completion = new Promise<Blob>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  void completion.catch(() => {});
  const chunks: Blob[] = [];
  let size = 0;
  let settled = false;
  const cleanup = () => {
    signal.removeEventListener('abort', abort);
    recorder.ondataavailable = recorder.onstop = recorder.onerror = null;
    release();
  };
  const abort = () => {
    if (settled) return;
    settled = true;
    if (recorder.state !== 'inactive') recorder.stop();
    chunks.length = 0;
    cleanup();
    reject(new DOMException('Microphone recording cancelled.', 'AbortError'));
  };
  recorder.ondataavailable = (event) => {
    size += event.data.size;
    // Bound transient encoded bytes; decoded references have their own endpoint limit.
    if (size > 15 * 1024 * 1024) {
      abort();
      return;
    }
    chunks.push(event.data);
  };
  recorder.onerror = () => abort();
  recorder.onstop = () => {
    if (settled) return;
    settled = true;
    const audio = new Blob(chunks, { type: recorder.mimeType });
    chunks.length = 0;
    cleanup();
    resolve(audio);
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    recorder.start(1000);
  } catch (error) {
    abort();
    throw error;
  }
  return {
    completion,
    stop() {
      if (!settled && recorder.state !== 'inactive') recorder.stop();
    },
    abort,
  };
}
