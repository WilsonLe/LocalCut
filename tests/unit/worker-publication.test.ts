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
}));

vi.mock('../../src/storage/store', () => ({
  Store: { open: mocks.open },
}));
vi.mock('../../src/media/assets', () => ({
  importAsset: vi.fn(),
  thumbnails: vi.fn(),
  waveform: vi.fn(),
  convertCache: vi.fn(),
  pcmWindow: vi.fn(),
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
    });
    // Keep the worker in its separately checked WebWorker scope rather than
    // merging its globals into the DOM-typed test compilation.
    const workerModule = '../../src/workers/media.worker';
    await import(workerModule);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
