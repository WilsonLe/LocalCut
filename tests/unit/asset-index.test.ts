import { describe, expect, it } from 'vitest';
import {
  measureFrame,
  selectAudioSegments,
  selectScenes,
  histogramDistance,
  hashDistance,
  parseIndexLabel,
  parseIndexSceneResponse,
  indexLabelSchema,
} from '../../src/core/asset-index';
import type { FrameMetrics } from '../../src/core/asset-index';
function frame(color: number[], timeUs: number, previous?: Uint8Array) {
  const pixels = new Uint8ClampedArray(8 * 8 * 4);
  for (let i = 0; i < 64; i++) pixels.set([...color, 255], i * 4);
  return measureFrame(pixels, 8, 8, timeUs, previous);
}
const label = {
  summary: 'A red scene',
  subjects: ['shape'],
  scene: 'studio',
  style: 'flat',
  tags: ['red'],
  sound: 'tone',
};
describe('deterministic asset evidence', () => {
  it('partitions silent edges, continuous audio, brief and silent assets with stable energy peaks', () => {
    const windows = Array.from({ length: 24 }, (_, i) => ({
      timeUs: i * 250000,
      rms: (i >= 4 && i < 8) || (i >= 12 && i < 20) ? 0.3 : 0,
      peak: 0.5,
    }));
    const scenes = selectAudioSegments(windows, 6000000);
    expect(scenes.map((s) => [s.startUs, s.endUs])).toEqual([
      [0, 1000000],
      [1000000, 2000000],
      [2000000, 3000000],
      [3000000, 5000000],
      [5000000, 6000000],
    ]);
    expect(scenes[3]?.actionUs).toBe(3000000);
    expect(
      scenes.every(
        (s) => s.excerptStartUs >= s.startUs && s.excerptEndUs <= s.endUs,
      ),
    ).toBe(true);
    expect(
      selectAudioSegments([{ timeUs: 0, rms: 0, peak: 0 }], 100000)[0],
    ).toMatchObject({ actionUs: 50000, excerptEndUs: 100000 });
    const continuous = Array.from({ length: 240 }, (_, i) => ({
      timeUs: i * 250000,
      rms: 0.3,
      peak: 0.5,
    }));
    expect(
      selectAudioSegments(continuous, 60000000).map((s) => [
        s.startUs,
        s.endUs,
      ]),
    ).toEqual([
      [0, 30000000],
      [30000000, 60000000],
    ]);
    expect(selectAudioSegments(windows, 6000000)).toEqual(scenes);
  });
  it('keeps static footage as one scene with stable ties and midpoint action', () => {
    const frames = [0, 250000, 500000, 750000].map(
      (t) => frame([100, 100, 100], t).metrics,
    );
    const scenes = selectScenes(frames, 1000000);
    expect(scenes).toEqual(selectScenes(frames, 1000000));
    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toMatchObject({
      representativeUs: 0,
      actionUs: 500000,
      excerptStartUs: 0,
      excerptEndUs: 1000000,
    });
  });
  it('separates hard cuts, bounds short excerpts and excludes cuts from motion peaks', () => {
    const red = frame([255, 0, 0], 0),
      blue = frame([0, 0, 255], 500000, red.luma);
    expect(histogramDistance(red.metrics, blue.metrics)).toBeGreaterThan(0.45);
    const scenes = selectScenes(
      [
        red.metrics,
        { ...red.metrics, timeUs: 250000 },
        blue.metrics,
        { ...blue.metrics, timeUs: 750000, motion: 0 },
      ],
      1000000,
    );
    expect(scenes.map((s) => [s.startUs, s.endUs])).toEqual([
      [0, 500000],
      [500000, 1000000],
    ]);
    expect(scenes[1]).toMatchObject({
      actionUs: 750000,
      excerptStartUs: 500000,
      excerptEndUs: 1000000,
    });
  });
  it('scores texture, exposure and actual dominant colors without native dependencies', () => {
    const flat = frame([0, 0, 0], 0);
    const pixels = new Uint8ClampedArray(8 * 8 * 4);
    for (let i = 0; i < 64; i++)
      pixels.set([...(i % 2 ? [200, 200, 200] : [20, 20, 20]), 255], i * 4);
    const sharp = measureFrame(pixels, 8, 8, 0).metrics;
    expect(sharp.sharpness).toBeGreaterThan(flat.metrics.sharpness);
    expect(flat.metrics.clipped).toBe(1);
    expect(frame([255, 0, 0], 0).metrics.colors).toEqual(['#f80808']);
    expect(hashDistance(sharp.hash, sharp.hash)).toBe(0);
    expect(selectScenes([sharp], 0, true)[0]).toMatchObject({
      startUs: 0,
      endUs: 0,
      excerptEndUs: 0,
    });
  });
  it('selects action peaks within long shots and leaves missing samples out', () => {
    const base = frame([80, 80, 80], 0).metrics;
    const frames: FrameMetrics[] = [
      { ...base, timeUs: 0 },
      { ...base, timeUs: 7000000, motion: 0.5 },
    ];
    expect(selectScenes(frames, 10000000)[0]).toMatchObject({
      actionUs: 7000000,
      excerptStartUs: 5000000,
      excerptEndUs: 9000000,
    });
    expect(selectScenes([], 1000)).toEqual([]);
  });
  it('rejects executable labels and accepts fenced JSON', () => {
    expect(
      parseIndexLabel('```json\n' + JSON.stringify(label) + '\n```'),
    ).toEqual(label);
    expect(() =>
      parseIndexLabel(JSON.stringify({ ...label, tool: 'apply' })),
    ).toThrow();
  });
  it('bounds every oversized provider field using the unchanged persisted contract', () => {
    const oversized = {
      summary: 's'.repeat(2001),
      subjects: Array.from({ length: 33 }, (_, i) => `${i}-` + 'x'.repeat(101)),
      scene: 'c'.repeat(301),
      style: 'y'.repeat(341),
      tags: Array.from({ length: 34 }, (_, i) => `${i}-` + 't'.repeat(101)),
      sound: 'a'.repeat(501),
    };
    expect(() => indexLabelSchema.parse(oversized)).toThrow();
    const expected = {
      summary: 's'.repeat(2000),
      subjects: oversized.subjects.slice(0, 32).map((s) => s.slice(0, 100)),
      scene: 'c'.repeat(300),
      style: 'y'.repeat(300),
      tags: oversized.tags.slice(0, 32).map((s) => s.slice(0, 100)),
      sound: 'a'.repeat(500),
    };
    expect(parseIndexLabel(JSON.stringify(oversized))).toEqual(expected);
    expect(
      parseIndexSceneResponse(
        JSON.stringify({ sceneId: 'host', label: oversized }),
      ),
    ).toEqual({ sceneId: 'host', label: expected });
    expect(indexLabelSchema.parse(expected)).toEqual(expected);
  });
  it('keeps complete Unicode characters at the storage boundary', () => {
    expect(
      parseIndexLabel(
        JSON.stringify({ ...label, style: 'a'.repeat(299) + '🎬x' }),
      ).style,
    ).toBe('a'.repeat(299) + '🎬');
    expect(
      parseIndexLabel(JSON.stringify({ ...label, style: '🎬'.repeat(301) }))
        .style,
    ).toBe('🎬'.repeat(300));
  });
  it.each([
    { ...label, summary: '' },
    { ...label, sound: null },
    { ...label, subjects: ['valid', 3] },
    { ...label, tags: [...Array<string>(32).fill('valid'), false] },
    { ...label, scene: undefined, style: 'x'.repeat(341) },
    { ...label, command: 'apply', summary: 'x'.repeat(2001) },
  ])('does not hide invalid fields behind size normalization', (invalid) => {
    expect(() => parseIndexLabel(JSON.stringify(invalid))).toThrow();
  });
  it('keeps the scene envelope strict even when the label is oversized', () => {
    for (const invalid of [
      { sceneId: 1, label },
      { sceneId: 's'.repeat(101), label },
      { sceneId: 'host' },
      { sceneId: 'host', label, tool: 'apply' },
    ])
      expect(() => parseIndexSceneResponse(JSON.stringify(invalid))).toThrow();
  });
});
