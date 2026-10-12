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
