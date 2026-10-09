import { describe, expect, it } from 'vitest';
import { canonical } from '../../src/core/commands';
import { legacyCommandReceiptContent } from '../../src/core/receipt-content';

const envelope = {
  projectId: 'project',
  requestId: 'request',
  expectedRevision: 0,
};
function batch(...operations: unknown[]) {
  return { ...envelope, operations };
}

// Golden defaults from 984107dbf63dc95cc72f980b65bfaae6e86bc727, including
// defaults incorrectly inserted into updateClip patches by that release.
const clipDefaults = {
  sourceInUs: 0,
  speed: 1,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  rotation: 0,
  opacity: 1,
  gain: 1,
  muted: false,
  brightness: 1,
  contrast: 1,
  saturation: 1,
  grayscale: 0,
  blur: 0,
  fadeInUs: 0,
  fadeOutUs: 0,
  cues: [],
  keyframes: {},
};
const clip = {
  id: 'clip',
  kind: 'text',
  startUs: 0,
  durationUs: 1000000,
  text: { text: 'Title' },
  keyframes: {
    opacity: [
      { timeUs: 0, value: 0 },
      { timeUs: 1000000, value: 1, interpolation: 'hold' },
    ],
  },
};

describe('unversioned command receipt compatibility', () => {
  it('reproduces the exact base addTrack receipt with omitted defaults', () => {
    expect(
      legacyCommandReceiptContent(
        batch({ type: 'addTrack', track: { id: 'track', kind: 'video' } }),
      ),
    ).toBe(
      '{"expectedRevision":0,"operations":[{"track":{"clips":[],"id":"track","kind":"video","muted":false},"type":"addTrack"}],"projectId":"project","requestId":"request"}',
    );
  });

  it('reproduces base insertClip text and keyframe defaults without adding IDs', () => {
    const input = batch({ type: 'insertClip', trackId: 'track', clip });
    const untouched = structuredClone(input);
    expect(legacyCommandReceiptContent(input)).toBe(
      canonical(
        batch({
          type: 'insertClip',
          trackId: 'track',
          clip: {
            ...clipDefaults,
            ...clip,
            text: {
              text: 'Title',
              fontSize: 64,
              color: '#ffffff',
              background: 'transparent',
              align: 'center',
            },
            keyframes: {
              opacity: [
                { timeUs: 0, value: 0, interpolation: 'linear' },
                { timeUs: 1000000, value: 1, interpolation: 'hold' },
              ],
            },
          },
        }),
      ),
    );
    expect(input).toEqual(untouched);
  });

  it('preserves accidental base patch defaults for an identical update retry', () => {
    const input = batch({
      type: 'updateClip',
      clipId: 'clip',
      patch: { rotation: 90 },
    });
    expect(legacyCommandReceiptContent(input)).toBe(
      canonical(
        batch({
          type: 'updateClip',
          clipId: 'clip',
          patch: { ...clipDefaults, rotation: 90 },
        }),
      ),
    );
    expect(legacyCommandReceiptContent(input)).toBe(
      legacyCommandReceiptContent({
        operations: input.operations,
        requestId: 'request',
        expectedRevision: 0,
        projectId: 'project',
      }),
    );
  });

  it('preserves base keyframe normalization inside update patches and tracks', () => {
    const normalizedClip = JSON.parse(
      legacyCommandReceiptContent(
        batch({ type: 'insertClip', trackId: 'track', clip }),
      )!,
    ).operations[0].clip;
    expect(
      legacyCommandReceiptContent(
        batch({
          type: 'updateClip',
          clipId: 'clip',
          patch: { keyframes: clip.keyframes },
        }),
      ),
    ).toBe(
      canonical(
        batch({
          type: 'updateClip',
          clipId: 'clip',
          patch: { ...clipDefaults, keyframes: normalizedClip.keyframes },
        }),
      ),
    );
    expect(
      legacyCommandReceiptContent(
        batch({
          type: 'addTrack',
          track: { id: 'track', kind: 'overlay', clips: [clip] },
        }),
      ),
    ).toBe(
      canonical(
        batch({
          type: 'addTrack',
          track: {
            id: 'track',
            kind: 'overlay',
            muted: false,
            clips: [normalizedClip],
          },
        }),
      ),
    );
  });

  it('matches explicit legacy defaults but distinguishes a changed explicit value', () => {
    const input = batch({
      type: 'updateClip',
      clipId: 'clip',
      patch: { rotation: 90 },
    });
    const original = legacyCommandReceiptContent(input);
    expect(
      legacyCommandReceiptContent(
        batch({
          type: 'updateClip',
          clipId: 'clip',
          patch: { rotation: 90, opacity: 1 },
        }),
      ),
    ).toBe(original);
    expect(
      legacyCommandReceiptContent(
        batch({
          type: 'updateClip',
          clipId: 'clip',
          patch: { rotation: 90, opacity: 0.5 },
        }),
      ),
    ).not.toBe(original);
    expect(
      legacyCommandReceiptContent(
        batch({
          type: 'insertClip',
          trackId: 'track',
          clip: {
            ...clip,
            keyframes: { opacity: [{ timeUs: 0, value: 0.5 }] },
          },
        }),
      ),
    ).not.toBe(
      legacyCommandReceiptContent(
        batch({ type: 'insertClip', trackId: 'track', clip }),
      ),
    );
  });

  it.each(['insertClip', 'updateClip', 'addTrack'])(
    'rejects newly supplied keyframe IDs in %s rather than stripping them',
    (type) => {
      const keyframes = { opacity: [{ id: 'key', timeUs: 0, value: 0 }] };
      const operation =
        type === 'insertClip'
          ? { type, trackId: 'track', clip: { ...clip, keyframes } }
          : type === 'updateClip'
            ? { type, clipId: 'clip', patch: { keyframes } }
            : {
                type,
                track: {
                  id: 'track',
                  kind: 'overlay',
                  clips: [{ ...clip, keyframes }],
                },
              };
      expect(legacyCommandReceiptContent(batch(operation))).toBeUndefined();
    },
  );

  it.each([
    { ...envelope, operations: [], extra: true },
    batch({ type: 'removeClip', clipId: 'clip', extra: true }),
    batch({
      type: 'addTrack',
      track: { id: 'track', kind: 'video', extra: true },
    }),
    batch({
      type: 'insertClip',
      trackId: 'track',
      clip: { ...clip, extra: true },
    }),
    batch({ type: 'updateClip', clipId: 'clip', patch: { extra: true } }),
    batch({
      type: 'insertClip',
      trackId: 'track',
      clip: { ...clip, text: { text: 'Title', extra: true } },
    }),
    batch({
      type: 'updateClip',
      clipId: 'clip',
      patch: { keyframes: { opacity: [{ timeUs: 0, value: 1, extra: true }] } },
    }),
    batch({
      type: 'updateClip',
      clipId: 'clip',
      patch: {
        cues: [{ id: 'cue', timeUs: 0, endUs: 1, text: '', extra: true }],
      },
    }),
  ])('rejects unknown fields at every legacy object boundary: %j', (input) => {
    expect(legacyCommandReceiptContent(input)).toBeUndefined();
  });

  it('preserves all other base operation shapes without normalization', () => {
    const input = batch(
      { type: 'removeTrack', trackId: 'track' },
      { type: 'reorderTrack', trackId: 'track', index: 1 },
      { type: 'removeClip', clipId: 'clip' },
      { type: 'trimClip', clipId: 'clip', sourceInUs: 0, sourceOutUs: 1000000 },
      { type: 'splitClip', clipId: 'clip', atUs: 500000, rightClipId: 'right' },
      { type: 'moveClip', clipId: 'clip', trackId: 'track', startUs: 1000000 },
      {
        type: 'duplicateClip',
        clipId: 'clip',
        newClipId: 'copy',
        trackId: 'track',
        startUs: 1000000,
      },
      { type: 'setSpeed', clipId: 'clip', speed: 2 },
      { type: 'ripple', trackId: 'track', fromUs: 1000000, deltaUs: -500000 },
      {
        type: 'addTransition',
        transition: {
          id: 'transition',
          trackId: 'track',
          fromClipId: 'clip',
          toClipId: 'next',
          kind: 'crossfade',
        },
      },
      { type: 'removeTransition', transitionId: 'transition' },
    );
    expect(legacyCommandReceiptContent(input)).toBe(canonical(input));
  });

  it.each([
    null,
    {},
    batch(),
    { ...batch({ type: 'removeClip', clipId: 'clip' }), expectedRevision: -1 },
    batch({
      type: 'insertClip',
      trackId: 'track',
      clip: { ...clip, startUs: -1 },
    }),
    batch({ type: 'setSpeed', clipId: 'clip', speed: 8 }),
    batch({ type: 'futureOperation', clipId: 'clip' }),
  ])('returns undefined when the base schema rejects %j', (input) => {
    expect(legacyCommandReceiptContent(input)).toBeUndefined();
  });
});
