import { aiInvariant } from './errors';
/** Timestamped STT uses the standard verbose_json contract, not untimed plain text. */
export function transcriptionBody(request: {
  model: string;
  audio: Float32Array;
  language?: string;
}): FormData {
  aiInvariant(
    /^~?[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(request.model) &&
      request.audio instanceof Float32Array &&
      request.audio.length > 0 &&
      request.audio.length * 2 + 44 <= 25_000_000 &&
      (!request.language ||
        /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(request.language)),
    'INVALID_REQUEST',
    'STT requires a timestamp-capable model, valid language, and at most 25 MB of 16 kHz audio.',
  );
  const buffer = new ArrayBuffer(44 + request.audio.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(offset + i, value.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, buffer.byteLength - 44, true);
  for (let i = 0; i < request.audio.length; i++) {
    const sample = request.audio[i]!;
    aiInvariant(
      Number.isFinite(sample),
      'INVALID_REQUEST',
      'Audio contains invalid samples.',
    );
    view.setInt16(
      44 + i * 2,
      Math.round(
        Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767),
      ),
      true,
    );
  }
  const body = new FormData();
  body.set('file', new Blob([buffer], { type: 'audio/wav' }), 'audio.wav');
  body.set('model', request.model);
  body.set('response_format', 'verbose_json');
  body.set('timestamp_granularities[]', 'segment');
  if (request.language) body.set('language', request.language);
  return body;
}
export function transcriptionSegments(
  value: unknown,
  duration: number,
): { text: string; timestamp: [number, number] }[] {
  const segments = (value as { segments?: unknown[] })?.segments;
  aiInvariant(
    Array.isArray(segments) && segments.length <= 20000,
    'INVALID_RESPONSE',
    'STT returned no bounded timestamp segments.',
  );
  let previous = -1;
  return segments.map((item) => {
    const s = item as { text?: unknown; start?: unknown; end?: unknown };
    aiInvariant(
      s &&
        typeof s.text === 'string' &&
        s.text.length <= 32768 &&
        typeof s.start === 'number' &&
        Number.isFinite(s.start) &&
        typeof s.end === 'number' &&
        Number.isFinite(s.end) &&
        s.start >= previous &&
        s.start >= 0 &&
        s.end > s.start &&
        s.start < duration &&
        s.end <= duration + 0.1,
      'INVALID_RESPONSE',
      'STT returned invalid or unordered timestamps.',
    );
    previous = s.start;
    return {
      text: s.text.trim(),
      timestamp: [s.start, Math.min(s.end, duration)],
    };
  });
}
