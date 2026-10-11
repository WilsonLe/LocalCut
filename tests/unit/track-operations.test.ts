import { describe, expect, it } from 'vitest';
import { appendAsset } from '../../src/workspace/helpers';
import { assetSchema, newProject, validateProject } from '../../src/core/model';
import { applyOperations, parseBatch } from '../../src/core/commands';
import type { EditOperation } from '../../src/core/commands';
import { outputTracks } from '../../src/core/timeline';
import { projectContext, timelineContext } from '../../src/ai/context';
import { supportedEditOperations, proposalBatch } from '../../src/ai/tools';
import { legacyCommandReceiptContent } from '../../src/core/receipt-content';
const fixture = () =>
  validateProject({
    ...newProject('tracks'),
    tracks: [
      {
        id: 'visual',
        kind: 'video',
        clips: [
          {
            id: 'a',
            kind: 'image',
            assetId: 'source',
            startUs: 0,
            durationUs: 2000000,
            groupId: 'group',
            keyframes: { x: [{ id: 'x', timeUs: 0, value: 30 }] },
          },
          {
            id: 'b',
            kind: 'image',
            assetId: 'source',
            startUs: 1000000,
            durationUs: 2000000,
            groupId: 'group',
            cues: [{ id: 'cue', timeUs: 0, endUs: 100, text: 'Caption' }],
          },
        ],
      },
      {
        id: 'sound',
        kind: 'audio',
        clips: [
          {
            id: 'audio',
            kind: 'audio',
            assetId: 'speech',
            startUs: 0,
            durationUs: 2000000,
            sourceOutUs: 2000000,
          },
        ],
      },
      { id: 'overlay', kind: 'overlay', clips: [] },
    ],
    transitions: [
      {
        id: 'transition',
        trackId: 'visual',
        fromClipId: 'a',
        toClipId: 'b',
        kind: 'crossfade',
      },
    ],
  });
