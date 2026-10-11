import { expect, it } from 'vitest';
import { newProject, clipSchema, validateProject } from '../../src/core/model';
import { applyOperations } from '../../src/core/commands';
import {
  loopDurationUs,
  sourcePositionUs,
  rampPreset,
  speedAt,
} from '../../src/core/speed';
import { mapSourceCue, evaluateKeys } from '../../src/core/timing';

const project = () => ({
  ...newProject('Loop'),
  tracks: [
    {
      id: 'v',
      kind: 'video' as const,
      muted: false,
      clips: [
        clipSchema.parse({
          id: 'c',
          kind: 'video',
          assetId: 'asset',
          startUs: 200000,
          sourceInUs: 100000,
          sourceOutUs: 2100000,
          durationUs: 2000000,
        }),
      ],
    },
  ],
});
it('resizes without changing source bounds and wraps at each half-open source end', () => {
  const original = project();
  const resized = applyOperations(original, [
    { type: 'resizeClip', clipId: 'c', durationUs: 5500000 },
  ]).project;
  const clip = resized.tracks[0]!.clips[0]!;
  expect(clip.sourceInUs).toBe(100000);
  expect(clip.sourceOutUs).toBe(2100000);
  expect(sourcePositionUs(clip, 1999999)).toBe(2099999);
  expect(sourcePositionUs(clip, 2000000)).toBe(100000);
  expect(sourcePositionUs(clip, 4000000)).toBe(100000);
  expect(original.tracks[0]!.clips[0]!.loop).toBeUndefined();
  const shortened = applyOperations(resized, [
    { type: 'resizeClip', clipId: 'c', durationUs: 750000 },
  ]).project;
  expect(shortened.tracks[0]!.clips[0]!.durationUs).toBe(750000);
  expect(sourcePositionUs(shortened.tracks[0]!.clips[0]!, 500000)).toBe(600000);
  expect(() =>
    applyOperations(original, [
      { type: 'resizeClip', clipId: 'c', durationUs: 0 },
    ]),
  ).toThrow();
});
it('splits loops without changing phase, duplicates, separates audio and retimes speed/ramp', () => {
  let p = applyOperations(project(), [
    { type: 'resizeClip', clipId: 'c', durationUs: 5500000 },
  ]).project;
  const original = p.tracks[0]!.clips[0]!;
  p = applyOperations(p, [
    { type: 'splitClip', clipId: 'c', atUs: 2700000, rightClipId: 'right' },
  ]).project;
  const right = p.tracks[0]!.clips[1]!;
  expect(right.loop?.offsetUs).toBe(500000);
  for (const local of [0, 500000, 1500000, 2000000])
    expect(sourcePositionUs(right, local)).toBe(
      sourcePositionUs(original, 2500000 + local),
    );
  const fast = applyOperations(p, [
    { type: 'setSpeed', clipId: 'right', speed: 2 },
  ]).project.tracks[0]!.clips[1]!;
  expect(fast.durationUs).toBe(1500000);
  expect(fast.loop?.offsetUs).toBe(250000);
  expect(sourcePositionUs(fast, 0)).toBe(sourcePositionUs(right, 0));
  const ramped = applyOperations(p, [
    {
      type: 'setSpeedRamp',
      clipId: 'right',
      points: rampPreset('up', 'linear'),
    },
  ]).project.tracks[0]!.clips[1]!;
  const cycle = loopDurationUs(ramped);
  expect(sourcePositionUs(ramped, 12345)).toBeCloseTo(
    sourcePositionUs(ramped, 12345 + cycle),
    5,
  );
  expect(speedAt(ramped, 12345)).toBeCloseTo(speedAt(ramped, 12345 + cycle), 8);
  const separated = applyOperations(p, [
    { type: 'addTrack', track: { id: 'a', kind: 'audio' } },
    {
      type: 'separateAudio',
      clipId: 'right',
      trackId: 'a',
      audioClipId: 'separated',
    },
  ]).project;
  expect(separated.tracks[1]!.clips[0]!.loop).toEqual(right.loop);
  expect(() =>
    validateProject({
      ...p,
      tracks: [
        { ...p.tracks[0]!, clips: [{ ...right, loop: { offsetUs: 2000000 } }] },
      ],
    }),
  ).toThrow();
});
it('maps source transcript captions into the current repeat and retains trimmed source range', () => {
  const clip = applyOperations(project(), [
    { type: 'resizeClip', clipId: 'c', durationUs: 5500000 },
  ]).project.tracks[0]!.clips[0]!;
  const cue = { id: 'cue', timeUs: 200000, endUs: 400000, text: 'Hello' };
  expect(mapSourceCue(cue, clip, 2300000)).toMatchObject({
    timeUs: 2300000,
    endUs: 2500000,
  });
  const trimmed = applyOperations(
    { ...project(), tracks: [{ ...project().tracks[0]!, clips: [clip] }] },
    [
      {
        type: 'trimClip',
        clipId: 'c',
        sourceInUs: 500000,
        sourceOutUs: 1500000,
      },
    ],
  ).project.tracks[0]!.clips[0]!;
  expect(trimmed.loop).toBeUndefined();
  expect(trimmed.durationUs).toBe(1000000);
});

it('shortening preserves linear and hold automation through an evaluated boundary', () => {
  const p = project();
  const clip = p.tracks[0]!.clips[0]!;
  clip.keyframes = {
    opacity: [
      { id: 'opacity-start', timeUs: 0, value: 0, interpolation: 'linear' },
      { id: 'opacity-end', timeUs: 2000000, value: 1, interpolation: 'linear' },
    ],
    gain: [
      { id: 'gain-start', timeUs: 0, value: 1, interpolation: 'hold' },
      { id: 'gain-end', timeUs: 1500000, value: 0.4, interpolation: 'linear' },
    ],
  };
  const shortened = applyOperations(p, [
    { type: 'resizeClip', clipId: 'c', durationUs: 1000000 },
  ]).project.tracks[0]!.clips[0]!;
  expect(shortened.keyframes.opacity![0]!.id).toBe('opacity-start');
  expect(shortened.keyframes.opacity!.at(-1)).toMatchObject({
    timeUs: 1000000,
    value: 0.5,
  });
  expect(shortened.keyframes.gain![0]!.id).toBe('gain-start');
  expect(shortened.keyframes.gain!.at(-1)).toMatchObject({
    timeUs: 1000000,
    value: 1,
    interpolation: 'hold',
  });
  for (const time of [0, 250000, 500000, 750000, 999999]) {
    expect(
      evaluateKeys(shortened.keyframes.opacity!, time, shortened.opacity),
    ).toBe(time / 2000000);
    expect(evaluateKeys(shortened.keyframes.gain!, time, shortened.gain)).toBe(
      1,
    );
  }
  const extended = applyOperations(p, [
    { type: 'resizeClip', clipId: 'c', durationUs: 3000000 },
  ]).project.tracks[0]!.clips[0]!;
  expect(extended.keyframes).toEqual(clip.keyframes);
});
