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
export const REFERENCE_SPEECH_MODEL = 'fish-audio/s2.1-pro';
export const SPEECH_REFERENCE_BYTES = 15 * 1024 * 1024;

/** Explicitly supported PCM and reference-cloning models; endpoints gate cloning. */
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
      (!geminiTts.test(item.id) && item.id !== REFERENCE_SPEECH_MODEL)
    )
      continue;
    if (item.id === REFERENCE_SPEECH_MODEL) {
      if (
        typeof item.name === 'string' &&
        item.name.length > 0 &&
        item.name.length <= 512 &&
        object(item.architecture) &&
        Array.isArray(item.architecture.output_modalities) &&
        item.architecture.output_modalities.includes('speech') &&
        !ids.has(item.id)
      ) {
        ids.add(item.id);
        models.push({
          id: item.id,
          name: item.name,
          voices: ['reference'],
          referenceVoice: true,
        });
      }
      continue;
    }
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

export function speechBody(request: SpeechRequest): string {
  const referenceModel = request.model === REFERENCE_SPEECH_MODEL;
  aiInvariant(
    typeof request.model === 'string' &&
      (geminiTts.test(request.model) || referenceModel),
    'MODEL_UNSUPPORTED',
    'Select a supported speech model.',
  );
  aiInvariant(
    referenceModel
      ? request.voice === 'reference' && !!request.reference
      : !request.reference,
    'INVALID_REQUEST',
    'Choose a saved voice for a reference-capable speech model.',
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
  if (request.reference) {
    const { data, transcript } = request.reference;
    aiInvariant(
      typeof data === 'string' &&
        data.length <= Math.ceil(SPEECH_REFERENCE_BYTES / 3) * 4 &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(data) &&
        data.length % 4 === 0 &&
        typeof transcript === 'string' &&
        transcript.trim().length > 0 &&
        transcript.length <= 5000,
      'INVALID_REQUEST',
      'The saved voice reference is invalid or too large.',
    );
    const bytes = Uint8Array.from(atob(data), (character) =>
      character.charCodeAt(0),
    );
    const header = new DataView(bytes.buffer);
    aiInvariant(
      bytes.length >= 46 &&
        bytes.length <= SPEECH_REFERENCE_BYTES &&
        header.getUint32(0) === 0x52494646 &&
        header.getUint32(8) === 0x57415645 &&
        header.getUint32(12) === 0x666d7420 &&
        header.getUint32(16, true) === 16 &&
        header.getUint16(20, true) === 1 &&
        header.getUint16(22, true) === 1 &&
        header.getUint32(24, true) === 24000 &&
        header.getUint16(34, true) === 16 &&
        header.getUint32(36) === 0x64617461 &&
        header.getUint32(40, true) === bytes.length - 44 &&
        (bytes.length - 44) % 2 === 0,
      'INVALID_REQUEST',
      'The saved voice reference must be a 24 kHz mono WAV.',
    );
    return JSON.stringify({
      model: request.model,
      input: request.script,
      response_format: 'mp3',
      input_references: [
        {
          type: 'input_audio',
          input_audio: { data: `data:audio/wav;base64,${data}` },
        },
        { type: 'text', text: transcript },
      ],
      provider: { data_collection: 'deny' },
    });
  }
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
    provider: { data_collection: 'deny' },
  });
}

/** Never parse remote JSON/error text as audio; bound bytes while consuming. */
export async function readSpeechAudio(
  response: Response,
  signal: AbortSignal,
  format: 'pcm' | 'mp3' = 'pcm',
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
      .toLowerCase() !== (format === 'mp3' ? 'audio/mpeg' : 'audio/pcm')
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
    invalid(bytes >= 2 && (format === 'mp3' || bytes % 2 === 0));
    const pcm = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      pcm.set(chunk, offset);
      offset += chunk.length;
    }
    if (format === 'mp3') {
      const context = new AudioContext({
        sampleRate: SPEECH_LIMITS.sampleRate,
      });
      try {
        const decoded = await context.decodeAudioData(pcm.buffer);
        check();
        invalid(
          decoded.sampleRate === SPEECH_LIMITS.sampleRate &&
            decoded.numberOfChannels === 1 &&
            decoded.length > 0 &&
            decoded.length <= 12_000_000,
        );
        const channel = decoded.getChannelData(0);
        invalid(channel.every((sample) => Number.isFinite(sample)));
        // Lossy decoding can overshoot full scale; normalize to the PCM contract.
        const samples = Float32Array.from(channel, (sample) =>
          Math.max(-1, Math.min(1, sample)),
        );
        return { samples, sampleRate: SPEECH_LIMITS.sampleRate };
      } catch (error) {
        check();
        if (error instanceof AiError) throw error;
        throw new AiError(
          'INVALID_RESPONSE',
          'The speech audio could not be decoded.',
        );
      } finally {
        await context.close();
      }
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
