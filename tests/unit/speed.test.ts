import { speedRampSchema } from '../../src/core/speed-schema';
import { describe, expect, it } from 'vitest';
import { applyOperations, parseBatch } from '../../src/core/commands';
import { clipSchema, newProject, validateProject } from '../../src/core/model';
import { mapSourceCue, sourceTimeUs } from '../../src/core/timing';
import {
  averageSpeed,
  rampPreset,
  sliceRamp,
  sourceDurationUs,
  sourcePositionUs,
  rampSpeed,
  nominalSourceBounds,
} from '../../src/core/speed';
import { PitchStretcher } from '../../src/core/stretch';

const project = () => ({
  ...newProject('speed'),
  tracks: [
    {
      id: 't',
      kind: 'video' as const,
      muted: false,
      clips: [
        clipSchema.parse({
          id: 'c',
          kind: 'video',
          assetId: 'a',
          startUs: 200000,
          sourceInUs: 101,
          sourceOutUs: 8000101,
          durationUs: 8000000,
          fadeInUs: 100000,
          fadeOutUs: 300000,
          keyframes: { gain: [{ id: 'gain', timeUs: 8000000, value: 0.5 }] },
        }),
      ],
    },
  ],
});
const edited = (interpolation: 'linear' | 'smooth' | 'hold') =>
  applyOperations(project(), [
    {
      type: 'setSpeedRamp',
      clipId: 'c',
      points: rampPreset('up-down', interpolation),
      pitchMode: 'preserve',
    },
  ]).project;

