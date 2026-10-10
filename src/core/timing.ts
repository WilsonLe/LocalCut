import { sourcePositionUs, localTimeForSource } from './speed';
import type { Clip, Keyframe, Parameter, Cue } from './model';
export { frameTimeUs } from './frame-time';
export function sourceTimeUs(clip: Clip, timeUs: number): number {
  return Math.round(sourcePositionUs(clip, timeUs - clip.startUs));
}
export function evaluateKeys(
  keys: Keyframe[],
  timeUs: number,
  fallback: number,
): number {
  if (!keys.length) return fallback;
  const first = keys[0]!,
    last = keys.at(-1)!;
  if (timeUs <= first.timeUs) return first.value;
  if (timeUs >= last.timeUs) return last.value;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!,
      a = keys[i - 1]!;
    if (timeUs < b.timeUs)
      return a.interpolation === 'hold'
        ? a.value
        : a.value +
            ((b.value - a.value) * (timeUs - a.timeUs)) / (b.timeUs - a.timeUs);
  }
  return last.value;
}
export function valueAt(
  clip: Clip,
  parameter: Parameter,
  timeUs: number,
): number {
  return evaluateKeys(
    clip.keyframes[parameter] ?? [],
    timeUs - clip.startUs,
    clip[parameter],
  );
}
export function gainAt(clip: Clip, timeUs: number): number {
  const local = timeUs - clip.startUs;
  if (clip.muted || local < 0 || local >= clip.durationUs) return 0;
  const envelopeLocal = local + (clip.fadeEnvelope?.offsetUs ?? 0),
    envelopeDuration = clip.fadeEnvelope?.durationUs ?? clip.durationUs;
  let gain = valueAt(clip, 'gain', timeUs);
  if (clip.fadeInUs) gain *= Math.min(1, envelopeLocal / clip.fadeInUs);
  if (clip.fadeOutUs)
    gain *= Math.min(1, (envelopeDuration - envelopeLocal) / clip.fadeOutUs);
  return gain;
}
export function mapSourceCue(cue: Cue, clip: Clip): Cue | undefined {
  const a = Math.max(cue.timeUs, clip.sourceInUs),
    b = Math.min(cue.endUs, clip.sourceOutUs ?? Infinity);
  if (a >= b) return undefined;
  return {
    ...cue,
    timeUs: clip.startUs + Math.round(localTimeForSource(clip, a)),
    endUs: clip.startUs + Math.round(localTimeForSource(clip, b)),
  };
}
