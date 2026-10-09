import { modelStatus } from '../services/transcription-status';
import type {
  AutomaticSpeechRecognitionPipeline,
  AutomaticSpeechRecognitionOutput,
} from '@huggingface/transformers';
import {
  MODEL,
  MODEL_REVISION,
  RUNTIME_CDN,
  requiredUrls,
} from '../services/transcription-config';
import { asEditorError, EditorError, invariant } from '../core/errors';
import type { Transcript } from '../core/model';
let recognizer: AutomaticSpeechRecognitionPipeline | undefined;
let namespace = 'localcut';
let allowDownloads = false;
async function loadInference() {
  const { env, pipeline } = await import('@huggingface/transformers');
  env.useBrowserCache = true;
  env.useWasmCache = true;
  env.useFSCache = false;
  env.allowLocalModels = false;
  env.experimental_useCrossOriginStorage = false;
  const wasm = env.backends.onnx.wasm;
  invariant(wasm, 'UNSUPPORTED_CODEC', 'WASM backend unavailable');
  wasm.numThreads = 1;
  wasm.proxy = false;
  wasm.wasmPaths = {
    mjs: `${RUNTIME_CDN}/ort-wasm-simd-threaded.asyncify.mjs`,
    wasm: `${RUNTIME_CDN}/ort-wasm-simd-threaded.asyncify.wasm`,
  };
  const originalFetch = env.fetch;
  env.fetch = async (url, init) => {
    url = String(url).replace(
      'https://huggingface.co/' + MODEL + '/resolve/main/',
      'https://huggingface.co/' + MODEL + '/resolve/' + MODEL_REVISION + '/',
    );
    if (!allowDownloads) {
      const cached = await (await caches.open(env.cacheKey)).match(String(url));
      if (cached) return cached;
      throw new EditorError(
        'MODEL_REQUIRED',
        'Explicit preparation required for uncached transcription asset: ' +
          String(url),
      );
    }
    const parsed = new URL(String(url));
    invariant(
      parsed.protocol === 'https:' &&
        ['huggingface.co', 'cdn.jsdelivr.net'].includes(parsed.hostname),
      'MODEL_DOWNLOAD_FAILED',
      'Unexpected asset download host',
    );
    invariant(
      !init?.method || init.method === 'GET' || init.method === 'HEAD',
      'MODEL_DOWNLOAD_FAILED',
      'Model requests must be read-only',
    );
    return originalFetch(url, { ...init, credentials: 'omit' });
  };
  return { env, pipeline };
}
let inference: ReturnType<typeof loadInference> | undefined;
self.onmessage = async ({
  data,
}: MessageEvent<{
  id: string;
  operation: string;
  payload: {
    namespace: string;
    audio?: Float32Array;
    assetId?: string;
    language?: string;
    startUs?: number;
  };
}>) => {
  const progress = (stage: string, value?: number) =>
    self.postMessage({
      id: data.id,
      kind: 'progress',
      data: { stage, progress: value },
    });
  try {
    const { env, pipeline } = await (inference ??= loadInference());
    namespace = data.payload.namespace;
    env.cacheKey = `${namespace}-asr-v1`;
    if (data.operation === 'prepare') {
      allowDownloads = true;
      progress('download', 0);
      const cache = await caches.open(env.cacheKey);
      const initial = await modelStatus(namespace);
      const urls = requiredUrls();
      for (let index = 0; index < urls.length; index++) {
        const url = urls[index]!;
        if (initial.missing.includes(url)) {
          const response = await env.fetch(url);
          invariant(
            response.ok,
            'MODEL_DOWNLOAD_FAILED',
            'Asset download failed: ' + url,
          );
          await cache.put(url, response);
        }
        progress('download', (index + 1) / urls.length);
      }
      progress('verify');
      const status = await modelStatus(namespace);
      if (!status.ready) {
        for (const url of status.missing) await cache.delete(url);
        throw new EditorError(
          'MODEL_DOWNLOAD_FAILED',
          'Invalid cached inference assets',
          { missing: status.missing },
        );
      }
      allowDownloads = false;
      progress('initialize');
      recognizer ??= await pipeline('automatic-speech-recognition', MODEL, {
        revision: MODEL_REVISION,
        device: 'wasm',
        dtype: 'q8',
      });
      self.postMessage({ id: data.id, kind: 'result', data: status });
    } else if (data.operation === 'transcribe') {
      allowDownloads = false;
      const status = await modelStatus(namespace);
      invariant(
        status.ready,
        'MODEL_REQUIRED',
        'Transcription assets are not cached',
      );
      progress('initialize');
      recognizer ??= await pipeline('automatic-speech-recognition', MODEL, {
        revision: MODEL_REVISION,
        device: 'wasm',
        dtype: 'q8',
      });
      invariant(
        data.payload.audio?.length,
        'INVALID_COMMAND',
        'Audio required',
      );
      progress('inference');
      const output = (await recognizer(data.payload.audio, {
        task: 'transcribe',
        language: data.payload.language,
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 2.5,
      })) as AutomaticSpeechRecognitionOutput;
      const startUs = data.payload.startUs ?? 0,
        endUs = startUs + Math.round((data.payload.audio.length * 1e6) / 16000);
      const transcript: Transcript = {
        id: crypto.randomUUID(),
        assetId: data.payload.assetId!,
        model: MODEL,
        revision: MODEL_REVISION,
        language: data.payload.language,
        cues: [],
      };
      for (const chunk of output.chunks ?? []) {
        const [start, end] = chunk.timestamp;
        if (start === null) continue;
        const timeUs = Math.max(startUs, startUs + Math.round(start * 1e6)),
          cueEnd =
            end === null
              ? endUs
              : Math.min(endUs, startUs + Math.round(end * 1e6));
        if (cueEnd > timeUs)
          transcript.cues.push({
            id: crypto.randomUUID(),
            timeUs,
            endUs: cueEnd,
            text: chunk.text.trim(),
          });
      }
      self.postMessage({ id: data.id, kind: 'result', data: transcript });
    } else
      throw new EditorError(
        'INVALID_COMMAND',
        'Unknown transcription operation',
      );
  } catch (error) {
    const e = asEditorError(error);
    self.postMessage({
      id: data.id,
      kind: 'error',
      error: { code: e.code, message: e.message },
    });
  } finally {
    allowDownloads = false;
  }
};
