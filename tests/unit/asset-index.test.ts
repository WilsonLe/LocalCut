import { captureFixture } from '../capture-metadata-fixture';
import { describe, expect, it } from 'vitest';
import {
  measureFrame,
  selectAudioSegments,
  selectScenes,
  histogramDistance,
  hashDistance,
  parseIndexLabel,
} from '../../src/core/asset-index';
import type { AssetIndexRun, FrameMetrics } from '../../src/core/asset-index';
import {
  newestIndexes,
  indexCatalog,
  searchIndexes,
  readIndex,
} from '../../src/ai/index-context';
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
function run(id: string, assetId: string, createdAt: number): AssetIndexRun {
  return {
    version: 1,
    id,
    assetId,
    createdAt,
    status: 'complete',
    invalidated: false,
    source: {
      kind: 'image',
      width: 8,
      height: 8,
      durationUs: 0,
      size: 64,
      lastModified: 0,
      hasAudio: false,
    },
    analysis: {
      version: 1,
      settings: {
        sampleRate: 4,
        analysisWidth: 160,
        cutThreshold: 0.45,
        excerptUs: 4000000,
      },
      frames: [],
      scenes: [
        {
          ...selectScenes([frame([255, 0, 0], 0).metrics], 0, true)[0]!,
          label,
        },
      ],
      scanMs: 0,
      generationMs: 0,
    },
    label,
    requests: [
      {
        id: 'request',
        prompt: 'private prompt',
        model: 'test',
        artifactIds: [],
        createdAt: 0,
        response: 'private raw reply',
      },
    ],
  };
}
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
  it('rejects executable/unbounded labels and accepts fenced JSON', () => {
    expect(
      parseIndexLabel('```json\n' + JSON.stringify(label) + '\n```'),
    ).toEqual(label);
    expect(() =>
      parseIndexLabel(JSON.stringify({ ...label, tool: 'apply' })),
    ).toThrow();
    expect(() =>
      parseIndexLabel(JSON.stringify({ ...label, summary: 'x'.repeat(2001) })),
    ).toThrow();
  });
});
describe('saved index context', () => {
  it('shares structured capture only by permission and withholds capture-informed labels after revocation', () => {
    const asset = run('capture', 'allowed', 2);
    asset.source.capture = captureFixture;
    const policy = { includeCaptureMetadata: true };
    expect(indexCatalog([asset]).assets[0]).not.toHaveProperty('capture');
    expect(readIndex(asset)).not.toHaveProperty('capture');
    expect(searchIndexes([asset], '2024-06-15').total).toBe(0);
    expect(indexCatalog([asset], 10000, policy).assets[0]?.capture).toEqual(
      captureFixture,
    );
    expect(readIndex(asset, 0, 20, policy).capture).toEqual(captureFixture);
    expect(searchIndexes([asset], '153.25', 0, 20, policy).total).toBe(1);
    asset.captureShared = true;
    asset.label = { ...asset.label!, summary: 'Private trip on 2024-06-15' };
    expect(newestIndexes([asset], new Set(['allowed']))).toEqual([]);
    expect(newestIndexes([asset], new Set(['allowed']), policy)).toEqual([
      asset,
    ]);
    expect(indexCatalog([asset]).assets).toEqual([]);
    expect(searchIndexes([asset], '').total).toBe(0);
    expect(() => readIndex(asset)).toThrow(/permission/);
  });
  it('selects only the newest complete valid authorized run', () => {
    const old = run('old', 'allowed', 1),
      fresh = run('fresh', 'allowed', 2),
      privateRun = run('private', 'hidden', 3);
    expect(
      newestIndexes([old, fresh, privateRun], new Set(['allowed'])),
    ).toEqual([fresh]);
    fresh.invalidated = true;
    expect(newestIndexes([old, fresh], new Set(['allowed']))).toEqual([old]);
    old.status = 'failed';
    expect(newestIndexes([old, fresh], new Set(['allowed']))).toEqual([]);
  });
  it('bounds catalog and paginates observations without requests or artifacts', () => {
    const asset = run('id', 'allowed', 0),
      catalog = indexCatalog([asset], 10000);
    expect(JSON.stringify(catalog)).not.toContain('private');
    expect(indexCatalog([asset], 1)).toMatchObject({
      indexedAssetCount: 1,
      assets: [],
      truncated: true,
    });
    expect(searchIndexes([asset], 'red').matches).toHaveLength(1);
    for (const query of ['tone', 'shape', 'studio', 'flat'])
      expect(searchIndexes([asset], query).matches).toHaveLength(1);
    expect(searchIndexes([asset], 'tone').matches[0]?.sound).toBe('tone');
    expect(searchIndexes([asset], 'private').matches).toHaveLength(0);
    expect(searchIndexes([asset], 'unseen').matches).toHaveLength(0);
    expect(readIndex(asset, 1).scenes).toEqual([]);
    expect(JSON.stringify(readIndex(asset))).not.toContain('private');
  });
  it('reports only successfully transmitted reference evidence and preserves unknown legacy coverage', () => {
    const asset = run('reference', 'video', 0);
    asset.source = {
      ...asset.source,
      kind: 'video',
      durationUs: 9000000,
      hasAudio: true,
    };
    const scene = asset.analysis.scenes[0]!;
    scene.artifacts = [
      { id: 'still', kind: 'image', type: 'image/jpeg', size: 1 },
      { id: 'clip', kind: 'video', type: 'video/mp4', size: 1 },
    ];
    expect(readIndex(asset).scenes[0]?.evidence).toMatchObject({
      recorded: false,
      motionAssessed: false,
      soundAssessed: false,
    });
    asset.requests.push({
      id: 'still-request',
      sceneId: scene.id,
      prompt: 'private',
      model: 'image-model',
      artifactIds: ['still'],
      createdAt: 1,
      label,
    });
    // A failed clip request must not overstate the successful still-only label.
    asset.requests.push({
      id: 'failed-clip',
      sceneId: scene.id,
      prompt: 'private',
      model: 'video-model',
      artifactIds: ['still', 'clip'],
      createdAt: 2,
      response: 'invalid',
    });
    expect(readIndex(asset).scenes[0]?.evidence).toEqual({
      recorded: true,
      still: true,
      video: false,
      audio: false,
      motionAssessed: false,
      soundAssessed: false,
    });
    asset.requests.at(-1)!.label = label;
    expect(readIndex(asset).scenes[0]?.evidence).toMatchObject({
      video: true,
      audio: true,
      motionAssessed: true,
      soundAssessed: true,
    });
    asset.source.hasAudio = false;
    expect(readIndex(asset).scenes[0]?.evidence.soundAssessed).toBe(false);
    expect(readIndex(asset)).toMatchObject({
      source: { kind: 'video', durationUs: 9000000, hasAudio: false },
      sampling: {
        sampleRate: 4,
        excerptUs: 4000000,
        completeSceneCoverage: false,
      },
    });
    expect(JSON.stringify(readIndex(asset))).not.toMatch(
      /private|image-model|video-model/,
    );
  });
});
