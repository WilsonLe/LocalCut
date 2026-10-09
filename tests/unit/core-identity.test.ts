import { describe, expect, it } from 'vitest';
import {
  applyOperations,
  canonical,
  parseBatch,
} from '../../src/core/commands';
import {
  clipSchema,
  newProject,
  validateBackup,
  validateProject,
} from '../../src/core/model';
import type { Clip, ClipInput } from '../../src/core/model';

function animatedClip(): Clip {
  return clipSchema.parse({
    id: 'source-clip',
    kind: 'video',
    assetId: 'source',
    startUs: 0,
    durationUs: 4000000,
    sourceOutUs: 4000000,
    keyframes: {
      opacity: [
        { timeUs: 0, value: 0 },
        { timeUs: 1000000, value: 0.5 },
        { timeUs: 4000000, value: 1 },
      ],
    },
    cues: [
      { id: 'left-cue', timeUs: 100000, endUs: 200000, text: 'Left' },
      { id: 'crossing-cue', timeUs: 500000, endUs: 1500000, text: 'Both' },
      { id: 'right-cue', timeUs: 2000000, endUs: 3000000, text: 'Right' },
    ],
  });
}

function projectWith(clip: Clip = animatedClip()) {
  return validateProject({
    ...newProject('Identity'),
    tracks: [{ id: 'track', kind: 'video', clips: [clip] }],
  });
}

