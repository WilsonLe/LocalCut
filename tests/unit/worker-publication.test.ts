import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newProject } from '../../src/core/model';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  remove: vi.fn(),
  close: vi.fn(),
  exportProject: vi.fn(),
  preflight: vi.fn(),
  frame: vi.fn(),
  dispose: vi.fn(),
  convertCache: vi.fn(),
  pcmWindow: vi.fn(),
  lock: vi.fn(),
  getAsset: vi.fn(),
}));

vi.mock('../../src/storage/store', () => ({
  Store: { open: mocks.open },
}));
vi.mock('../../src/media/assets', () => ({
  importAsset: vi.fn(),
  thumbnails: vi.fn(),
  contactSheet: vi.fn(),
  waveform: vi.fn(),
  convertCache: mocks.convertCache,
  pcmWindow: mocks.pcmWindow,
}));
vi.mock('../../src/media/export', () => ({
  exportProject: mocks.exportProject,
  preflight: mocks.preflight,
}));
vi.mock('../../src/media/composition', () => ({
  Renderer: class {
    canvas: { width: number; height: number };
    frame = mocks.frame;
    dispose = mocks.dispose;
    constructor(
      readonly store: { namespace: string; close(): void },
      readonly project: { width: number; height: number },
      width?: number,
      height?: number,
    ) {
      this.canvas = {
        width: width ?? project.width,
        height: height ?? project.height,
      };
    }
  },
}));

interface Request {
  id: string;
  operation: string;
  payload?: unknown;
}
interface Reply {
  id: string;
  kind: 'progress' | 'result' | 'error';
  data?: unknown;
  error?: { code: string };
}

