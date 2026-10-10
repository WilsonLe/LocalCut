import type { SpeedPoint, SpeedRamp } from './speed-schema';
export type { SpeedPoint, SpeedRamp } from './speed-schema';
type Timing = {
  speed: number;
  speedRamp?: SpeedRamp;
  durationUs: number;
  sourceInUs: number;
  sourceOutUs?: number;
};
function coefficients(a: SpeedPoint) {
  const u = a.curveStart ?? 0,
    d = (a.curveEnd ?? 1) - u;
  return [6 * u * (1 - u), d * (3 - 6 * u), -2 * d * d];
}
function fraction(a: SpeedPoint, t: number) {
  if (a.interpolation === 'hold') return 0;
  if (a.interpolation === 'linear') return t;
  const [c1, c2, c3] = coefficients(a) as [number, number, number];
  return (c1 * t + c2 * t * t + c3 * t ** 3) / (c1 + c2 + c3);
}
function area(a: SpeedPoint, b: SpeedPoint, t: number) {
  let integrated = 0;
  if (a.interpolation === 'linear') integrated = (t * t) / 2;
  if (a.interpolation === 'smooth') {
    const [c1, c2, c3] = coefficients(a) as [number, number, number];
    integrated =
      ((c1 * t * t) / 2 + (c2 * t ** 3) / 3 + (c3 * t ** 4) / 4) /
      (c1 + c2 + c3);
  }
  return (
    (b.position - a.position) * (a.speed * t + (b.speed - a.speed) * integrated)
  );
}
export function rampIntegral(points: SpeedRamp, position = 1) {
  let result = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!;
    if (position <= a.position) break;
    result += area(
      a,
      b,
      Math.min(1, (position - a.position) / (b.position - a.position)),
    );
  }
  return result;
}
export function rampSpeed(points: SpeedRamp, position: number) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!;
    if (position < b.position)
      return (
        a.speed +
        (b.speed - a.speed) *
          fraction(
            a,
            Math.max(0, (position - a.position) / (b.position - a.position)),
          )
      );
  }
  return points.at(-1)!.speed;
}
export function averageSpeed(clip: Pick<Timing, 'speed' | 'speedRamp'>) {
  return clip.speedRamp ? rampIntegral(clip.speedRamp) : clip.speed;
}
export function sourceDurationUs(
  clip: Pick<Timing, 'speed' | 'speedRamp'>,
  sourceUs: number,
) {
  return Math.round(sourceUs / averageSpeed(clip));
}
export function sourcePositionUs(clip: Timing, localUs: number) {
  if (!clip.speedRamp) return clip.sourceInUs + localUs * clip.speed;
  const p = Math.max(0, Math.min(1, localUs / clip.durationUs));
  return (
    clip.sourceInUs +
    ((clip.sourceOutUs! - clip.sourceInUs) * rampIntegral(clip.speedRamp, p)) /
      rampIntegral(clip.speedRamp)
  );
}
export function localTimeForSource(clip: Timing, sourceUs: number) {
  if (!clip.speedRamp) return (sourceUs - clip.sourceInUs) / clip.speed;
  let a = 0,
    b = 1;
  for (let i = 0; i < 48; i++) {
    const mid = (a + b) / 2;
    if (sourcePositionUs(clip, mid * clip.durationUs) < sourceUs) a = mid;
    else b = mid;
  }
  return ((a + b) / 2) * clip.durationUs;
}
export function speedAt(clip: Timing, localUs: number) {
  return clip.speedRamp
    ? (rampSpeed(clip.speedRamp, localUs / clip.durationUs) *
        (clip.sourceOutUs! - clip.sourceInUs)) /
        clip.durationUs /
        rampIntegral(clip.speedRamp)
    : clip.speed;
}
export function sliceRamp(
  points: SpeedRamp,
  from: number,
  to: number,
): SpeedRamp {
  const cuts = [
    from,
    ...points.map((p) => p.position).filter((p) => p > from && p < to),
    to,
  ];
  return cuts.map((p, i) => {
    const segment = points.findIndex(
      (point, j) =>
        j < points.length - 1 &&
        p >= point.position &&
        p < points[j + 1]!.position,
    );
    const a = points[segment < 0 ? points.length - 1 : segment]!;
    const point: SpeedPoint = {
      position: (p - from) / (to - from),
      speed: rampSpeed(points, p),
      interpolation: a.interpolation,
    };
    if (i < cuts.length - 1 && a.interpolation === 'smooth') {
      const b = points[segment + 1]!,
        u = a.curveStart ?? 0,
        v = a.curveEnd ?? 1;
      point.curveStart =
        u + ((v - u) * (p - a.position)) / (b.position - a.position);
      point.curveEnd =
        u + ((v - u) * (cuts[i + 1]! - a.position)) / (b.position - a.position);
    }
    return point;
  });
}
export function rampPreset(
  direction: 'up' | 'down' | 'up-down' | 'down-up',
  interpolation: SpeedPoint['interpolation'] = 'smooth',
): SpeedRamp {
  const speeds =
    direction === 'up'
      ? [0.5, 2]
      : direction === 'down'
        ? [2, 0.5]
        : direction === 'up-down'
          ? [0.5, 2, 0.5]
          : [2, 0.5, 2];
  if (interpolation === 'hold') {
    const steps =
      direction === 'up'
        ? Array.from({ length: 8 }, (_, i) => 0.5 + (1.5 * i) / 7)
        : direction === 'down'
          ? Array.from({ length: 8 }, (_, i) => 2 - (1.5 * i) / 7)
          : direction === 'up-down'
            ? [0.5, 1, 1.5, 2, 2, 1.5, 1, 0.5]
            : [2, 1.5, 1, 0.5, 0.5, 1, 1.5, 2];
    return [...steps, steps.at(-1)!].map((speed, i) => ({
      position: i / steps.length,
      speed,
      interpolation,
    }));
  }
  return speeds.map((speed, i) => ({
    position: i / (speeds.length - 1),
    speed,
    interpolation,
  }));
}
