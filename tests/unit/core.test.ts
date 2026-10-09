import { describe, it, expect } from 'vitest';
import {
  newProject,
  clipSchema,
  validateProject,
  validateBackup,
} from '../../src/core/model';
import {
  applyOperations,
  canonical,
  parseBatch,
} from '../../src/core/commands';
import {
  evaluateKeys,
  frameTimeUs,
  gainAt,
  mapSourceCue,
} from '../../src/core/timing';
import { importCaptions, exportCaptions } from '../../src/core/captions';
import { resampleAt } from '../../src/core/resample';
const clip = () =>
  clipSchema.parse({
    id: 'clip',
    kind: 'video',
    assetId: 'asset',
    startUs: 0,
    durationUs: 2000000,
    sourceOutUs: 2000000,
  });
const project = () => ({
  ...newProject('test'),
  tracks: [
    { id: 'track', kind: 'video' as const, muted: false, clips: [clip()] },
  ],
});
describe('project contracts', () => {
  it('rejects future versions, duplicate IDs and unsafe/source mismatched timing', () => {
    expect(() => validateProject({ ...project(), schemaVersion: 2 })).toThrow();
    expect(() =>
      validateProject({
        ...project(),
        tracks: [...project().tracks, ...project().tracks],
      }),
    ).toThrow();
    const p = project();
    p.tracks[0]!.clips[0]!.durationUs = 100;
    expect(() => validateProject(p)).toThrow();
  });
  it('rejects unknown command fields', () => {
    expect(() =>
      parseBatch({
        projectId: 'x',
        requestId: 'r',
        expectedRevision: 0,
        operations: [{ type: 'removeClip', clipId: 'c', surprise: true }],
      }),
    ).toThrow();
  });
  it('changes a clone and rolls back a failed batch', () => {
    const p = project();
    expect(() =>
      applyOperations(p, [
        {
          type: 'trimClip',
          clipId: 'clip',
          sourceInUs: 100,
          sourceOutUs: 1000000,
        },
        { type: 'removeClip', clipId: 'missing' },
      ]),
    ).toThrow();
    expect(p.tracks[0]!.clips[0]!.sourceInUs).toBe(0);
  });
  it('handles assembly, move, duplicate, ripple and explicit speed', () => {
    const p = project();
    const r = applyOperations(p, [
      { type: 'addTrack', track: { id: 'other', kind: 'video' } },
      {
        type: 'duplicateClip',
        clipId: 'clip',
        newClipId: 'copy',
        trackId: 'other',
        startUs: 2000000,
      },
      { type: 'moveClip', clipId: 'copy', trackId: 'track', startUs: 3000000 },
      { type: 'ripple', trackId: 'track', fromUs: 3000000, deltaUs: 1000000 },
      { type: 'setSpeed', clipId: 'clip', speed: 2 },
    ]).project;
    expect(r.tracks[0]!.clips.map((c) => c.startUs)).toEqual([0, 4000000]);
    expect(r.tracks[0]!.clips[0]!.durationUs).toBe(1000000);
  });
  it('splits source time and preserves interpolated keyframes and captions', () => {
    const p = project(),
      c = p.tracks[0]!.clips[0]!;
    c.speed = 2;
    c.sourceOutUs = 4000000;
    c.keyframes = {
      opacity: [
        { timeUs: 0, value: 0, interpolation: 'linear' },
        { timeUs: 2000000, value: 1, interpolation: 'linear' },
      ],
    };
    const r = applyOperations(p, [
      {
        type: 'splitClip',
        clipId: 'clip',
        atUs: 1000000,
        rightClipId: 'right',
      },
    ]).project;
    const [left, right] = r.tracks[0]!.clips;
    expect(left!.sourceOutUs).toBe(2000000);
    expect(right!.sourceInUs).toBe(2000000);
    expect(right!.keyframes.opacity![0]!.value).toBe(0.5);
  });
  it('validates explicit transition overlap and rejects a third clip', () => {
    const p = project();
    p.tracks[0]!.clips.push({ ...clip(), id: 'b', startUs: 1000000 });
    const op = {
      type: 'addTransition' as const,
      transition: {
        id: 't',
        trackId: 'track',
        fromClipId: 'clip',
        toClipId: 'b',
        kind: 'crossfade' as const,
      },
    };
    expect(applyOperations(p, [op]).project.transitions).toHaveLength(1);
    p.tracks[0]!.clips.push({ ...clip(), id: 'c', startUs: 1500000 });
    expect(() => applyOperations(p, [op])).toThrow();
  });
  it('uses stable canonical request content', () =>
    expect(canonical({ b: 2, a: { y: 1, x: 0 } })).toBe(
      canonical({ a: { x: 0, y: 1 }, b: 2 }),
    ));
});
describe('timing and captions', () => {
  it('derives rational frame timestamps without accumulating drift', () =>
    expect(frameTimeUs(30000, { num: 30000, den: 1001 })).toBe(1001000000));
  it('evaluates hold/linear and endpoint extensions', () => {
    const keys = [
      { timeUs: 100, value: 1, interpolation: 'hold' as const },
      { timeUs: 200, value: 3, interpolation: 'linear' as const },
      { timeUs: 300, value: 5, interpolation: 'linear' as const },
    ];
    expect(evaluateKeys(keys, 0, 0)).toBe(1);
    expect(evaluateKeys(keys, 150, 0)).toBe(1);
    expect(evaluateKeys(keys, 250, 0)).toBe(4);
    expect(evaluateKeys(keys, 400, 0)).toBe(5);
  });
  it('maps source captions through trim and speed', () => {
    const c = {
      ...clip(),
      startUs: 2000000,
      sourceInUs: 1000000,
      sourceOutUs: 5000000,
      speed: 2,
    };
    expect(
      mapSourceCue(
        { id: 'q', timeUs: 500000, endUs: 2000000, text: 'hello' },
        c,
      ),
    ).toEqual({ id: 'q', timeUs: 2000000, endUs: 2500000, text: 'hello' });
  });
  it('applies audio fades with half-open bounds', () => {
    const c = { ...clip(), fadeInUs: 1000000, fadeOutUs: 1000000 };
    expect(gainAt(c, 500000)).toBe(0.5);
    expect(gainAt(c, 2000000)).toBe(0);
  });
  it.each(['srt', 'vtt'] as const)(
    'round-trips %s plain multiline text',
    (format) => {
      const cues = [
        { id: 'q', timeUs: 1250000, endUs: 2500000, text: 'Hello\nworld' },
      ];
      const parsed = importCaptions(exportCaptions(cues, format));
      expect(parsed[0]).toMatchObject({
        timeUs: 1250000,
        endUs: 2500000,
        text: 'Hello\nworld',
      });
    },
  );
  it('rejects invalid cue order/timestamps', () =>
    expect(() =>
      importCaptions('1\n00:00:02,000 --> 00:00:01,000\nBad'),
    ).toThrow());
});
describe('streaming audio resampling', () => {
  const sine = (hz: number) =>
    Float32Array.from({ length: 48000 }, (_, i) =>
      Math.sin((i * 2 * Math.PI * hz) / 48000),
    );
  it('has an exact 1x sample path', () =>
    expect(resampleAt(sine(440), 1000, 1)).toBe(sine(440)[1000]));
  it('doubles tone frequency at2x and preserves block phase', () => {
    const source = sine(440),
      output = Float32Array.from({ length: 10000 }, (_, i) =>
        resampleAt(source, 100 + 2 * i, 2),
      );
    let crossings = 0;
    for (let i = 1; i < output.length; i++)
      if (output[i - 1]! < 0 && output[i]! >= 0) crossings++;
    expect((crossings * 48000) / output.length).toBeCloseTo(880, -1);
    expect(resampleAt(source, 100 + 2 * 5000, 2)).toBeCloseTo(output[5000]!, 6);
  });
  it('attenuates high-frequency aliasing at4x', () => {
    const source = sine(12000);
    const rms = Math.sqrt(
      Array.from(
        { length: 1000 },
        (_, i) => resampleAt(source, 100 + i * 4, 4) ** 2,
      ).reduce((a, b) => a + b, 0) / 1000,
    );
    expect(rms).toBeLessThan(0.02);
  });
  it.each([0.25, 4])('returns finite bounded samples at%sx', (speed) =>
    expect(Number.isFinite(resampleAt(sine(440), 100.25, speed))).toBe(true),
  );
});

