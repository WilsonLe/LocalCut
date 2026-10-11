import { afterEach, expect, it, vi } from 'vitest';
import type { Editor } from '../../src/editor';
import { clipSchema } from '../../src/core/model';
import {
  TimelinePreviews,
  timelineWaveformPath,
} from '../../src/workspace/timeline-previews';

afterEach(() => vi.restoreAllMocks());

function setup() {
  const jobs: {
    resolve: (value: { timeUs: number; blob: Blob }[] | Float32Array) => void;
    cancel: ReturnType<typeof vi.fn>;
  }[] = [];
  const start = vi.fn(() => {
    let resolve!: (typeof jobs)[number]['resolve'];
    const completion = new Promise<
      { timeUs: number; blob: Blob }[] | Float32Array
    >((done) => {
      resolve = done;
    });
    const cancel = vi.fn();
    jobs.push({ resolve, cancel });
    return { completion, cancel };
  });
  const editor = {
    assets: { thumbnails: start, waveform: start },
  } as unknown as Editor;
  return { previews: new TimelinePreviews(editor), jobs, start };
}
const asset = {
  id: 'asset',
  status: 'ready' as const,
  size: 50,
  width: 128,
  height: 72,
};

it('shares audio analysis until its final visible clip releases it', async () => {
  const { previews, start, jobs } = setup();
  const first = previews.acquire(asset, true, 0);
  const second = previews.acquire(asset, true, 1000000);
  expect(start).toHaveBeenCalledTimes(1);
  first.release();
  expect(jobs[0]!.cancel).not.toHaveBeenCalled();
  jobs[0]!.resolve(new Float32Array([0, 0.75]));
  await expect(second.completion).resolves.toEqual({
    peaks: new Float32Array([0, 0.75]),
  });
  second.release();
  expect(jobs[0]!.cancel).toHaveBeenCalledTimes(1);
  previews.dispose();
});

it('bounds native work, skips retired queued clips and never publishes cancelled thumbnails', async () => {
  const { previews, start, jobs } = setup();
  const create = vi
    .spyOn(URL, 'createObjectURL')
    .mockReturnValue('blob:preview');
  const first = previews.acquire(asset, false, 0);
  const second = previews.acquire(asset, false, 1000000);
  const queued = previews.acquire(asset, false, 2000000);
  expect(start).toHaveBeenCalledTimes(2);
  expect(start).toHaveBeenNthCalledWith(2, asset.id, [1000000], 160);
  queued.release();
  await expect(queued.completion).rejects.toThrow('cancelled');
  first.release();
  await expect(first.completion).rejects.toThrow('cancelled');
  jobs[0]!.resolve([{ timeUs: 0, blob: new Blob() }]);
  jobs[1]!.resolve([{ timeUs: 1000000, blob: new Blob() }]);
  await second.completion;
  expect(create).toHaveBeenCalledTimes(1);
  expect(start).toHaveBeenCalledTimes(2);
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  previews.dispose();
  expect(revoke).toHaveBeenCalledWith('blob:preview');
});

it('maps silence and peaks through trimming, speed and a speed ramp', () => {
  const peaks = new Float32Array(1000);
  peaks.fill(1, 500);
  const clip = clipSchema.parse({
    id: 'audio',
    kind: 'audio',
    assetId: asset.id,
    startUs: 3000000,
    durationUs: 2000000,
    sourceOutUs: 2000000,
  });
  const heights = (c: typeof clip) =>
    [...timelineWaveformPath(c, 2000000, peaks).matchAll(/v([\d.]+)/g)].map(
      (m) => Number(m[1]),
    );
  expect(heights(clip).slice(0, 60)).toEqual(Array(60).fill(1));
  expect(heights(clip).slice(65)).toEqual(Array(63).fill(30));
  expect(
    heights({ ...clip, sourceInUs: 1000000, durationUs: 500000, speed: 2 }),
  ).toEqual(Array(128).fill(30));
  const ramp = heights({
    ...clip,
    speedRamp: [
      { position: 0, speed: 1, interpolation: 'linear' },
      { position: 1, speed: 3, interpolation: 'linear' },
    ],
  });
  expect(ramp[64]).toBe(1);
  expect(ramp[90]).toBe(30);
});

it('repeats waveforms across loop boundaries rather than stretching the source', () => {
  const clip = clipSchema.parse({
    id: 'loop',
    kind: 'audio',
    assetId: 'a',
    startUs: 0,
    durationUs: 4000000,
    sourceOutUs: 2000000,
    loop: { offsetUs: 0 },
  });
  const peaks = Float32Array.from({ length: 128 }, (_, i) => (i < 64 ? 0 : 1));
  const heights = [
    ...timelineWaveformPath(clip, 2000000, peaks).matchAll(/v([\d.]+)/g),
  ].map((m) => Number(m[1]));
  expect(heights.slice(0, 30)).toEqual(Array(30).fill(1));
  expect(heights.slice(34, 62)).toEqual(Array(28).fill(30));
  expect(heights.slice(66, 94)).toEqual(Array(28).fill(1));
  expect(heights.slice(98, 126)).toEqual(Array(28).fill(30));
});
