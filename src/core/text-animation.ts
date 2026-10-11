import type { TextStyleInput } from './text-library';

/** Clip-local time, evaluated without clocks or randomness in samples and exports. */
export function textAnimationFrame(style: TextStyleInput, timeUs: number) {
  const animation = style.animation;
  if (!animation) return { text: style.text, x: 0, y: 0, rotation: 0 };
  const step = Math.floor(Math.max(0, timeUs) / (animation.stepMs * 1000));
  if (animation.kind === 'typewriter') {
    const chars = [
      ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
        style.text,
      ),
    ].map((part) => part.segment);
    const count = animation.loop ? step % (chars.length + 8) : step;
    return { text: chars.slice(0, count).join(''), x: 0, y: 0, rotation: 0 };
  }
  const count = animation.variations?.length ?? animation.frames ?? 4;
  const frame = animation.loop ? step % count : Math.min(step, count - 1);
  const poses = [
    [-2, 1, -0.012],
    [2, -2, 0.016],
    [-1, -1, -0.006],
    [1, 2, 0.009],
    [0, -2, -0.018],
  ];
  const [x, y, rotation] = poses[frame]!;
  return {
    text: animation.variations?.[frame] ?? style.text,
    x: x!,
    y: y!,
    rotation: rotation!,
  };
}
