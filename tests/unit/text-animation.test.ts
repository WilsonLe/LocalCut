import { describe, expect, it } from 'vitest';
import { textAnimationFrame } from '../../src/core/text-animation';
import { textStyleSchema } from '../../src/core/model';
import type { TextStyleInput } from '../../src/core/text-library';

describe('deterministic text animation', () => {
  it('reveals whole graphemes, holds completed typing, and loops only when requested', () => {
    const style: TextStyleInput = {
      text: 'a👩🏽‍🎨é',
      animation: { kind: 'typewriter', stepMs: 100, loop: false },
    };
    expect(textAnimationFrame(style, 0).text).toBe('');
    expect(textAnimationFrame(style, 100000).text).toBe('a');
    expect(textAnimationFrame(style, 200000).text).toBe('a👩🏽‍🎨');
    expect(textAnimationFrame(style, 300000).text).toBe(style.text);
    expect(textAnimationFrame(style, 9000000).text).toBe(style.text);
    style.animation!.loop = true;
    expect(textAnimationFrame(style, 1000000).text).toBe(style.text);
    expect(textAnimationFrame(style, 1100000).text).toBe('');
  });
  it.each([3, 4, 5])(
    'cycles exactly %i handmade poses and clamps non-looping playback',
    (frames) => {
      const style: TextStyleInput = {
        text: 'hello',
        animation: { kind: 'handmade', frames, stepMs: 100, loop: true },
      };
      const poses = Array.from({ length: frames }, (_, n) =>
        textAnimationFrame(style, n * 100000),
      );
      expect(new Set(poses.map((pose) => JSON.stringify(pose))).size).toBe(
        frames,
      );
      expect(textAnimationFrame(style, frames * 100000)).toEqual(poses[0]);
      expect(textAnimationFrame(style, -1)).toEqual(poses[0]);
      style.animation!.loop = false;
      expect(textAnimationFrame(style, frames * 200000)).toEqual(poses.at(-1));
    },
  );
  it('cycles authored variations and preserves the optional animation in JSON', () => {
    const style = textStyleSchema.parse({
      text: 'fallback',
      animation: {
        kind: 'handmade',
        stepMs: 100,
        loop: true,
        variations: ['one', 'two', 'three'],
      },
    });
    expect(textStyleSchema.parse(JSON.parse(JSON.stringify(style)))).toEqual(
      style,
    );
    expect(
      [0, 100000, 200000, 300000].map(
        (time) => textAnimationFrame(style, time).text,
      ),
    ).toEqual(['one', 'two', 'three', 'one']);
    expect(
      textStyleSchema.safeParse({
        text: 'no',
        animation: { kind: 'handmade', stepMs: 0, loop: true },
      }).success,
    ).toBe(false);
    expect(
      textStyleSchema.safeParse({
        text: 'no',
        animation: {
          kind: 'handmade',
          stepMs: 100,
          loop: true,
          variations: [''],
        },
      }).success,
    ).toBe(false);
  });
});