describe('media worker cancellation before result publication', () => {
  let receive: ((event: { data: Request }) => void) | undefined;
  let replies: Reply[];
  let order: string[];
  const dispatch = (data: Request) => receive!({ data });

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    replies = [];
    order = [];
    const worker = {
      get onmessage() {
        return receive;
      },
      set onmessage(handler: typeof receive) {
        receive = handler;
      },
      postMessage(reply: Reply) {
        order.push('publish:' + reply.kind);
        replies.push(reply);
      },
    };
    vi.stubGlobal('self', worker);
    vi.stubGlobal(
      'ImageBitmap',
      class {
        close() {
          order.push('bitmap:close');
        }
      },
    );
    mocks.remove.mockImplementation(async () => {
      order.push('file:remove');
    });
    mocks.close.mockImplementation(() => {
      order.push('store:close');
    });
    mocks.dispose.mockImplementation(() => {
      order.push('renderer:dispose');
    });
    mocks.open.mockResolvedValue({
      namespace: 'worker-publication',
      remove: mocks.remove,
      close: mocks.close,
      lock: mocks.lock,
      getAsset: mocks.getAsset,
    });
    // Keep the worker in its separately checked WebWorker scope rather than
    // merging its globals into the DOM-typed test compilation.
    const workerModule = '../../src/workers/media.worker';
    await import(workerModule);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([false, true])(
    'pins transcription PCM through its final read and releases on cancellation=%s',
    async (cancelled) => {
      const id = 'speech-reader';
      let releaseRead!: () => void, enteredRead!: () => void;
      const reading = new Promise<void>((resolve) => {
        enteredRead = resolve;
      });
      const barrier = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      let held = false;
      let releaseSource!: () => void;
      const sourceReleased = new Promise<void>((resolve) => {
        releaseSource = resolve;
      });
      mocks.lock.mockImplementation(
        async (
          key: string,
          mode: string,
          work: () => Promise<unknown>,
          signal: AbortSignal,
        ) => {
          expect(key).toBe('asset:source');
          expect(mode).toBe('shared');
          expect(signal.aborted).toBe(false);
          held = true;
          try {
            return await work();
          } finally {
            held = false;
            order.push('source:release');
            releaseSource();
          }
        },
      );
      mocks.convertCache.mockImplementation(async () => {
        expect(held).toBe(true);
        return new File(['pcm'], 'pcm');
      });
      mocks.getAsset.mockResolvedValue({ durationUs: 2000000 });
      mocks.pcmWindow.mockImplementation(
        async (_file: File, _start: number, count: number) => {
          expect(held).toBe(true);
          if (mocks.pcmWindow.mock.calls.length === 1) {
            enteredRead();
            await barrier;
          }
          expect(held).toBe(true);
          return [new Float32Array(count), new Float32Array(count)];
        },
      );
      dispatch({
        id,
        operation: 'speechAudio',
        payload: {
          namespace: 'worker-publication',
          assetId: 'source',
          jobId: id,
          count: 32000,
          startFrame: 0,
        },
      });
      await reading;
      // Relink's exclusive source lock cannot be granted before the reader releases.
      let relinked = false;
      const relink = sourceReleased.then(() => {
        expect(held).toBe(false);
        relinked = true;
      });
      expect(relinked).toBe(false);
      if (cancelled) dispatch({ id, operation: 'cancel' });
      releaseRead();
      await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
      await relink;
      expect(mocks.lock).toHaveBeenCalledOnce();
      expect(relinked).toBe(true);
      expect(mocks.pcmWindow).toHaveBeenCalledTimes(cancelled ? 1 : 2);
      expect(order.indexOf('source:release')).toBeLessThan(
        order.indexOf('publish:' + (cancelled ? 'error' : 'result')),
      );
      expect(replies.at(-1)?.kind).toBe(cancelled ? 'error' : 'result');
      if (cancelled) expect(replies.at(-1)?.error?.code).toBe('CANCELLED');
      else expect((replies.at(-1)?.data as Float32Array).length).toBe(32000);
    },
  );

  it('removes a finalized export when cancellation wins before publication', async () => {
    const id = 'cancel-export';
    const artifact = {
      path: 'export-cancel-export.mp4',
      file: new File(['finalized output'], 'video.mp4', { type: 'video/mp4' }),
    };
    mocks.exportProject.mockImplementation(async () => {
      // Encoding has finalized, but the awaited result has not been returned
      // to the worker handler and cannot yet have been published to its caller.
      dispatch({ id, operation: 'cancel' });
      return artifact;
    });
    dispatch({
      id,
      operation: 'export',
      payload: {
        namespace: 'worker-publication',
        project: newProject('worker export'),
        options: { format: 'mp4' },
        jobId: id,
      },
    });
    await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(artifact.path);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      id,
      kind: 'error',
      error: { code: 'CANCELLED' },
    });
    expect(order).toEqual(['file:remove', 'publish:error', 'store:close']);
  });

  it('closes a completed frame bitmap when cancellation wins before publication', async () => {
    const id = 'cancel-frame';
    const bitmap = new ImageBitmap();
    mocks.frame.mockResolvedValue({
      transferToImageBitmap() {
        dispatch({ id, operation: 'cancel' });
        return bitmap;
      },
    });
    dispatch({
      id,
      operation: 'frame',
      payload: {
        namespace: 'worker-publication',
        project: newProject('worker frame'),
        timeUs: 0,
        jobId: id,
      },
    });
    await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      id,
      kind: 'error',
      error: { code: 'CANCELLED' },
    });
    expect(order).toEqual([
      'bitmap:close',
      'renderer:dispose',
      'store:close',
      'publish:error',
    ]);
  });

  it('publishes and retains a finalized export when it was not cancelled', async () => {
    const id = 'completed-export';
    const artifact = {
      path: 'export-completed.mp4',
      file: new File(['complete'], 'video.mp4', { type: 'video/mp4' }),
    };
    mocks.exportProject.mockResolvedValue(artifact);
    dispatch({
      id,
      operation: 'export',
      payload: {
        namespace: 'worker-publication',
        project: newProject('completed worker export'),
        options: { format: 'mp4' },
        jobId: id,
      },
    });
    await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(replies).toEqual([{ id, kind: 'result', data: artifact }]);
    expect(order).toEqual(['publish:result', 'store:close']);
  });
});
