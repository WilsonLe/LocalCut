import { AiError, aiInvariant } from './errors';
import type { SpeechAudio } from './types';

export type SpeechTiming =
  | { mode: 'speed'; speed: number }
  | { mode: 'duration'; durationSeconds: number };
export interface RenderedSpeech {
  file: File;
  durationUs: number;
  speed: number;
}
/** Validate user timing before generation, when the source duration is still unknown. */
export function validateSpeechTiming(timing: SpeechTiming): void {
  aiInvariant(
    timing.mode === 'speed' || timing.mode === 'duration',
    'INVALID_REQUEST',
    'Choose speed or total length.',
  );
  const valid =
    timing.mode === 'speed'
      ? Number.isFinite(timing.speed) &&
        timing.speed >= 0.5 &&
        timing.speed <= 2
      : Number.isFinite(timing.durationSeconds) && timing.durationSeconds > 0;
  aiInvariant(
    valid,
    'INVALID_REQUEST',
    timing.mode === 'speed'
      ? 'Choose a speed from 0.5 to 2×.'
      : 'Enter a positive total length in seconds.',
  );
}

/** WSOLA: align overlapping waveform windows instead of changing sample pitch. */
async function stretch(
  input: Float32Array,
  frames: number,
  signal: AbortSignal,
): Promise<Float32Array> {
  const check = () => {
    if (signal.aborted)
      throw new AiError('CANCELLED', 'Speech adjustment cancelled.');
  };
  check();
  if (frames === input.length) return input;
  aiInvariant(
    input.length >= 1920,
    'INVALID_RESPONSE',
    'Speech audio is too short to adjust naturally.',
  );
  const size = 960,
    hop = 240,
    search = 240;
  const output = new Float32Array(frames);
  const weights = new Float32Array(frames);
  const window = Float32Array.from(
    { length: size },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)),
  );
  let previous = 0,
    count = 0;
  const lastPosition = frames - size;
  for (let position = 0; ; position = Math.min(position + hop, lastPosition)) {
    if (++count % 64 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      check();
    }
    const expected =
      lastPosition > 0
        ? Math.round((position / lastPosition) * (input.length - size))
        : 0;
    let chosen = Math.max(0, expected);
    if (position && position !== lastPosition) {
      let best = -Infinity;
      const low = Math.max(0, expected - search);
      const high = Math.min(input.length - size, expected + search);
      // Compare the overlap with the prior source window; the output grid stays fixed.
      for (let candidate = low; candidate <= high; candidate += 8) {
        let dot = 0,
          a2 = 0,
          b2 = 0;
        for (let i = 0; i < size - hop; i += 8) {
          const a = input[previous + hop + i] ?? 0;
          const b = input[candidate + i]!;
          dot += a * b;
          a2 += a * a;
          b2 += b * b;
        }
        const score =
          dot / Math.sqrt(Math.max(1e-12, a2 * b2)) -
          Math.abs(candidate - expected) * 1e-7;
        if (score > best) {
          best = score;
          chosen = candidate;
        }
      }
    }
    for (let i = 0; i < size && position + i < frames; i++) {
      const weight =
        (position === 0 && i < hop) ||
        (position === lastPosition && i >= size - hop)
          ? 1
          : window[i]!;
      output[position + i] =
        output[position + i]! + input[chosen + i]! * weight;
      weights[position + i] = weights[position + i]! + weight;
    }
    previous = chosen;
    if (position === lastPosition) break;
  }
  for (let i = 0; i < frames; i++)
    output[i] = weights[i]! > 1e-8 ? output[i]! / weights[i]! : 0;
  check();
  return output;
}

/** A normal WAV asset: timing is baked in, so preview and export hear identical audio. */
export async function renderSpeech(
  audio: SpeechAudio,
  timing: SpeechTiming,
  signal: AbortSignal,
): Promise<RenderedSpeech> {
  validateSpeechTiming(timing);
  aiInvariant(
    audio.sampleRate === 24000 &&
      audio.samples.length > 0 &&
      audio.samples.length <= 12_000_000 &&
      audio.samples.every(
        (sample) => Number.isFinite(sample) && Math.abs(sample) <= 1,
      ),
    'INVALID_RESPONSE',
    'Speech audio is invalid.',
  );
  const seconds = audio.samples.length / audio.sampleRate;
  const speed =
    timing.mode === 'speed' ? timing.speed : seconds / timing.durationSeconds;
  aiInvariant(
    Number.isFinite(speed) && speed >= 0.5 && speed <= 2,
    'INVALID_REQUEST',
    `Choose a speed from 0.5 to 2×, or a duration from ${(seconds / 2).toFixed(2)} to ${(seconds * 2).toFixed(2)} seconds.`,
  );
  const frames = Math.round(audio.samples.length / speed);
  const samples = await stretch(audio.samples, frames, signal);
  const buffer = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++)
    view.setInt16(
      44 + i * 2,
      Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767),
      true,
    );
  if (signal.aborted)
    throw new AiError('CANCELLED', 'Speech adjustment cancelled.');
  return {
    file: new File([buffer], 'Speech.wav', { type: 'audio/wav' }),
    durationUs: Math.round((frames / audio.sampleRate) * 1e6),
    speed,
  };
}
