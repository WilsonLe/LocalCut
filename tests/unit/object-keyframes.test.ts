import { expect, it } from 'vitest';
import { applyOperations } from '../../src/core/commands';
import { clipSchema, newProject } from '../../src/core/model';
import { valueAt } from '../../src/core/timing';
import {
  copySelection,
  pasteSelection,
} from '../../src/workspace/editing-actions';

it('keeps shared-asset placements and earlier snapshots immutable through animation, duplicate, split and paste', () => {
  const original = {
    ...newProject('Independent objects'),
    tracks: [
      {
        id: 'track',
        kind: 'video' as const,
        muted: false,
        clips: ['first', 'second'].map((id, index) =>
          clipSchema.parse({
            id,
            kind: 'image',
            assetId: 'shared-source',
            startUs: index * 2e6,
            durationUs: 2e6,
          }),
        ),
      },
    ],
  };
  const frozen = structuredClone(original);
  const animated = applyOperations(original, [
    {
      type: 'updateClip',
      clipId: 'first',
      patch: {
        keyframes: {
          x: [
            { id: 'x-start', timeUs: 0, value: 0, interpolation: 'linear' },
            { id: 'x-end', timeUs: 2e6, value: 100, interpolation: 'linear' },
          ],
          opacity: [
            { id: 'alpha-start', timeUs: 0, value: 1, interpolation: 'hold' },
            {
              id: 'alpha-end',
              timeUs: 1e6,
              value: 0.5,
              interpolation: 'linear',
            },
          ],
        },
      },
    },
  ]).project;
  expect(original).toEqual(frozen);
  expect(animated.tracks[0]!.clips[1]).toEqual(original.tracks[0]!.clips[1]);
  expect(valueAt(animated.tracks[0]!.clips[0]!, 'x', 1e6)).toBe(50);
  expect(valueAt(animated.tracks[0]!.clips[0]!, 'opacity', 999999)).toBe(1);
  expect(valueAt(animated.tracks[0]!.clips[0]!, 'opacity', 1e6)).toBe(0.5);
  const duplicated = applyOperations(animated, [
    {
      type: 'duplicateClip',
      clipId: 'first',
      newClipId: 'duplicate',
      trackId: 'track',
      startUs: 4e6,
    },
  ]).project;
  const pasted = applyOperations(
    duplicated,
    pasteSelection(duplicated, copySelection(duplicated, ['first']), 6e6)
      .operations,
  ).project;
  const split = applyOperations(pasted, [
    { type: 'splitClip', clipId: 'first', atUs: 1e6, rightClipId: 'right' },
  ]).project;
  const clips = split.tracks[0]!.clips;
  const keys = clips.flatMap((clip) => Object.values(clip.keyframes).flat());
  expect(new Set(keys.map((key) => key.id)).size).toBe(keys.length);
  expect(clips.every((clip) => clip.assetId === 'shared-source')).toBe(true);
  const retained = structuredClone(split);
  const changed = applyOperations(split, [
    {
      type: 'updateClip',
      clipId: 'duplicate',
      patch: { x: -80, keyframes: {} },
    },
  ]).project;
  expect(split).toEqual(retained);
  expect(
    changed.tracks[0]!.clips.filter((clip) => clip.id !== 'duplicate'),
  ).toEqual(split.tracks[0]!.clips.filter((clip) => clip.id !== 'duplicate'));
  expect(
    valueAt(
      clips.find((clip) => clip.id === 'right')!,
      'x',
      1e6,
    ),
  ).toBe(50);
  expect(() =>
    applyOperations(split, [
      {
        type: 'updateClip',
        clipId: 'second',
        patch: {
          keyframes: {
            opacity: [
              { id: 'bad', timeUs: 3e6, value: 2, interpolation: 'linear' },
            ],
          },
        },
      },
    ]),
  ).toThrow();
  expect(split).toEqual(retained);
});