describe('persisted nested identities', () => {
  it('normalizes legacy keyframes deterministically across parsing, reads and serialization', () => {
    const original = projectWith();
    const legacy = JSON.parse(JSON.stringify(original));
    for (const key of legacy.tracks[0].clips[0].keyframes.opacity)
      delete key.id;
    const first = validateProject(legacy);
    const second = validateProject(legacy);
    const reread = validateProject(JSON.parse(JSON.stringify(first)));
    expect(first).toEqual(second);
    expect(reread).toEqual(first);
    const ids = first.tracks[0]!.clips[0]!.keyframes.opacity!.map(
      (key) => key.id,
    );
    expect(ids.every((id) => id.startsWith('keyframe-'))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps omitted input IDs stable for repeated command parsing and validation', () => {
    const input: ClipInput = {
      id: 'clip',
      kind: 'text',
      startUs: 0,
      durationUs: 1000000,
      text: { text: 'Hello' },
      keyframes: {
        opacity: [
          { timeUs: 0, value: 0 },
          { timeUs: 1000000, value: 1 },
        ],
      },
    };
    const batch = {
      projectId: 'project',
      requestId: 'request',
      expectedRevision: 0,
      operations: [
        { type: 'addTrack', track: { id: 'track', kind: 'overlay' } },
        { type: 'insertClip', trackId: 'track', clip: input },
      ],
    };
    expect(canonical(parseBatch(batch))).toBe(canonical(parseBatch(batch)));
    const base = { ...newProject('Retry'), id: 'project' };
    expect(applyOperations(base, parseBatch(batch).operations)).toEqual(
      applyOperations(base, parseBatch(batch).operations),
    );
    const result = applyOperations(base, parseBatch(batch).operations).project;
    const update = parseBatch({
      ...batch,
      operations: [
        {
          type: 'updateClip',
          clipId: 'clip',
          patch: { keyframes: input.keyframes },
        },
      ],
    });
    expect(applyOperations(result, update.operations).project).toEqual(result);
  });

  it('rejects duplicate cue and keyframe IDs throughout a project', () => {
    const cueDuplicate = projectWith();
    cueDuplicate.tracks[0]!.clips[0]!.cues[1]!.id = 'left-cue';
    expect(() => validateProject(cueDuplicate)).toThrow('Duplicate ID');
    const keyDuplicate = projectWith();
    const keys = keyDuplicate.tracks[0]!.clips[0]!.keyframes.opacity!;
    keys[1]!.id = keys[0]!.id;
    expect(() => validateProject(keyDuplicate)).toThrow('Duplicate ID');
    const collision = projectWith();
    collision.tracks[0]!.clips[0]!.keyframes.opacity![0]!.id = 'left-cue';
    expect(() => validateProject(collision)).toThrow('Duplicate ID');
  });

  it('rejects duplicate source transcript cue IDs in a backup', () => {
    const project = newProject('Transcript backup');
    expect(() =>
      validateBackup({
        backupVersion: 1,
        project,
        assets: [
          {
            id: 'audio',
            name: 'audio.wav',
            kind: 'audio',
            size: 1,
            type: 'audio/wav',
            durationUs: 1000000,
            width: 0,
            height: 0,
            rotation: 0,
            status: 'missing',
            audioCodec: 'pcm-s16',
          },
        ],
        transcripts: [
          {
            id: 'transcript',
            assetId: 'audio',
            model: 'model',
            revision: 'revision',
            cues: [
              { id: 'same', timeUs: 0, endUs: 400000, text: 'One' },
              { id: 'same', timeUs: 500000, endUs: 1000000, text: 'Two' },
            ],
          },
        ],
      }),
    ).toThrow('Duplicate transcript cue ID');
  });

  it('preserves moved split entities and gives only new boundary fragments new IDs', () => {
    const project = projectWith();
    const original = project.tracks[0]!.clips[0]!;
    const operation = {
      type: 'splitClip' as const,
      clipId: original.id,
      atUs: 1000000,
      rightClipId: 'right',
    };
    const first = applyOperations(project, [operation]).project;
    expect(applyOperations(project, [operation]).project).toEqual(first);
    const [left, right] = first.tracks[0]!.clips;
    expect(left!.keyframes.opacity![1]!.id).toBe(
      original.keyframes.opacity![1]!.id,
    );
    expect(right!.keyframes.opacity![0]!.id).not.toBe(
      original.keyframes.opacity![1]!.id,
    );
    expect(right!.keyframes.opacity![1]!.id).toBe(
      original.keyframes.opacity![2]!.id,
    );
    expect(left!.cues.map((cue) => cue.id)).toEqual([
      'left-cue',
      'crossing-cue',
    ]);
    expect(right!.cues[0]!.id).not.toBe('crossing-cue');
    expect(right!.cues[1]!.id).toBe('right-cue');
    expect(right!.cues[0]!).toMatchObject({
      timeUs: 0,
      endUs: 500000,
      text: 'Both',
    });
    expect(validateProject(first)).toEqual(first);
  });

  it('normalizes legacy identities before splitting raw persisted state', () => {
    const legacy = JSON.parse(JSON.stringify(projectWith()));
    for (const key of legacy.tracks[0].clips[0].keyframes.opacity)
      delete key.id;
    const snapshot = validateProject(legacy);
    const keys = snapshot.tracks[0]!.clips[0]!.keyframes.opacity!;
    const result = applyOperations(legacy, [
      {
        type: 'splitClip',
        clipId: 'source-clip',
        atUs: 1000000,
        rightClipId: 'right',
      },
    ]).project;
    const [left, right] = result.tracks[0]!.clips;
    expect(left!.keyframes.opacity![0]!.id).toBe(keys[0]!.id);
    expect(left!.keyframes.opacity![1]!.id).toBe(keys[1]!.id);
    expect(right!.keyframes.opacity![1]!.id).toBe(keys[2]!.id);
    expect(
      legacy.tracks[0].clips[0].keyframes.opacity.every(
        (key: { id?: string }) => key.id === undefined,
      ),
    ).toBe(true);
  });

  it('remaps all duplicated nested IDs without changing their values', () => {
    const project = projectWith();
    const operation = {
      type: 'duplicateClip' as const,
      clipId: 'source-clip',
      newClipId: 'copy',
      trackId: 'track',
      startUs: 4000000,
    };
    const result = applyOperations(project, [operation]).project;
    expect(applyOperations(project, [operation]).project).toEqual(result);
    const [source, copy] = result.tracks[0]!.clips;
    expect(source).toEqual(project.tracks[0]!.clips[0]);
    expect(
      copy!.cues.map(({ timeUs, endUs, text }) => ({ timeUs, endUs, text })),
    ).toEqual(
      source!.cues.map(({ timeUs, endUs, text }) => ({ timeUs, endUs, text })),
    );
    expect(
      copy!.keyframes.opacity!.map(({ timeUs, value, interpolation }) => ({
        timeUs,
        value,
        interpolation,
      })),
    ).toEqual(
      source!.keyframes.opacity!.map(({ timeUs, value, interpolation }) => ({
        timeUs,
        value,
        interpolation,
      })),
    );
    expect(
      copy!.cues.every(
        (cue) => !source!.cues.some((other) => cue.id === other.id),
      ),
    ).toBe(true);
    expect(validateProject(result)).toEqual(result);
  });

  it('retains identities through valid trim, speed, and placement edits', () => {
    const clip = animatedClip();
    clip.keyframes.opacity = clip.keyframes.opacity!.slice(0, 2);
    clip.cues = clip.cues.slice(0, 1);
    const project = projectWith(clip);
    const result = applyOperations(project, [
      {
        type: 'trimClip',
        clipId: clip.id,
        sourceInUs: 0,
        sourceOutUs: 3000000,
      },
      { type: 'setSpeed', clipId: clip.id, speed: 2 },
      { type: 'moveClip', clipId: clip.id, trackId: 'track', startUs: 1000000 },
    ]).project.tracks[0]!.clips[0]!;
    expect(result.keyframes).toEqual(clip.keyframes);
    expect(result.cues).toEqual(clip.cues);
    expect(result.durationUs).toBe(1500000);
  });

  it.each([{ rotation: 90 }, { contrast: 1.7 }])(
    'updates only supplied patch fields: %j',
    (patch) => {
      const original = clipSchema.parse({
        ...animatedClip(),
        x: 12,
        y: 15,
        width: 400,
        height: 300,
        opacity: 0.7,
        gain: 0.4,
        brightness: 1.2,
        contrast: 1.4,
        saturation: 0.6,
        grayscale: 0.2,
        blur: 3,
        fadeInUs: 100000,
        fadeOutUs: 200000,
        crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
      });
      const project = projectWith(original);
      const batch = parseBatch({
        projectId: project.id,
        requestId: 'partial-update',
        expectedRevision: 0,
        operations: [{ type: 'updateClip', clipId: original.id, patch }],
      });
      const operation = batch.operations[0]!;
      expect(operation.type).toBe('updateClip');
      if (operation.type !== 'updateClip') throw new Error('Expected update');
      expect(operation.patch).toEqual(patch);
      const updated = applyOperations(project, batch.operations).project
        .tracks[0]!.clips[0]!;
      expect(updated).toEqual({ ...original, ...patch });
      expect(updated.keyframes).toEqual(original.keyframes);
      expect(updated.cues).toEqual(original.cues);
    },
  );
});

describe('visual-media transitions', () => {
  it.each([
    ['image', 'image'],
    ['image', 'video'],
    ['video', 'image'],
  ] as const)('accepts explicit %s to %s overlap', (from, to) => {
    const clips = [from, to].map((kind, index) =>
      clipSchema.parse({
        id: `clip-${index}`,
        kind,
        assetId: `asset-${index}`,
        startUs: index * 1000000,
        durationUs: 2000000,
        ...(kind === 'video' ? { sourceOutUs: 2000000 } : {}),
      }),
    );
    const project = projectWith(clips[0]);
    project.tracks[0]!.clips.push(clips[1]!);
    const transition = {
      id: 'transition',
      trackId: 'track',
      fromClipId: 'clip-0',
      toClipId: 'clip-1',
      kind: 'crossfade' as const,
    };
    expect(
      applyOperations(project, [{ type: 'addTransition', transition }]).project
        .transitions,
    ).toEqual([transition]);
    project.tracks[0]!.clips.push({
      ...clips[0]!,
      id: 'third',
      startUs: 1500000,
    });
    expect(() =>
      applyOperations(project, [{ type: 'addTransition', transition }]),
    ).toThrow('third clip');
  });

  it('rejects audio endpoints even on a video track', () => {
    const project = projectWith();
    project.tracks[0]!.clips.push(
      clipSchema.parse({
        id: 'audio',
        kind: 'audio',
        assetId: 'audio-source',
        startUs: 1000000,
        durationUs: 4000000,
        sourceOutUs: 4000000,
      }),
    );
    expect(() =>
      applyOperations(project, [
        {
          type: 'addTransition',
          transition: {
            id: 'transition',
            trackId: 'track',
            fromClipId: 'source-clip',
            toClipId: 'audio',
            kind: 'crossfade',
          },
        },
      ]),
    ).toThrow('visual media clips');
  });
});
