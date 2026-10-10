import { describe, expect, it } from 'vitest';
import { newProject, validateProject } from '../../src/core/model';
import { applyOperations } from '../../src/core/commands';
import {
  copySelection,
  pasteSelection,
  nudgeSelection,
  trimAtPlayhead,
  rippleDeleteSelection,
  editBoundary,
} from '../../src/workspace/editing-actions';
import { anchoredOffset, wheelPixels } from '../../src/workspace/useViewport';

const project = () =>
  validateProject({
    ...newProject('Input'),
    tracks: [
      {
        id: 'v',
        kind: 'video',
        clips: [
          {
            id: 'a',
            kind: 'image',
            assetId: 'image',
            startUs: 0,
            durationUs: 1_000_000,
            keyframes: {
              opacity: [
                { timeUs: 0, value: 0.3 },
                { timeUs: 1_000_000, value: 1 },
              ],
            },
          },
          {
            id: 'b',
            kind: 'image',
            assetId: 'image',
            startUs: 1_000_000,
            durationUs: 1_000_000,
          },
        ],
      },
    ],
  });
describe('editing combinations use atomic engine commands', () => {
  it('copies a frozen selection with fresh nested and group identities at the playhead', () => {
    const p = applyOperations(project(), [
      { type: 'groupClips', groupId: 'g', clipIds: ['a', 'b'] },
    ]).project;
    const clipboard = copySelection(p, ['a', 'b']);
    const pasted = pasteSelection(p, clipboard, 3_000_000);
    const next = applyOperations(p, pasted.operations).project;
    const copies = next.tracks[0]!.clips.slice(2);
    expect(copies.map((c) => c.startUs)).toEqual([3_000_000, 4_000_000]);
    expect(copies[0]!.groupId).toBe(copies[1]!.groupId);
    expect(copies[0]!.groupId).not.toBe('g');
    expect(copies[0]!.keyframes.opacity![0]!.id).not.toBe(
      p.tracks[0]!.clips[0]!.keyframes.opacity![0]!.id,
    );
    expect(
      pasteSelection(newProject('Other'), clipboard, 0).operations,
    ).toEqual([]);
    p.tracks[0]!.clips[0]!.durationUs = 42;
    expect(clipboard.clips[0]!.clip.durationUs).toBe(1_000_000);
  });
  it('pastes cut clips after their originals have been deleted and rejects deleted tracks', () => {
    const p = project(),
      clipboard = copySelection(p, ['a']);
    const removed = applyOperations(p, [
      { type: 'removeClip', clipId: 'a' },
    ]).project;
    expect(
      applyOperations(removed, pasteSelection(removed, clipboard, 0).operations)
        .project.tracks[0]!.clips,
    ).toHaveLength(2);
    expect(() => pasteSelection({ ...p, tracks: [] }, clipboard, 0)).toThrow(
      'track',
    );
  });
  it('moves each group once and clamps its earliest clip at zero', () => {
    const p = applyOperations(project(), [
      { type: 'groupClips', groupId: 'g', clipIds: ['a', 'b'] },
    ]).project;
    expect(nudgeSelection(p, ['a', 'b'], -10)).toEqual([]);
    const next = applyOperations(p, nudgeSelection(p, ['a', 'b'], 1)).project;
    expect(next.tracks[0]!.clips.map((c) => c.startUs)).toEqual([
      33333, 1033333,
    ]);
  });
  it('nudges a single clip without changing compositor order or its animation', () => {
    const p = project();
    const next = applyOperations(p, nudgeSelection(p, ['a'], 1)).project;
    expect(next.tracks[0]!.clips.map((c) => c.id)).toEqual(['a', 'b']);
    expect(next.tracks[0]!.clips[0]!).toEqual({
      ...p.tracks[0]!.clips[0]!,
      startUs: 33333,
    });
    expect(next.tracks[0]!.clips[1]!).toEqual(p.tracks[0]!.clips[1]!);
  });
  it('trims via engine splitting, preserving interpolated animation and rejects endpoint/group trims', () => {
    const p = project(),
      clip = p.tracks[0]!.clips[0]!;
    const next = applyOperations(
      p,
      trimAtPlayhead(clip, 500_000, 'start'),
    ).project;
    const trimmed = next.tracks[0]!.clips.find((c) => c.startUs === 500_000)!;
    expect(trimmed.durationUs).toBe(500_000);
    expect(trimmed.keyframes.opacity![0]!.value).toBeCloseTo(0.65);
    expect(trimAtPlayhead(clip, 0, 'start')).toEqual([]);
    expect(trimAtPlayhead({ ...clip, groupId: 'g' }, 500_000, 'end')).toEqual(
      [],
    );
    const end = applyOperations(
      p,
      trimAtPlayhead(clip, 500_000, 'end'),
    ).project;
    expect(end.tracks[0]!.clips.find((c) => c.id === 'a')!.durationUs).toBe(
      500_000,
    );
  });
  it('ripple closes a safe gap and blocks overlapping retained clips and straddling groups', () => {
    const p = project();
    const next = applyOperations(p, rippleDeleteSelection(p, ['a'])).project;
    expect(next.tracks[0]!.clips[0]!.startUs).toBe(0);
    const overlap = structuredClone(p);
    overlap.tracks[0]!.clips[1]!.startUs = 500_000;
    expect(rippleDeleteSelection(overlap, ['a'])).toEqual([]);
    const spanning = validateProject({
      ...p,
      tracks: [
        {
          ...p.tracks[0],
          clips: [
            { ...p.tracks[0]!.clips[0], startUs: 2_000_000 },
            { ...p.tracks[0]!.clips[1], groupId: 'g', startUs: 0 },
            {
              ...p.tracks[0]!.clips[1],
              id: 'c',
              groupId: 'g',
              startUs: 4_000_000,
            },
          ],
        },
      ],
    });
    expect(rippleDeleteSelection(spanning, ['a'])).toEqual([]);
  });
  it('copies transitions between selected endpoints, with fresh references', () => {
    const p = project();
    p.tracks[0]!.clips[1]!.startUs = 500_000;
    p.transitions.push({
      id: 'blend',
      trackId: 'v',
      fromClipId: 'a',
      toClipId: 'b',
      kind: 'crossfade',
    });
    const saved = copySelection(p, ['a', 'b']);
    const paste = pasteSelection(p, saved, 3_000_000);
    const next = applyOperations(p, paste.operations).project;
    const transition = next.transitions[1]!;
    expect(transition.id).not.toBe('blend');
    expect(transition.fromClipId).toBe(paste.ids[0]);
    expect(transition.toClipId).toBe(paste.ids[1]);
    expect(copySelection(p, ['a']).transitions).toEqual([]);
  });
  it('trims timed media with exact source endpoints at non-unit speed', () => {
    const p = validateProject({
      ...project(),
      tracks: [
        {
          id: 'v',
          kind: 'video',
          clips: [
            {
              id: 'a',
              kind: 'video',
              assetId: 'video',
              startUs: 0,
              durationUs: 1_000_000,
              sourceInUs: 123,
              sourceOutUs: 2_000_123,
              speed: 2,
            },
          ],
        },
      ],
    });
    const next = applyOperations(
      p,
      trimAtPlayhead(p.tracks[0]!.clips[0]!, 500_000, 'start'),
    ).project;
    expect(next.tracks[0]!.clips[0]!.sourceInUs).toBe(1_000_123);
    expect(next.tracks[0]!.clips[0]!.sourceOutUs).toBe(2_000_123);
  });
  it('navigates distinct edit boundaries across tracks', () => {
    expect(editBoundary(project(), 0, 1)).toBe(1_000_000);
    expect(editBoundary(project(), 1_000_000, -1)).toBe(0);
    expect(editBoundary(project(), 2_000_000, 1)).toBe(2_000_000);
  });
});
describe('cursor zoom geometry', () => {
  it('preserves the pointed content coordinate through zoom and scroll', () => {
    const before = -120,
      anchor = 230,
      old = 2,
      next = 3;
    const offset = anchoredOffset(before, anchor, old, next);
    expect((anchor - offset) / next).toBe((anchor - before) / old);
    expect(anchoredOffset(0, 0, 1, 8)).toBe(0);
    expect(wheelPixels({ deltaY: 2, deltaMode: 1 }, 100)).toBe(32);
    expect(wheelPixels({ deltaY: -1, deltaMode: 2 }, 100)).toBe(-100);
  });
});
