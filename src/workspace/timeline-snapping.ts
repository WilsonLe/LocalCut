import type { Project } from '../editor';

/** Every track contributes clip edges, including overlaps, audio and captions. */
export function timelineSnapPoints(project: Project | null): number[] {
  return [
    ...new Set([
      0,
      ...(project?.tracks.flatMap((track) =>
        track.clips.flatMap((clip) => [
          clip.startUs,
          clip.startUs + clip.durationUs,
        ]),
      ) ?? []),
    ]),
  ].sort((a, b) => a - b);
}

/** Use screen pixels so zoom, scrolling and interface size never widen the magnet. */
export function snapTimelineTime(
  timeUs: number,
  points: readonly number[],
  totalUs: number,
  laneScreenWidth: number,
): number {
  if (totalUs <= 0 || laneScreenWidth <= 0) return timeUs;
  const thresholdUs = (8 * totalUs) / laneScreenWidth;
  let nearest = timeUs;
  let distance = Infinity;
  for (const point of points) {
    const nextDistance = Math.abs(point - timeUs);
    if (nextDistance <= thresholdUs && nextDistance < distance) {
      nearest = point;
      distance = nextDistance;
    }
  }
  return Math.round(Math.min(totalUs - 1, Math.max(0, nearest)));
}
