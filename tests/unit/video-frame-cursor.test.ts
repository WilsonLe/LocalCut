import { expect, it, vi } from 'vitest';
import type { VideoSample } from 'mediabunny';
import { VideoFrameCursor } from '../../src/media/composition';

function source(timestamps = Array.from({ length: 31 }, (_, i) => i / 10)) {
  const starts: number[] = [];
  const samples: { frame: VideoSample; close: ReturnType<typeof vi.fn> }[] = [];
  const returned = vi.fn();
  return {
    starts,
    samples,
    returned,
    sink: {
      samples(start = 0) {
        starts.push(start);
        let first = timestamps.reduce(
          (last, timestamp, index) => (timestamp <= start ? index : last),
          -1,
        );
        if (first < 0) first = 0;
        return (async function* () {
          try {
            for (const timestamp of timestamps.slice(first)) {
              const close = vi.fn();
              const frame = { timestamp, close } as unknown as VideoSample;
              samples.push({ frame, close });
              yield frame;
            }
          } finally {
            returned();
          }
        })();
      },
    },
  };
}

it('reuses a sequential decoder and current sample for duplicate and slow timestamps', async () => {
  const media = source();
  const cursor = new VideoFrameCursor(media.sink);
  const first = await cursor.sample(0);
  expect((await cursor.sample(0.05)) === first).toBe(true);
  expect((await cursor.sample(0.05)) === first).toBe(true);
  expect(media.samples).toHaveLength(2);
  expect(media.samples[0]!.close).not.toHaveBeenCalled();

  expect((await cursor.sample(0.1))?.timestamp).toBe(0.1);
  expect(media.samples[0]!.close).toHaveBeenCalledOnce();
  expect((await cursor.sample(0.25))?.timestamp).toBe(0.2);
  expect(media.starts).toEqual([0]);
  expect(media.samples).toHaveLength(4);
  expect(
    media.samples.slice(-2).every(({ close }) => !close.mock.calls.length),
  ).toBe(true);

  cursor.dispose();
  await vi.waitFor(() => expect(media.returned).toHaveBeenCalledOnce());
  for (const { close } of media.samples) expect(close).toHaveBeenCalledOnce();
});

it('advances fast playback sequentially but restarts on backward and distant seeks', async () => {
  const media = source();
  const cursor = new VideoFrameCursor(media.sink);
  expect((await cursor.sample(0))?.timestamp).toBe(0);
  expect((await cursor.sample(0.4))?.timestamp).toBe(0.4);
  expect((await cursor.sample(0.8))?.timestamp).toBe(0.8);
  expect(media.starts).toEqual([0]);

  expect((await cursor.sample(2.2))?.timestamp).toBe(2.2);
  expect((await cursor.sample(0.7))?.timestamp).toBe(0.7);
  expect(media.starts).toEqual([0, 2.2, 0.7]);
  cursor.dispose();
  await vi.waitFor(() => expect(media.returned).toHaveBeenCalledTimes(3));
  for (const { close } of media.samples) expect(close).toHaveBeenCalledOnce();
});

it('keeps independent cursors for simultaneous clips using the same source', async () => {
  const media = source();
  const left = new VideoFrameCursor(media.sink);
  const right = new VideoFrameCursor(media.sink);
  const first = await left.sample(0.1);
  expect((await right.sample(2.4))?.timestamp).toBe(2.4);
  expect((await right.sample(2.6))?.timestamp).toBe(2.6);
  expect(
    media.samples.find(({ frame }) => frame === first)!.close,
  ).not.toHaveBeenCalled();
  expect((await left.sample(0.2))?.timestamp).toBe(0.2);
  expect(media.starts).toEqual([0.1, 2.4]);
  left.dispose();
  right.dispose();
  await vi.waitFor(() => expect(media.returned).toHaveBeenCalledTimes(2));
  for (const { close } of media.samples) expect(close).toHaveBeenCalledOnce();
});

it('returns null before the first sample and keeps the final sample at the end', async () => {
  const media = source([0.25, 0.5, 0.75]);
  const cursor = new VideoFrameCursor(media.sink);
  expect(await cursor.sample(0)).toBeNull();
  expect((await cursor.sample(0.3))?.timestamp).toBe(0.25);
  expect((await cursor.sample(0.75))?.timestamp).toBe(0.75);
  const last = await cursor.sample(0.9);
  expect((await cursor.sample(1)) === last).toBe(true);
  expect(media.starts).toEqual([0]);
  cursor.dispose();
  for (const { close } of media.samples) expect(close).toHaveBeenCalledOnce();
});

it('closes a sample that arrives after disposal and never publishes it', async () => {
  let resolve!: (value: IteratorResult<VideoSample, void>) => void;
  const next = vi.fn(
    () =>
      new Promise<IteratorResult<VideoSample, void>>((done) => {
        resolve = done;
      }),
  );
  const returned = vi.fn(async () => ({
    done: true as const,
    value: undefined,
  }));
  const cursor = new VideoFrameCursor({
    samples: () =>
      ({ next, return: returned }) as unknown as AsyncGenerator<
        VideoSample,
        void,
        unknown
      >,
  });
  const pending = cursor.sample(0);
  const rejected = expect(pending).rejects.toMatchObject({ code: 'DISPOSED' });
  await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
  cursor.dispose();
  const close = vi.fn();
  resolve({
    done: false,
    value: { timestamp: 0, close } as unknown as VideoSample,
  });
  await rejected;
  expect(returned).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  await expect(cursor.sample(1)).rejects.toMatchObject({ code: 'DISPOSED' });
});

it('closes current and pending lookahead samples exactly once on disposal', async () => {
  let resolve!: (value: IteratorResult<VideoSample, void>) => void;
  const currentClose = vi.fn();
  const lookaheadClose = vi.fn();
  const next = vi
    .fn()
    .mockResolvedValueOnce({
      done: false,
      value: { timestamp: 0, close: currentClose },
    })
    .mockImplementationOnce(
      () =>
        new Promise<IteratorResult<VideoSample, void>>((done) => {
          resolve = done;
        }),
    );
  const returned = vi.fn(async () => ({
    done: true as const,
    value: undefined,
  }));
  const cursor = new VideoFrameCursor({
    samples: () =>
      ({ next, return: returned }) as unknown as AsyncGenerator<
        VideoSample,
        void,
        unknown
      >,
  });
  const pending = cursor.sample(0);
  const rejected = expect(pending).rejects.toMatchObject({ code: 'DISPOSED' });
  await vi.waitFor(() => expect(next).toHaveBeenCalledTimes(2));
  cursor.dispose();
  resolve({
    done: false,
    value: { timestamp: 0.1, close: lookaheadClose } as unknown as VideoSample,
  });
  await rejected;
  expect(currentClose).toHaveBeenCalledOnce();
  expect(lookaheadClose).toHaveBeenCalledOnce();
  expect(returned).toHaveBeenCalledOnce();
});
