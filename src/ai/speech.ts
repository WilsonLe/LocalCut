import { AiError, aiInvariant } from './errors';
import type { SpeechAudio, SpeechModel, SpeechRequest } from './types';

export const SPEECH_LIMITS = Object.freeze({
  scriptCharacters: 5000,
  instructionsCharacters: 1500,
  audioBytes: 24_000_000,
  sampleRate: 24000 as const,
});
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const geminiTts = /^google\/gemini-[a-z0-9.-]+-tts(?:-preview)?$/;

/** Only instruction-capable models with a known PCM contract are offered. */
export function speechModelsFrom(value: unknown): SpeechModel[] {
  aiInvariant(
    object(value) && Array.isArray(value.data) && value.data.length <= 20_000,
    'INVALID_RESPONSE',
    'Invalid speech model catalog.',
  );
  const models: SpeechModel[] = [];
  const ids = new Set<string>();
  for (const item of value.data) {
    if (
      !object(item) ||
      typeof item.id !== 'string' ||
      !geminiTts.test(item.id)
    )
      continue;
    aiInvariant(
      item.id.length <= 256 &&
        !ids.has(item.id) &&
        typeof item.name === 'string' &&
        item.name.length > 0 &&
        item.name.length <= 512 &&
        object(item.architecture) &&
        Array.isArray(item.architecture.output_modalities) &&
        item.architecture.output_modalities.includes('speech') &&
        Array.isArray(item.supported_voices) &&
        item.supported_voices.length > 0 &&
        item.supported_voices.length <= 256 &&
        item.supported_voices.every(
          (voice) =>
            typeof voice === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(voice),
        ),
      'INVALID_RESPONSE',
      'Invalid speech model catalog.',
    );
    ids.add(item.id);
    models.push({
      id: item.id,
      name: item.name,
      voices: [...new Set(item.supported_voices as string[])],
    });
  }
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

export function speechBody(request: SpeechRequest, compatible = false): string {
  aiInvariant(
    typeof request.model === 'string' &&
      (compatible
        ? /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(request.model)
        : geminiTts.test(request.model)),
    'MODEL_UNSUPPORTED',
    'Select an instruction-capable Gemini speech model.',
  );
  aiInvariant(
    typeof request.script === 'string' &&
      request.script.trim().length > 0 &&
      request.script.length <= SPEECH_LIMITS.scriptCharacters &&
      typeof request.voice === 'string' &&
      /^[A-Za-z0-9_-]{1,80}$/.test(request.voice) &&
      Array.isArray(request.languages) &&
      request.languages.length >= 1 &&
      request.languages.length <= 8 &&
      request.languages.every(
        (language) =>
          typeof language === 'string' &&
          language.trim().length > 0 &&
          language.length <= 80 &&
          ![...language].some((character) => character.charCodeAt(0) < 32),
      ) &&
      (request.instructions === undefined ||
        (typeof request.instructions === 'string' &&
          request.instructions.length <= SPEECH_LIMITS.instructionsCharacters)),
    'INVALID_REQUEST',
    'Check the script, voice, languages and delivery instructions.',
  );
  return JSON.stringify({
    model: request.model,
    input: request.script,
    voice: request.voice,
    response_format: 'pcm',
    instructions: [
      'Read the script verbatim with natural conversational intonation, expressive phrasing and comfortable pauses. Do not translate, add or omit words. Preserve the selected voice across language changes.',
      `Languages present in the script: ${request.languages.map((language) => language.trim()).join(', ')}. Pronounce each passage naturally in its original language.`,
      request.instructions?.trim(),
    ]
      .filter(Boolean)
      .join('\n'),
    ...(!compatible ? { provider: { data_collection: 'deny' } } : {}),
  });
}

/** Never parse remote JSON/error text as audio; bound bytes while consuming. */
export async function readSpeechAudio(
  response: Response,
  signal: AbortSignal,
): Promise<SpeechAudio> {
  const invalid = (condition: unknown) =>
    aiInvariant(
      condition,
      'INVALID_RESPONSE',
      'OpenRouter returned invalid speech audio.',
    );
  if (
    response.headers
      .get('content-type')
      ?.split(';')[0]
      ?.trim()
      .toLowerCase() !== 'audio/pcm'
  ) {
    void response.body?.cancel().catch(() => undefined);
    invalid(false);
  }
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > SPEECH_LIMITS.audioBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new AiError(
      'RESPONSE_LIMIT',
      'Speech audio exceeded the size limit.',
    );
  }
  invalid(response.body);
  const reader = response.body!.getReader();
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', abort, { once: true });
  const check = () => {
    if (signal.aborted)
      throw new AiError('CANCELLED', 'Speech request cancelled.');
  };
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    check();
    while (true) {
      const chunk = await reader.read();
      check();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      aiInvariant(
        bytes <= SPEECH_LIMITS.audioBytes,
        'RESPONSE_LIMIT',
        'Speech audio exceeded the size limit.',
      );
      chunks.push(chunk.value);
    }
    invalid(bytes >= 2 && bytes % 2 === 0);
    const pcm = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      pcm.set(chunk, offset);
      offset += chunk.length;
    }
    const view = new DataView(pcm.buffer);
    const samples = new Float32Array(bytes / 2);
    for (let i = 0; i < samples.length; i++)
      samples[i] = view.getInt16(i * 2, true) / 32768;
    return { samples, sampleRate: SPEECH_LIMITS.sampleRate };
  } finally {
    signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