it('preserves gain and fade continuity when splitting inside fades', () => {
  const p = project(),
    c = p.tracks[0]!.clips[0]!;
  c.fadeInUs = 1500000;
  c.fadeOutUs = 500000;
  const split = applyOperations(p, [
    { type: 'splitClip', clipId: c.id, atUs: 500000, rightClipId: 'right' },
  ]).project.tracks[0]!.clips;
  for (const t of [100000, 499999, 500000, 600000, 1750000]) {
    const part = t < 500000 ? split[0]! : split[1]!;
    expect(gainAt(part, t)).toBeCloseTo(gainAt(c, t), 10);
  }
});
it('rejects runtime project settings that could overwrite revision or identity', () => {
  expect(() => newProject('injection', { revision: 99 } as never)).toThrow();
  expect(newProject('valid', { width: 640 }).revision).toBe(0);
});

it('rejects backup source bounds before publishing any records', () => {
  expect(() =>
    validateBackup({
      backupVersion: 1,
      project: project(),
      transcripts: [],
      assets: [
        {
          id: 'asset',
          name: 'short',
          kind: 'video',
          type: 'video/webm',
          size: 1,
          durationUs: 1000000,
          width: 1920,
          height: 1080,
          rotation: 0,
          videoCodec: 'vp9',
          status: 'ready',
        },
      ],
    }),
  ).toThrow('exceeds source duration');
});
