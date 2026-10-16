import { afterEach, expect, it, vi } from 'vitest';
import { Renderer } from '../../src/media/composition';
import { clipSchema, newProject } from '../../src/core/model';
import type { Store } from '../../src/storage/store';
vi.mock('../../src/media/assets', () => ({
  convertCache: async () => new File([], 'pcm.wav'),
  pcmWindow: async (_file: File, start: number, count: number) =>
    [0, 1].map((c) =>
      Float32Array.from({ length: count }, (_, i) => {
        const time = (start + i) / 48000;
        return (
          0.3 * Math.sin(2 * Math.PI * 753 * time) +
          0.2 * Math.sin(2 * Math.PI * (1837 + c * 7) * time)
        );
      }),
    ),
}));
afterEach(() => vi.unstubAllGlobals());
it.each([1600, 12000])(
  'keeps processed keep-pitch output continuous across %s-sample windows',
  async (block) => {
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        width: number;
        height: number;
        constructor(width: number, height: number) {
          this.width = width;
          this.height = height;
        }
      },
    );
    const store = {
      getAsset: async () => ({ audioCodec: 'pcm' }),
      lease: async () => () => {},
    } as unknown as Store;
    const clip = clipSchema.parse({
      id: 'audio',
      kind: 'audio',
      assetId: 'source',
      startUs: 0,
      durationUs: 1e6,
      sourceOutUs: 1300000,
      speed: 1.3,
      pitchMode: 'preserve',
    });
    const project = {
      ...newProject('Audio continuity'),
      tracks: [
        { id: 'a', kind: 'audio' as const, muted: false, clips: [clip] },
      ],
    };
    for (const effects of [
      { equalizer: { lowDb: 0, midDb: 0, highDb: 0 } },
      {
        equalizer: { lowDb: 3, midDb: -2, highDb: 4 },
        noiseReduction: 0.4,
        noiseFloorDb: -60,
      },
    ]) {
      const processed = {
        ...project,
        tracks: [{ ...project.tracks[0]!, clips: [{ ...clip, ...effects }] }],
      };
      const whole = new Renderer(store, processed),
        chunked = new Renderer(store, processed),
        neutral = new Renderer(store, project);
      try {
        const full = await whole.audio(0, 48000, new AbortController().signal),
          original = await neutral.audio(
            0,
            48000,
            new AbortController().signal,
          );
        const output = [new Float32Array(48000), new Float32Array(48000)];
        for (let start = 0; start < 48000; start += block) {
          const samples = await chunked.audio(
            start,
            Math.min(block, 48000 - start),
            new AbortController().signal,
          );
          for (let c = 0; c < 2; c++) output[c]!.set(samples[c]!, start);
        }
        for (let c = 0; c < 2; c++) {
          let difference = 0;
          for (let i = 0; i < 48000; i++)
            difference = Math.max(
              difference,
              Math.abs(full[c]![i]! - output[c]![i]!),
            );
          expect(difference).toBeLessThan(1e-5);
          if (!('noiseReduction' in effects)) {
            let delta = 0;
            for (let i = 0; i < 48000; i++)
              delta = Math.max(
                delta,
                Math.abs(full[c]![i]! - original[c]![i]!),
              );
            expect(delta).toBeLessThan(1e-6);
          }
        }
      } finally {
        whole.dispose();
        chunked.dispose();
        neutral.dispose();
      }
    }
  },
);

const boundaries = [
  { timeUs: 5_260_000, blockStart: 251_200, edge: 1280 },
  { timeUs: 9_680_000, blockStart: 464_000, edge: 640 },
  { timeUs: 20_340_000, blockStart: 976_000, edge: 320 },
];
const modes = [
  { mode: 'plain', patch: {} },
  { mode: 'fade', patch: { fadeOutUs: 120_000 } },
  { mode: 'zero gain', patch: { gain: 0 } },
  {
    mode: 'effects',
    patch: {
      equalizer: { lowDb: 2, midDb: -1, highDb: 3 },
      noiseReduction: 0.2,
    },
  },
  { mode: 'keep pitch', patch: { speed: 1.3, pitchMode: 'preserve' } },
];
function boundaryRenderer(clip: unknown) {
  vi.stubGlobal('OffscreenCanvas', class {});
  const store = {
    getAsset: async () => ({ audioCodec: 'pcm' }),
    lease: async () => () => {},
  } as unknown as Store;
  return new Renderer(store, {
    ...newProject('Audio sample boundaries'),
    tracks: [
      {
        id: 'audio',
        kind: 'audio',
        muted: false,
        clips: [clipSchema.parse(clip)],
      },
    ],
  });
}
it.each(
  boundaries.flatMap((boundary) =>
    modes.map((mode) => ({ ...boundary, ...mode })),
  ),
)(
  'keeps $mode PCM finite and silent after the $timeUs endpoint',
  async ({ timeUs, blockStart, edge, patch }) => {
    const renderer = boundaryRenderer({
      id: 'trimmed',
      kind: 'audio',
      assetId: 'source',
      startUs: 300_000,
      durationUs: timeUs - 300_000,
      sourceOutUs: (timeUs - 300_000) * (patch.speed ?? 1),
      ...patch,
    });
    try {
      const channels = await renderer.audio(
        blockStart,
        1600,
        new AbortController().signal,
      );
      for (const channel of channels) {
        expect(channel.every(Number.isFinite)).toBe(true);
        expect(channel.subarray(edge).every((sample) => sample === 0)).toBe(
          true,
        );
      }
    } finally {
      renderer.dispose();
    }
  },
);
it.each(boundaries)(
  'keeps the first active sample at the $timeUs start',
  async ({ timeUs, blockStart, edge }) => {
    const renderer = boundaryRenderer({
      id: 'starting',
      kind: 'audio',
      assetId: 'source',
      startUs: timeUs,
      durationUs: 1_000_000,
      sourceInUs: 5000,
      sourceOutUs: 1_005_000,
    });
    try {
      const channels = await renderer.audio(
        blockStart,
        1600,
        new AbortController().signal,
      );
      for (let c = 0; c < 2; c++) {
        expect(
          channels[c]!.subarray(0, edge).every((sample) => sample === 0),
        ).toBe(true);
        const expected =
          0.3 * Math.sin(2 * Math.PI * 753 * 0.005) +
          0.2 * Math.sin(2 * Math.PI * (1837 + c * 7) * 0.005);
        expect(Math.abs(expected)).toBeGreaterThan(0.01);
        expect(channels[c]![edge]).toBeCloseTo(expected, 5);
      }
    } finally {
      renderer.dispose();
    }
  },
);
it('keeps a loop boundary finite and includes the next cycle first sample', async () => {
  const renderer = boundaryRenderer({
    id: 'loop',
    kind: 'audio',
    assetId: 'source',
    startUs: 300_000,
    durationUs: 9_920_000,
    sourceInUs: 5000,
    sourceOutUs: 4_965_000,
    loop: { offsetUs: 0 },
  });
  try {
    const channels = await renderer.audio(
      251_200,
      1600,
      new AbortController().signal,
    );
    for (let c = 0; c < 2; c++) {
      expect(channels[c]!.every(Number.isFinite)).toBe(true);
      const expected =
        0.3 * Math.sin(2 * Math.PI * 753 * 0.005) +
        0.2 * Math.sin(2 * Math.PI * (1837 + c * 7) * 0.005);
      expect(channels[c]![1280]).toBeCloseTo(expected, 5);
    }
  } finally {
    renderer.dispose();
  }
});