describe('speed and integrated source timing', () => {
  it('defaults old documents to changing pitch and atomically rejects malformed ramps', () => {
    expect(project().tracks[0]!.clips[0]!.pitchMode).toBeUndefined();
    for (const points of [
      [],
      [
        { position: 0.1, speed: 1 },
        { position: 1, speed: 2 },
      ],
      [
        { position: 0, speed: 1 },
        { position: 0, speed: 2 },
      ],
      [
        { position: 0, speed: 0 },
        { position: 1, speed: 1 },
      ],
    ])
      expect(speedRampSchema.safeParse(points).success).toBe(false);
    expect(() =>
      parseBatch({
        projectId: 'p',
        requestId: 'r',
        expectedRevision: 0,
        operations: [
          {
            type: 'setSpeedRamp',
            clipId: 'c',
            points: [
              { position: 0, speed: 1, curveStart: 1, curveEnd: 0 },
              { position: 1, speed: 2 },
            ],
          },
        ],
      }),
    ).toThrow();
    const p = edited('linear');
    const bad = structuredClone(p);
    bad.tracks[0]!.clips[0]!.durationUs++;
    bad.tracks[0]!.clips[0]!.durationUs += 10;
    expect(() => validateProject(bad)).toThrow();
    expect(project().tracks[0]!.clips[0]!.durationUs).toBe(8000000);
  });
  it.each(['linear', 'smooth', 'hold'] as const)(
    'integrates %s ramps, retimes envelopes and inverts caption timing',
    (interpolation) => {
      const c = edited(interpolation).tracks[0]!.clips[0]!;
      expect(c.sourceInUs).toBe(101);
      expect(c.sourceOutUs).toBe(8000101);
      expect(c.durationUs).toBe(sourceDurationUs(c, 8000000));
      expect(c.keyframes.gain![0]!.timeUs).toBe(c.durationUs);
      expect(c.fadeInUs + c.fadeOutUs).toBeLessThan(c.durationUs);
      expect(sourceTimeUs(c, c.startUs + c.durationUs)).toBe(c.sourceOutUs);
      const mid = Math.round(c.durationUs * 0.37),
        end = Math.round(c.durationUs * 0.64);
      const cue = mapSourceCue(
        {
          id: 'cue',
          text: 'test',
          timeUs: sourceTimeUs(c, c.startUs + mid),
          endUs: sourceTimeUs(c, c.startUs + end),
        },
        c,
      )!;
      expect(Math.abs(cue.timeUs - c.startUs - mid)).toBeLessThanOrEqual(2);
      expect(Math.abs(cue.endUs - c.startUs - end)).toBeLessThanOrEqual(2);
      const split = applyOperations(edited(interpolation), [
        {
          type: 'splitClip',
          clipId: 'c',
          atUs: c.startUs + mid,
          rightClipId: 'right',
        },
      ]).project.tracks[0]!.clips;
      expect(split[0]!.sourceOutUs).toBe(split[1]!.sourceInUs);
      expect(split[0]!.durationUs + split[1]!.durationUs).toBe(c.durationUs);
      for (let local = 0; local <= c.durationUs; local += 7919) {
        const piece = local < mid ? split[0]! : split[1]!;
        expect(
          Math.abs(
            sourcePositionUs(piece, local - (local < mid ? 0 : mid)) -
              sourcePositionUs(c, local),
          ),
        ).toBeLessThanOrEqual(1);
      }
    },
  );
  it('splits frame-boundary ramps without accumulating rounded source errors', () => {
    const initial = project();
    const original = initial.tracks[0]!.clips[0]!;
    Object.assign(original, {
      startUs: 0,
      sourceInUs: 0,
      sourceOutUs: 8000001,
      durationUs: 8000001,
      keyframes: {},
      fadeInUs: 0,
      fadeOutUs: 0,
    });
    let current = applyOperations(initial, [
      {
        type: 'setSpeedRamp',
        clipId: 'c',
        points: [
          { position: 0, speed: 0.25, interpolation: 'hold' },
          { position: 0.7, speed: 0.25, interpolation: 'linear' },
          { position: 1, speed: 4, interpolation: 'hold' },
        ],
      },
    ]).project;
    const unsplit = structuredClone(current.tracks[0]!.clips[0]!);
    expect(unsplit.durationUs).toBe(9846155);
    current = applyOperations(current, [
      {
        type: 'splitClip',
        clipId: 'c',
        atUs: 6966667,
        rightClipId: 'right-0',
      },
    ]).project;
    expect(current.tracks[0]!.clips[0]!.sourceOutUs).toBe(1745177);
    for (let i = 1; i < 12; i++) {
      const left = current.tracks[0]!.clips.find((c) => c.id === 'c')!;
      const atUs = Math.round(
        (Math.floor((left.durationUs * 0.7) / (1e6 / 30)) * 1e6) / 30,
      );
      if (atUs <= 0) break;
      current = applyOperations(current, [
        {
          type: 'splitClip',
          clipId: 'c',
          atUs,
          rightClipId: `right-${i}`,
        },
      ]).project;
    }
    const pieces = [...current.tracks[0]!.clips].sort(
      (a, b) => a.startUs - b.startUs,
    );
    expect(pieces.length).toBeGreaterThan(8);
    expect(pieces.reduce((sum, c) => sum + c.durationUs, 0)).toBe(
      unsplit.durationUs,
    );
    for (let i = 0; i < pieces.length; i++) {
      const clip = pieces[i]!;
      if (i) {
        expect(clip.sourceInUs).toBe(pieces[i - 1]!.sourceOutUs);
        expect(clip.startUs).toBe(
          pieces[i - 1]!.startUs + pieces[i - 1]!.durationUs,
        );
      }
      expect(Math.round(nominalSourceBounds(clip).inUs)).toBe(clip.sourceInUs);
      expect(Math.round(nominalSourceBounds(clip).outUs)).toBe(
        clip.sourceOutUs,
      );
      for (const fraction of [0, 0.17, 0.5, 0.91, 1])
        expect(
          Math.abs(
            sourcePositionUs(clip, clip.durationUs * fraction) -
              sourcePositionUs(
                unsplit,
                clip.startUs + clip.durationUs * fraction,
              ),
          ),
        ).toBeLessThanOrEqual(1);
    }
    expect(validateProject(JSON.parse(JSON.stringify(current)))).toEqual(
      current,
    );
    const copied = applyOperations(current, [
      { type: 'addTrack', track: { id: 'audio', kind: 'audio' } },
      {
        type: 'separateAudio',
        clipId: 'c',
        audioClipId: 'separated',
        trackId: 'audio',
      },
      {
        type: 'duplicateClip',
        clipId: 'separated',
        newClipId: 'copied',
        trackId: 'audio',
        startUs: 20000000,
      },
    ]).project;
    expect(copied.tracks[1]!.clips.map((c) => c.speedRampSourceRange)).toEqual([
      pieces[0]!.speedRampSourceRange,
      pieces[0]!.speedRampSourceRange,
    ]);
    const invalid = structuredClone(current);
    invalid.tracks[0]!.clips[0]!.speedRampSourceRange!.to += 0.00001;
    expect(() => validateProject(invalid)).toThrow();
    for (const operation of [
      { type: 'setSpeed', clipId: 'c', speed: 1 },
      { type: 'setSpeedRamp', clipId: 'c', points: pieces[0]!.speedRamp! },
      { type: 'trimClip', clipId: 'c', sourceInUs: 0, sourceOutUs: 100000 },
    ] as const) {
      const changed = applyOperations(current, [operation]).project.tracks[0]!
        .clips[0]!;
      expect(changed.speedRampSourceRange).toBeUndefined();
    }
  });
  it('retains nominal bounds through deep smooth splits and unchanged timing patches', () => {
    let current = edited('smooth');
    const original = structuredClone(current.tracks[0]!.clips[0]!);
    for (let i = 0; i < 30; i++) {
      const clip = current.tracks[0]!.clips[0]!;
      current = applyOperations(current, [
        {
          type: 'splitClip',
          clipId: 'c',
          atUs: clip.startUs + Math.round(clip.durationUs * 0.83),
          rightClipId: `deep-${i}`,
        },
      ]).project;
    }
    const clip = current.tracks[0]!.clips[0]!;
    expect(
      Math.abs(
        sourcePositionUs(clip, clip.durationUs) -
          sourcePositionUs(original, clip.durationUs),
      ),
    ).toBeLessThanOrEqual(0.5);
    const gained = applyOperations(current, [
      {
        type: 'updateClip',
        clipId: 'c',
        patch: {
          gain: 0.2,
          durationUs: clip.durationUs,
          sourceInUs: clip.sourceInUs,
          sourceOutUs: clip.sourceOutUs,
        },
      },
    ]).project.tracks[0]!.clips[0]!;
    expect(gained.speedRampSourceRange).toEqual(clip.speedRampSourceRange);
    const durationUs =
      sourceDurationUs(clip, clip.sourceOutUs! - clip.sourceInUs) + 10;
    const updated = applyOperations(current, [
      {
        type: 'updateClip',
        clipId: 'c',
        patch: {
          durationUs,
          sourceOutUs:
            clip.sourceInUs + Math.round(durationUs * averageSpeed(clip)),
          keyframes: {},
          fadeInUs: 0,
          fadeOutUs: 0,
        },
      },
    ]).project.tracks[0]!.clips[0]!;
    expect(updated.speedRampSourceRange).toBeUndefined();
  });
  it('staircase presets reach their final plateau before the clip endpoint', () => {
    for (const direction of ['up', 'down', 'up-down', 'down-up'] as const) {
      const points = rampPreset(direction, 'hold');
      expect(points).toHaveLength(9);
      expect(rampSpeed(points, 0.99)).toBe(points.at(-1)!.speed);
      expect(rampSpeed(points, 0.49)).toBe(
        direction === 'up' || direction === 'up-down'
          ? direction === 'up'
            ? points[3]!.speed
            : 2
          : direction === 'down'
            ? points[3]!.speed
            : 0.5,
      );
      expect(rampSpeed(points, 0.001)).toBe(
        direction === 'up' || direction === 'up-down' ? 0.5 : 2,
      );
    }
  });
  it('keeps smooth curves exact across repeated slices and tiny boundary segments', () => {
    const ramp = rampPreset('up', 'smooth');
    for (const [from, to] of [
      [0, 0.000001],
      [0.999999, 1],
      [0.13, 0.78],
    ]) {
      const slice = sliceRamp(ramp, from!, to!);
      expect(speedRampSchema.safeParse(slice).success).toBe(true);
      for (let p = 0; p < 1; p += 0.1)
        expect(rampSpeed(slice, p)).toBeCloseTo(
          rampSpeed(ramp, from! + (to! - from!) * p),
          9,
        );
      expect(
        Number.isFinite(averageSpeed({ speed: 1, speedRamp: slice })),
      ).toBe(true);
    }
  });
  it('preserves ramp and pitch through separate/duplicate/trim and clears the ramp with constant speed', () => {
    let p = edited('smooth');
    p = applyOperations(p, [
      { type: 'addTrack', track: { id: 'audio', kind: 'audio' } },
      {
        type: 'separateAudio',
        clipId: 'c',
        audioClipId: 'audio-c',
        trackId: 'audio',
      },
      {
        type: 'duplicateClip',
        clipId: 'audio-c',
        newClipId: 'copy',
        trackId: 'audio',
        startUs: 9000000,
      },
    ]).project;
    const c = p.tracks[0]!.clips[0]!;
    expect(p.tracks[1]!.clips[0]!.speedRamp).toEqual(c.speedRamp);
    expect(p.tracks[1]!.clips[1]!.pitchMode).toBe('preserve');
    const withoutKeys = structuredClone(p);
    withoutKeys.tracks[0]!.clips[0]!.keyframes = {};
    const trimmed = applyOperations(withoutKeys, [
      {
        type: 'trimClip',
        clipId: 'c',
        sourceInUs: 1000101,
        sourceOutUs: 6000101,
      },
    ]).project.tracks[0]!.clips[0]!;
    expect(trimmed.speedRamp).toEqual(c.speedRamp);
    expect(trimmed.durationUs).toBe(sourceDurationUs(trimmed, 5000000));
    const defaulted = applyOperations(project(), [
      {
        type: 'setSpeedRamp',
        clipId: 'c',
        points: [
          { position: 0, speed: 1 },
          { position: 1, speed: 2 },
        ],
      },
    ]).project.tracks[0]!.clips[0]!;
    expect(defaulted.speedRamp![0]!.interpolation).toBe('linear');
    expect(defaulted.durationUs).toBe(5333333);
    p = applyOperations(p, [
      { type: 'setSpeed', clipId: 'c', speed: 4 },
    ]).project;
    expect(p.tracks[0]!.clips[0]!).toMatchObject({
      sourceInUs: 101,
      sourceOutUs: 8000101,
      durationUs: 2000000,
      pitchMode: 'preserve',
    });
    expect(p.tracks[0]!.clips[0]!.speedRamp).toBeUndefined();
  });
});
function frequency(data: Float32Array) {
  let crosses = 0;
  for (let i = 1; i < data.length; i++)
    if (data[i - 1]! <= 0 && data[i]! > 0) crosses++;
  return (crosses * 48000) / data.length;
}
describe('bounded pitch preservation', () => {
  it.each([0.25, 0.5, 1.5, 2, 4])(
    'keeps a stereo tone at %sx and is continuous across arbitrary blocks',
    async (speed) => {
      const read = async (start: number, count: number) =>
        [440, 440].map((hz, c) =>
          Float32Array.from(
            { length: count },
            (_, i) =>
              Math.sin(((start + i) * 2 * Math.PI * hz) / 48000) *
              (c ? -0.4 : 0.4),
          ),
        );
      const one = await new PitchStretcher().render(
        0,
        48000,
        (frame) => frame * speed,
        read,
      );
      const blocked = [new Float32Array(48000), new Float32Array(48000)],
        stretch = new PitchStretcher();
      for (let start = 0; start < 48000; start += 997) {
        const result = await stretch.render(
          start,
          Math.min(997, 48000 - start),
          (frame) => frame * speed,
          read,
        );
        for (let c = 0; c < 2; c++) blocked[c]!.set(result[c]!, start);
      }
      expect(blocked).toEqual(one);
      expect(frequency(one[0]!.subarray(4800, 43200))).toBeCloseTo(440, -1);
      for (let i = 0; i < 48000; i++)
        expect(Math.abs(one[0]![i]! + one[1]![i]!)).toBeLessThan(1e-7);
    },
  );
  it('retains right-only audio and resets safely after backward seeks', async () => {
    const read = async (start: number, count: number) => [
      new Float32Array(count),
      Float32Array.from(
        { length: count },
        (_, i) => Math.sin(((start + i) * 2 * Math.PI * 660) / 48000) * 0.3,
      ),
    ];
    const stretch = new PitchStretcher();
    await stretch.render(50000, 10000, (frame) => frame * 2, read);
    const result = await stretch.render(0, 48000, (frame) => frame * 2, read);
    expect(result[0]!.every((x) => x === 0)).toBe(true);
    expect(frequency(result[1]!.subarray(4800, 43200))).toBeCloseTo(660, -1);
  });
});
