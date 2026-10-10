import { describe, expect, it } from 'vitest';
import { clipSchema, newProject, validateProject } from '../../src/core/model';
import { applyOperations, parseBatch } from '../../src/core/commands';
import {
  selectionIds,
  transitionPairs,
  TRANSITION_TEMPLATES,
} from '../../src/core/timeline';
import { valueAt, gainAt } from '../../src/core/timing';
import { legacyCommandReceiptContent } from '../../src/core/receipt-content';
import { proposalBatch, toolDefinitions } from '../../src/ai/tools';

const project = () =>
  validateProject({
    ...newProject('timeline'),
    tracks: [
      {
        id: 'visual',
        kind: 'video',
        clips: [
          {
            id: 'a',
            kind: 'video',
            assetId: 'source',
            startUs: 1000000,
            durationUs: 2000000,
            sourceInUs: 500000,
            sourceOutUs: 3500000,
            speed: 1.5,
            gain: 0.7,
            fadeInUs: 100000,
            fadeOutUs: 200000,
            keyframes: {
              gain: [
                { id: 'gain-a', timeUs: 0, value: 0.2 },
                { id: 'gain-b', timeUs: 2000000, value: 0.8 },
              ],
              x: [
                { id: 'x-a', timeUs: 0, value: 10 },
                { id: 'x-b', timeUs: 2000000, value: 30 },
              ],
            },
          },
          {
            id: 'b',
            kind: 'image',
            assetId: 'image',
            startUs: 2000000,
            durationUs: 3000000,
            width: 640,
            height: 360,
          },
        ],
      },
      { id: 'sound', kind: 'audio', clips: [] },
    ],
  });
const grouped = () =>
  applyOperations(project(), [
    { type: 'groupClips', groupId: 'g', clipIds: ['a', 'b'] },
  ]).project;

describe('audio separation and groups', () => {
  it('separates the same trimmed sped-up source with its exact audible envelope and distinct key IDs', () => {
    const p = project();
    const next = applyOperations(p, [
      {
        type: 'separateAudio',
        clipId: 'a',
        trackId: 'sound',
        audioClipId: 'sound-a',
      },
    ]).project;
    const video = next.tracks[0]!.clips[0]!,
      audio = next.tracks[1]!.clips[0]!;
    expect(video.muted).toBe(true);
    expect(audio).toMatchObject({
      kind: 'audio',
      assetId: 'source',
      sourceInUs: 500000,
      sourceOutUs: 3500000,
      speed: 1.5,
      startUs: 1000000,
      durationUs: 2000000,
      gain: 0.7,
    });
    for (const time of [1000001, 1500000, 2800000])
      expect(gainAt(audio, time)).toBeCloseTo(
        gainAt(p.tracks[0]!.clips[0]!, time),
        12,
      );
    expect(audio.keyframes.x).toBeUndefined();
    expect(audio.keyframes.gain![0]!.id).not.toBe('gain-a');
    expect(p.tracks[0]!.clips[0]!.muted).toBe(false);
    p.tracks[0]!.muted = true;
    expect(
      applyOperations(p, [
        {
          type: 'separateAudio',
          clipId: 'a',
          trackId: 'sound',
          audioClipId: 'audio',
        },
      ]).project.tracks[1]!.clips[0]!.muted,
    ).toBe(true);
    expect(() =>
      applyOperations(p, [
        {
          type: 'separateAudio',
          clipId: 'b',
          trackId: 'sound',
          audioClipId: 'audio',
        },
      ]),
    ).toThrow('video clip');
  });
  it('selects groups together and preserves offsets for moves, copies and ungroup', () => {
    const p = grouped();
    expect(selectionIds(p, ['b'])).toEqual(['a', 'b']);
    const moved = applyOperations(p, [
      { type: 'moveGroup', groupId: 'g', deltaUs: 3000000 },
    ]).project;
    expect(moved.tracks[0]!.clips.map((c) => c.startUs)).toEqual([
      4000000, 5000000,
    ]);
    const copy = applyOperations(moved, [
      {
        type: 'duplicateGroup',
        groupId: 'g',
        newGroupId: 'g2',
        newClipIds: { a: 'a2', b: 'b2' },
        deltaUs: 6000000,
      },
    ]).project;
    expect(
      copy.tracks[0]!.clips.slice(2).map((c) => [c.id, c.groupId, c.startUs]),
    ).toEqual([
      ['a2', 'g2', 10000000],
      ['b2', 'g2', 11000000],
    ]);
    const ungrouped = applyOperations(copy, [
      { type: 'ungroupClips', groupId: 'g2' },
    ]).project;
    expect(selectionIds(ungrouped, ['b2'])).toEqual(['b2']);
    expect(ungrouped.tracks[0]!.clips[2]!.keyframes.gain![0]!.id).not.toBe(
      'gain-a',
    );
    expect(() =>
      applyOperations(p, [
        { type: 'moveGroup', groupId: 'g', deltaUs: -2000000 },
      ]),
    ).toThrow();
    expect(p.tracks[0]!.clips[0]!.startUs).toBe(1000000);
  });
  it('rejects partial regrouping, malformed identities and partial copies; dissolves orphan membership', () => {
    const p = grouped();
    expect(() =>
      applyOperations(p, [
        { type: 'groupClips', groupId: 'other', clipIds: ['a', 'a'] },
      ]),
    ).toThrow();
    expect(() =>
      applyOperations(p, [
        {
          type: 'duplicateGroup',
          groupId: 'g',
          newGroupId: 'g2',
          newClipIds: { a: 'a2' },
          deltaUs: 6000000,
        },
      ]),
    ).toThrow();
    expect(() =>
      validateProject({
        ...p,
        tracks: [{ ...p.tracks[0], clips: [p.tracks[0]!.clips[0]] }],
      }),
    ).toThrow('at least two');
    const extra = clipSchema.parse({
      id: 'c',
      kind: 'image',
      assetId: 'image',
      startUs: 6000000,
      durationUs: 1000000,
    });
    p.tracks[0]!.clips.push(extra);
    expect(() =>
      applyOperations(p, [
        { type: 'groupClips', groupId: 'g2', clipIds: ['a', 'c'] },
      ]),
    ).toThrow('every member');
    expect(() =>
      applyOperations(p, [
        { type: 'groupClips', groupId: 'visual', clipIds: ['a', 'b'] },
      ]),
    ).toThrow('Duplicate ID');
    const deleted = applyOperations(p, [
      { type: 'removeClip', clipId: 'a' },
    ]).project;
    expect(deleted.tracks[0]!.clips[0]!.groupId).toBeUndefined();
    const split = applyOperations(grouped(), [
      { type: 'splitClip', clipId: 'a', rightClipId: 'right', atUs: 2000000 },
    ]).project;
    expect(selectionIds(split, ['right'])).toEqual(['a', 'right', 'b']);
  });
});

