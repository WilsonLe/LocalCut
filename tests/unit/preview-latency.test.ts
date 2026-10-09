import { afterEach, expect, it, vi } from 'vitest';
import { clipSchema, newProject } from '../../src/core/model';
import { createPreviewSession } from '../../src/services/preview';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup() {
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const project = newProject('preview latency');
  project.tracks = [
    {
      id: 'overlay',
      kind: 'overlay',
      muted: false,
      clips: [
        clipSchema.parse({
          id: 'title',
          kind: 'text',
          startUs: 0,
          durationUs: 3000000,
          text: { text: 'Preview' },
        }),
      ],
    },
  ];
  const starts: { at: number; count: number; sample: number }[] = [];
  const presented: number[] = [];
  const closed: number[] = [];
  const pending = deferred<Float32Array[]>();
  const context = {
    state: 'running',
    currentTime: 0,
    createBuffer(_channels: number, count: number) {
      return {
        count,
        sample: 0,
        copyToChannel(samples: Float32Array) {
          this.sample = samples[0]!;
        },
      };
    },
    createBufferSource() {
      return {
        buffer: undefined as { count: number; sample: number } | undefined,
        connect() {},
        disconnect() {},
        stop() {},
        start(at: number) {
          starts.push({ at, ...this.buffer! });
        },
      };
    },
  };
  const audio = vi.fn(async (_project, start: number, count: number) => {
    if (audio.mock.calls.length === 4) return pending.promise;
    return [
      new Float32Array(count).fill(start),
      new Float32Array(count).fill(start),
    ];
  });
  const session = createPreviewSession(
    async () => project,
    {
      width: 100,
      height: 100,
      getContext: () => ({
        drawImage(image: { timeUs: number }) {
          presented.push(image.timeUs);
        },
      }),
    } as unknown as HTMLCanvasElement,
    context as unknown as AudioContext,
    async (_project, timeUs) => ({
      timeUs,
      revision: 0,
      image: {
        timeUs,
        close() {
          closed.push(timeUs);
        },
      } as unknown as ImageBitmap,
    }),
    audio,
  );
  return {
    session,
    context,
    starts,
    presented,
    closed,
    pending,
    audio,
    animate() {
      expect(callbacks.length).toBeGreaterThan(0);
      callbacks.shift()!(0);
    },
    releaseAudio() {
      const [, start, count] = audio.mock.calls[3]!;
      pending.resolve([
        new Float32Array(count).fill(start),
        new Float32Array(count).fill(start),
      ]);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

it('holds at an underrun and resumes consecutive audio with a current video frame', async () => {
  const h = setup();
  await h.session.play();
  expect(h.starts.map((source) => source.at)).toEqual([0.05, 0.3]);
  h.context.currentTime = 0.46;
  h.animate();
  await vi.waitFor(() => expect(h.audio).toHaveBeenCalledTimes(4));

  h.context.currentTime = 1.46;
  expect(h.session.currentTimeUs).toBe(500000);
  h.releaseAudio();
  await vi.waitFor(() => expect(h.presented).toHaveLength(3));

  expect(h.starts.map((source) => source.sample)).toEqual([
    0, 12000, 24000, 36000,
  ]);
  for (let i = 1; i < h.starts.length; i++) {
    const before = h.starts[i - 1]!,
      after = h.starts[i]!;
    expect(after.at).toBeGreaterThanOrEqual(before.at + before.count / 48000);
  }
  expect(h.starts[2]!.at).toBeCloseTo(1.51);
  expect(h.starts[3]!.at).toBeCloseTo(1.76);
  expect(h.presented.at(-1)).toBe(500000);
  expect(h.session.currentTimeUs).toBe(500000);
  h.context.currentTime = 1.64;
  expect(h.session.currentTimeUs).toBe(630000);
  h.session.dispose();
  expect(h.closed).toEqual(h.presented);
});

it.each(['pause', 'dispose'] as const)(
  '%s prevents a delayed audio result from restarting playback',
  async (action) => {
    const h = setup();
    await h.session.play();
    h.context.currentTime = 0.46;
    h.animate();
    await vi.waitFor(() => expect(h.audio).toHaveBeenCalledTimes(4));
    h.context.currentTime = 1.46;
    h.session[action]();
    h.releaseAudio();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.starts).toHaveLength(2);
    expect(h.presented).toHaveLength(2);
    expect(h.session.currentTimeUs).toBe(500000);
    h.session.dispose();
  },
);

it('a seek supersedes delayed audio without publishing its old frame or samples', async () => {
  const h = setup();
  await h.session.play();
  h.context.currentTime = 0.46;
  h.animate();
  await vi.waitFor(() => expect(h.audio).toHaveBeenCalledTimes(4));
  h.context.currentTime = 1.46;
  await h.session.seek(100000);
  const starts = [...h.starts],
    presented = [...h.presented];
  h.releaseAudio();
  await Promise.resolve();
  await Promise.resolve();
  expect(h.starts).toEqual(starts);
  expect(h.presented).toEqual(presented);
  expect(h.presented.at(-1)).toBe(100000);
  expect(h.session.currentTimeUs).toBe(100000);
  expect(h.starts[2]!.sample).toBe(4800);
  h.session.dispose();
});

it('keeps a seek position fixed during the initial audio scheduling lead', async () => {
  const h = setup();
  await h.session.seek(500000);
  await h.session.play();
  expect(h.session.currentTimeUs).toBe(500000);
  h.context.currentTime = 0.025;
  expect(h.session.currentTimeUs).toBe(500000);
  h.context.currentTime = 0.075;
  expect(h.session.currentTimeUs).toBe(525000);
  h.session.dispose();
});