describe('track operations', () => {
  it('keeps legacy defaults and partial patches, validates names and exposes every command to AI', () => {
    const p = fixture();
    expect(p.tracks[0]).toMatchObject({ muted: false });
    expect(p.tracks[0]!.disabled).toBeUndefined();
    const operations: EditOperation[] = [
      {
        type: 'updateTrack',
        trackId: 'visual',
        patch: {
          name: '  Main footage  ',
          muted: true,
          disabled: true,
          solo: true,
          locked: true,
        },
      },
    ];
    const parsed = parseBatch({
      projectId: p.id,
      requestId: 'request',
      expectedRevision: 0,
      operations,
    });
    const updated = applyOperations(p, parsed.operations).project;
    const renamed = applyOperations(updated, [
      { type: 'updateTrack', trackId: 'visual', patch: { name: 'New name' } },
    ]).project;
    expect(renamed.tracks[0]).toMatchObject({
      name: 'New name',
      muted: true,
      disabled: true,
      solo: true,
      locked: true,
      clips: p.tracks[0]!.clips,
    });
    for (const name of ['', '   ', 'x'.repeat(1001)])
      expect(() =>
        parseBatch({
          ...parsed,
          operations: [
            { type: 'updateTrack', trackId: 'visual', patch: { name } },
          ],
        }),
      ).toThrow();
    expect(supportedEditOperations).toEqual(
      expect.arrayContaining([
        'addTrack',
        'updateTrack',
        'duplicateTrack',
        'clearTrack',
        'removeTrack',
        'reorderTrack',
      ]),
    );
    expect(proposalBatch(p, operations, 'request', 100).operations).toEqual(
      parsed.operations,
    );
    expect(
      legacyCommandReceiptContent({
        ...parsed,
        operations: [{ type: 'addTrack', track: { id: 'old', kind: 'video' } }],
      }),
    ).toContain('"muted":false');
  });
  it('duplicates a track at the next layer with deterministic fresh nested IDs, internal groups and transitions', () => {
    const p = fixture();
    p.tracks[0]!.name = 'Footage';
    p.tracks[0]!.locked = true;
    const operations: EditOperation[] = [
      { type: 'duplicateTrack', trackId: 'visual', newTrackId: 'copy' },
    ];
    const a = applyOperations(p, operations).project;
    const b = applyOperations(p, operations).project;
    expect(a).toEqual(b);
    expect(a.tracks.map((t) => t.id)).toEqual([
      'visual',
      'copy',
      'sound',
      'overlay',
    ]);
    const copy = a.tracks[1]!;
    expect(copy).toMatchObject({
      id: 'copy',
      name: 'Footage copy',
      locked: false,
    });
    expect(copy.clips.map((c) => c.assetId)).toEqual(['source', 'source']);
    expect(copy.clips.map((c) => c.startUs)).toEqual([0, 1000000]);
    expect(copy.clips[0]!.groupId).toBe(copy.clips[1]!.groupId);
    expect(copy.clips[0]!.groupId).not.toBe('group');
    expect(copy.clips[0]!.keyframes.x![0]!.id).not.toBe('x');
    expect(copy.clips[1]!.cues[0]!.id).not.toBe('cue');
    expect(a.transitions[1]).toMatchObject({
      trackId: 'copy',
      fromClipId: copy.clips[0]!.id,
      toClipId: copy.clips[1]!.id,
    });
    expect(a.transitions[1]!.id).not.toBe('transition');
    expect(() =>
      applyOperations(p, [
        { type: 'duplicateTrack', trackId: 'visual', newTrackId: 'sound' },
      ]),
    ).toThrow('Duplicate ID');
    expect(p.tracks).toHaveLength(3);
  });
  it('dissolves partial cross-track groups on duplication, clearing and deletion without moving other clips', () => {
    const p = fixture();
    delete p.tracks[0]!.clips[1]!.groupId;
    p.tracks[1]!.clips[0]!.groupId = 'group';
    const copy = applyOperations(p, [
      { type: 'duplicateTrack', trackId: 'visual', newTrackId: 'copy' },
    ]).project;
    expect(copy.tracks[1]!.clips[0]!.groupId).toBeUndefined();
    for (const type of ['clearTrack', 'removeTrack'] as const) {
      const next = applyOperations(p, [{ type, trackId: 'visual' }]).project;
      expect(next.transitions).toEqual([]);
      expect(next.tracks.find((t) => t.id === 'sound')!.clips[0]).toMatchObject(
        { id: 'audio', assetId: 'speech', startUs: 0 },
      );
      expect(
        next.tracks.find((t) => t.id === 'sound')!.clips[0]!.groupId,
      ).toBeUndefined();
      expect(next.tracks.find((t) => t.id === 'visual')?.clips ?? []).toEqual(
        [],
      );
      expect(p.tracks[0]!.clips).toHaveLength(2);
    }
  });
  it('appends imported media to an unlocked compatible track or creates one without touching locks', () => {
    const p = fixture();
    p.tracks[0]!.locked = true;
    const asset = assetSchema.parse({
      id: 'image',
      name: 'Image',
      kind: 'image',
      size: 100,
      type: 'image/png',
      durationUs: 0,
      width: 128,
      height: 72,
      rotation: 0,
      status: 'ready',
    });
    const next = applyOperations(p, appendAsset(p, asset)).project;
    expect(next.tracks[0]).toEqual(p.tracks[0]);
    expect(next.tracks).toHaveLength(4);
    expect(next.tracks[3]!.clips[0]!.assetId).toBe('image');
    p.tracks.push({ id: 'unlocked', kind: 'video', clips: [], muted: false });
    const reused = applyOperations(p, appendAsset(p, asset)).project;
    expect(reused.tracks).toHaveLength(4);
    expect(reused.tracks[3]!.clips[0]!.assetId).toBe('image');
  });
  const forbidden: EditOperation[] = [
    { type: 'clearTrack', trackId: 'visual' },
    { type: 'removeTrack', trackId: 'visual' },
    { type: 'reorderTrack', trackId: 'visual', index: 1 },
    {
      type: 'insertClip',
      trackId: 'visual',
      clip: {
        id: 'new',
        kind: 'image',
        assetId: 'source',
        startUs: 0,
        durationUs: 100,
      },
    },
    { type: 'removeClip', clipId: 'a' },
    { type: 'updateClip', clipId: 'a', patch: { x: 100 } },
    { type: 'splitClip', clipId: 'a', atUs: 100, rightClipId: 'right' },
    { type: 'trimClip', clipId: 'a', sourceInUs: 0, sourceOutUs: 100 },
    { type: 'moveClip', clipId: 'a', trackId: 'visual', startUs: 100 },
    {
      type: 'duplicateClip',
      clipId: 'a',
      newClipId: 'dup',
      trackId: 'visual',
      startUs: 100,
    },
    { type: 'ripple', trackId: 'visual', fromUs: 0, deltaUs: 100 },
    { type: 'setSpeed', clipId: 'a', speed: 2 },
    { type: 'setSpeedRamp', clipId: 'a', points: null },
    { type: 'groupClips', groupId: 'newgroup', clipIds: ['a', 'b'] },
    { type: 'moveGroup', groupId: 'group', deltaUs: 100 },
    { type: 'ungroupClips', groupId: 'group' },
    {
      type: 'duplicateGroup',
      groupId: 'group',
      newGroupId: 'newgroup',
      newClipIds: { a: 'dup-a', b: 'dup-b' },
      deltaUs: 3000000,
    },
    {
      type: 'addTransition',
      transition: {
        id: 'newtransition',
        trackId: 'visual',
        fromClipId: 'a',
        toClipId: 'b',
        kind: 'black',
      },
    },
    { type: 'removeTransition', transitionId: 'transition' },
    {
      type: 'applyTransitionTemplate',
      trackId: 'visual',
      transitionId: 'transition',
      fromClipId: 'a',
      toClipId: 'b',
      template: 'slide-left',
    },
    {
      type: 'separateAudio',
      clipId: 'a',
      audioClipId: 'sep',
      trackId: 'sound',
    },
  ];
  it.each(forbidden)('rejects $type on locked tracks atomically', (op) => {
    const p = fixture();
    p.tracks[0]!.locked = true;
    const original = structuredClone(p);
    expect(() =>
      applyOperations(p, [
        { type: 'updateTrack', trackId: 'sound', patch: { muted: true } },
        op,
      ]),
    ).toThrow('locked');
    expect(p).toEqual(original);
  });
  it('rejects destination locks, cross-track group changes, and implicit singleton changes; permits explicit unlock first', () => {
    const p = fixture();
    p.tracks[0]!.locked = true;
    expect(() =>
      applyOperations(p, [
        { type: 'moveClip', clipId: 'audio', trackId: 'visual', startUs: 0 },
      ]),
    ).toThrow('locked');
    delete p.tracks[0]!.clips[1]!.groupId;
    p.tracks[1]!.clips[0]!.groupId = 'group';
    expect(() =>
      applyOperations(p, [
        { type: 'moveGroup', groupId: 'group', deltaUs: 10 },
      ]),
    ).toThrow('locked');
    expect(() =>
      applyOperations(p, [{ type: 'clearTrack', trackId: 'sound' }]),
    ).toThrow('locked');
    const next = applyOperations(p, [
      { type: 'updateTrack', trackId: 'visual', patch: { locked: false } },
      { type: 'clearTrack', trackId: 'visual' },
    ]).project;
    expect(next.tracks[0]!.clips).toEqual([]);
  });
  it('shares independent visual/audio solo, disabled and mute rules with redacted AI inspection', () => {
    const p = fixture();
    p.tracks[0]!.name = 'Private track';
    expect(JSON.stringify(projectContext(p))).not.toContain('Private track');
    expect(projectContext(p, { includeAssetNames: true }).tracks[0]!.name).toBe(
      'Private track',
    );
    p.tracks[1]!.solo = true;
    expect(outputTracks(p, 'visual').map((t) => t.id)).toEqual([
      'visual',
      'overlay',
    ]);
    expect(outputTracks(p, 'audio').map((t) => t.id)).toEqual(['sound']);
    p.tracks[0]!.solo = true;
    p.tracks[0]!.muted = true;
    expect(outputTracks(p, 'visual').map((t) => t.id)).toEqual(['visual']);
    expect(outputTracks(p, 'audio').map((t) => t.id)).toEqual(['sound']);
    p.tracks[0]!.disabled = true;
    expect(outputTracks(p, 'visual').map((t) => t.id)).toEqual(['overlay']);
    const context = timelineContext(p, 1500000);
    expect(context.tracks[0]).toMatchObject({
      disabled: true,
      visible: false,
      audible: false,
      clips: [
        { id: 'a', audibleGain: 0 },
        { id: 'b', audibleGain: 0 },
      ],
    });
    expect(context.transitions).toEqual([]);
    expect(context.tracks[0]!.name).toBeUndefined();
    p.tracks[1]!.disabled = true;
    expect(outputTracks(p, 'audio')).toEqual([]);
  });
});