describe('editable transition templates', () => {
  it.each(TRANSITION_TEMPLATES)(
    '$id expands to a valid ordinary blend and editable attributes',
    ({ id }) => {
      const p = project();
      const next = applyOperations(p, [
        {
          type: 'applyTransitionTemplate',
          transitionId: 't',
          trackId: 'visual',
          fromClipId: 'a',
          toClipId: 'b',
          template: id,
          strength: 0.8,
        },
      ]).project;
      expect(next.transitions[0]).toMatchObject({
        templateId: id,
        strength: 0.8,
        kind: id === 'black' ? 'black' : 'crossfade',
      });
      expect(
        next.tracks
          .flatMap((t) => t.clips)
          .map((c) => [c.startUs, c.sourceInUs, c.sourceOutUs]),
      ).toEqual(
        p.tracks
          .flatMap((t) => t.clips)
          .map((c) => [c.startUs, c.sourceInUs, c.sourceOutUs]),
      );
      const a = next.tracks[0]!.clips[0]!,
        b = next.tracks[0]!.clips[1]!;
      expect(valueAt(a, 'x', 1500000)).toBeCloseTo(
        valueAt(p.tracks[0]!.clips[0]!, 'x', 1500000),
        8,
      );
      if (id.startsWith('slide')) {
        expect(valueAt(b, 'x', 2000000)).toBeCloseTo(
          (id === 'slide-left' ? 1 : -1) * 1920 * 0.8,
        );
        expect(valueAt(b, 'x', 3000000)).toBe(0);
      }
      if (id.startsWith('zoom')) {
        expect(valueAt(b, 'width', 2000000)).toBeCloseTo(
          640 * (id === 'zoom-in' ? 1.2 : 0.8),
        );
        expect(valueAt(b, 'width', 3000000)).toBe(640);
      }
      if (id === 'blur-dissolve') {
        expect(valueAt(a, 'blur', 3000000)).toBeCloseTo(32);
        expect(valueAt(b, 'blur', 3000000)).toBe(0);
      }
      const tuned = applyOperations(next, [
        { type: 'updateClip', clipId: 'b', patch: { opacity: 0.6 } },
      ]).project;
      expect(tuned.tracks[0]!.clips[1]!.opacity).toBe(0.6);
    },
  );
  it('expands recipes inside the outer atomic batch before singleton cleanup and final validation', () => {
    const p = grouped();
    p.tracks[0]!.clips.push(
      clipSchema.parse({
        id: 'c',
        kind: 'image',
        assetId: 'image',
        startUs: 6000000,
        durationUs: 2000000,
      }),
      clipSchema.parse({
        id: 'd',
        kind: 'image',
        assetId: 'image',
        startUs: 7000000,
        durationUs: 2000000,
      }),
    );
    const operations = [
      { type: 'removeClip' as const, clipId: 'a' },
      {
        type: 'applyTransitionTemplate' as const,
        transitionId: 't',
        trackId: 'visual',
        fromClipId: 'c',
        toClipId: 'd',
        template: 'crossfade' as const,
      },
    ];
    const next = applyOperations(p, operations).project;
    expect(next.tracks[0]!.clips[0]!.groupId).toBeUndefined();
    expect(next.transitions[0]).toMatchObject({
      fromClipId: 'c',
      toClipId: 'd',
    });
    expect(p.tracks[0]!.clips).toHaveLength(4);
    expect(p.transitions).toHaveLength(0);
    // A later operation may restore a temporarily invalid source/duration pair.
    const repaired = applyOperations(project(), [
      { type: 'updateClip', clipId: 'a', patch: { sourceOutUs: 6500000 } },
      {
        type: 'applyTransitionTemplate',
        transitionId: 't',
        trackId: 'visual',
        fromClipId: 'a',
        toClipId: 'b',
        template: 'crossfade',
      },
      { type: 'updateClip', clipId: 'a', patch: { sourceOutUs: 3500000 } },
    ]).project;
    expect(repaired.transitions).toHaveLength(1);
    expect(() =>
      applyOperations(p, [
        ...operations,
        { type: 'removeClip', clipId: 'missing' },
      ]),
    ).toThrow('missing');
    expect(p.tracks[0]!.clips).toHaveLength(4);
  });
  it('retains a hold animation after the incoming overlap', () => {
    const p = project();
    p.tracks[0]!.clips[1]!.keyframes.x = [
      { id: 'hold', timeUs: 0, value: 20, interpolation: 'hold' },
      { id: 'later', timeUs: 2000000, value: 90, interpolation: 'linear' },
    ];
    const next = applyOperations(p, [
      {
        type: 'applyTransitionTemplate',
        transitionId: 't',
        trackId: 'visual',
        fromClipId: 'a',
        toClipId: 'b',
        template: 'slide-right',
      },
    ]).project;
    expect(valueAt(next.tracks[0]!.clips[1]!, 'x', 3500000)).toBe(20);
    expect(valueAt(next.tracks[0]!.clips[1]!, 'x', 4000000)).toBe(90);
  });
  it('rejects non-overlaps and triple overlaps, preserves grouped transitions when copied', () => {
    const p = grouped();
    expect(transitionPairs(p)).toHaveLength(1);
    const next = applyOperations(p, [
      {
        type: 'applyTransitionTemplate',
        transitionId: 't',
        trackId: 'visual',
        fromClipId: 'a',
        toClipId: 'b',
        template: 'slide-left',
      },
    ]).project;
    const copy = applyOperations(next, [
      {
        type: 'duplicateGroup',
        groupId: 'g',
        newGroupId: 'g2',
        newClipIds: { a: 'a2', b: 'b2' },
        deltaUs: 5000000,
      },
    ]).project;
    expect(copy.transitions).toHaveLength(2);
    expect(copy.transitions[1]).toMatchObject({
      fromClipId: 'a2',
      toClipId: 'b2',
      templateId: 'slide-left',
    });
    p.tracks[0]!.clips.push(
      clipSchema.parse({
        id: 'third',
        kind: 'image',
        assetId: 'image',
        startUs: 2500000,
        durationUs: 1000000,
      }),
    );
    expect(transitionPairs(p)).toHaveLength(0);
    expect(() =>
      applyOperations(p, [
        {
          type: 'applyTransitionTemplate',
          transitionId: 't',
          trackId: 'visual',
          fromClipId: 'a',
          toClipId: 'b',
          template: 'blur-dissolve',
        },
      ]),
    ).toThrow('overlap');
  });
  it('exposes templates to assistant proposals without legacy receipt fallback', () => {
    const p = project(),
      operations = [
        {
          type: 'applyTransitionTemplate' as const,
          transitionId: 't',
          trackId: 'visual',
          fromClipId: 'a',
          toClipId: 'b',
          template: 'zoom-in' as const,
          strength: 0.3,
        },
      ];
    const batch = proposalBatch(p, operations, 'request', 10);
    expect(parseBatch(batch).operations[0]).toEqual(operations[0]);
    expect(legacyCommandReceiptContent(batch)).toBeUndefined();
    expect(JSON.stringify(toolDefinitions(false))).toContain('blur-dissolve');
    expect(() =>
      parseBatch({ ...batch, operations: [{ ...operations[0], strength: 2 }] }),
    ).toThrow();
  });
});
