import { expect, it } from 'vitest';
import { snapTimelineTime } from '../../src/workspace/timeline-snapping';

it('attracts the nearest boundary within eight screen pixels, with earlier ties', () => {
  const points = [0, 1_000_000, 1_050_000, 3_000_000, 4_000_000];
  expect(snapTimelineTime(1_020_000, points, 4_000_000, 400)).toBe(1_000_000);
  expect(snapTimelineTime(1_040_000, points, 4_000_000, 400)).toBe(1_050_000);
  expect(snapTimelineTime(1_025_000, points, 4_000_000, 400)).toBe(1_000_000);
  expect(snapTimelineTime(2_000_000, points, 4_000_000, 400)).toBe(2_000_000);
  expect(snapTimelineTime(3_999_999, points, 4_000_000, 400)).toBe(3_999_999);
  expect(snapTimelineTime(50_000, points, 4_000_000, 400)).toBe(0);
});
it('keeps the magnet radius in screen pixels as the timeline grows', () => {
  const points = [0, 1_000_000, 4_000_000];
  // 80 ms spans 8 px at fit, but 16 px after zooming to twice the width.
  expect(snapTimelineTime(1_080_000, points, 4_000_000, 400)).toBe(1_000_000);
  expect(snapTimelineTime(1_080_001, points, 4_000_000, 400)).toBe(1_080_001);
  expect(snapTimelineTime(1_080_000, points, 4_000_000, 800)).toBe(1_080_000);
});
