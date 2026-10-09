import type { Cue } from '../core/model';
import { invariant } from '../core/errors';

interface Segment {
  text: string;
  timestamp: readonly [number | null, number | null];
}

/** Model sample padding must never extend a cue past the requested source range. */
export function sourceCues(
  segments: readonly Segment[],
  startUs: number,
  endUs: number,
): Cue[] {
  invariant(
    Number.isSafeInteger(startUs) &&
      Number.isSafeInteger(endUs) &&
      startUs >= 0 &&
      endUs > startUs,
    'INVALID_COMMAND',
    'Invalid transcript source range',
  );
  const cues: Cue[] = [];
  for (const segment of segments) {
    const [start, end] = segment.timestamp;
    if (start === null || !Number.isFinite(start)) continue;
    const timeUs = Math.min(
      endUs,
      Math.max(startUs, startUs + Math.round(start * 1e6)),
    );
    const cueEndUs =
      end === null
        ? endUs
        : Math.min(endUs, Math.max(startUs, startUs + Math.round(end * 1e6)));
    if (Number.isFinite(cueEndUs) && cueEndUs > timeUs)
      cues.push({
        id: crypto.randomUUID(),
        timeUs,
        endUs: cueEndUs,
        text: segment.text.trim(),
      });
  }
  return cues;
}
