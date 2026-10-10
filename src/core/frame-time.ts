import type { Project } from './model';

// Shared by initial keyboard controls without loading source/audio timing.
export function frameTimeUs(index: number, rate: Project['frameRate']): number {
  return Math.round((index * 1_000_000 * rate.den) / rate.num);
}
