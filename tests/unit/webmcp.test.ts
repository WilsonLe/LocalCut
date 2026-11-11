import { describe, expect, it, vi } from 'vitest';
import { newProject } from '../../src/core/model';
import { batchSchema } from '../../src/core/commands';
import { inputSchema, editSchema } from '../../src/workspace/webmcp/contracts';
import { registerProjectTools } from '../../src/workspace/webmcp/register';
import { projectTools } from '../../src/workspace/webmcp/tools';
import { SiteToolJobs } from '../../src/workspace/webmcp/jobs';
import { Jobs } from '../../src/services/jobs';
import type { Editor } from '../../src/editor';
import type {
  ModelContext,
  ProjectView,
  SiteToolHost,
} from '../../src/workspace/webmcp/types';

function fixture() {
  let current: ProjectView | null = {
    project: newProject('WebMCP'),
    version: null,
    selectedClipIds: [],
    playheadUs: 0,
    busy: false,
  };
  const apply = vi.fn(async (batch) => ({
    requestId: batch.requestId,
    appliedRevision: 1,
  }));
  const host: SiteToolHost = {
    editor: { commands: { apply, validate: vi.fn() } } as unknown as Editor,
    projectId: current.project.id,
    getView: () => current,
    seek: vi.fn(),
    select: vi.fn(),
    playback: vi.fn(),
    onError: vi.fn(),
    refresh: vi.fn(async () => {}),
  };
  const lifetime = new AbortController();
  const bridge = projectTools(host, lifetime.signal);
  const invoke = (
    name: string,
    input: unknown,
    signal = new AbortController().signal,
  ) =>
    bridge.tools
      .find((tool) => tool.name === `localcut_${name}`)!
      .execute(input, { signal });
  return {
    host,
    bridge,
    invoke,
    apply,
    lifetime,
    current,
    setView: (value: ProjectView | null) => {
      current = value;
    },
  };
}

describe('project site tools', () => {
  it('discovers the complete canonical operation and property schema without a vendor runtime', () => {
    expect(inputSchema(editSchema)).toEqual(inputSchema(batchSchema));
    const f = fixture();
    const tool = f.bridge.tools.find(
      (tool) => tool.name === 'localcut_apply_edits',
    )!;
    expect(tool.inputSchema).toEqual(inputSchema(batchSchema));
    expect(tool.annotations.readOnlyHint).toBe(false);
    expect(
      f.bridge.tools.every((item) => item.annotations.untrustedContentHint),
    ).toBe(true);
  });
  it('validates but preserves omitted defaults in the submitted receipt envelope', async () => {
    const f = fixture();
    const input = {
      projectId: f.host.projectId,
      expectedRevision: 0,
      requestId: 'same',
      operations: [{ type: 'addTrack', track: { id: 'v', kind: 'video' } }],
    };
    await f.invoke('apply_edits', input);
    expect(f.apply).toHaveBeenCalledWith(input);
    expect(f.apply.mock.calls[0]![0].operations[0].track).not.toHaveProperty(
      'clips',
    );
    await f.bridge.dispose();
  });
  it('rejects wrong projects, malformed arguments, historical views, busy work and retired handlers before mutation', async () => {
    const f = fixture();
    const input = {
      projectId: f.host.projectId,
      expectedRevision: 0,
      requestId: 'edit',
      operations: [{ type: 'renameProject', name: 'Changed' }],
    };
    expect(
      await f.invoke('apply_edits', { ...input, projectId: 'other' }),
    ).toMatchObject({ isError: true });
    expect(
      await f.invoke('apply_edits', {
        ...input,
        operations: [{ type: 'arbitrary_eval' }],
      }),
    ).toMatchObject({ isError: true });
    f.setView({ ...f.current!, busy: true });
    expect(await f.invoke('apply_edits', input)).toMatchObject({
      isError: true,
    });
    f.setView({
      ...f.current!,
      version: {
        id: 'saved',
        project: f.current!.project,
      } as ProjectView['version'],
    });
    expect(await f.invoke('apply_edits', input)).toMatchObject({
      isError: true,
    });
    f.setView(null);
    expect(await f.invoke('apply_edits', input)).toMatchObject({
      isError: true,
    });
    f.setView(f.current);
    f.lifetime.abort();
    expect(await f.invoke('apply_edits', input)).toMatchObject({
      isError: true,
    });
    expect(f.apply).not.toHaveBeenCalled();
    await f.bridge.dispose();
  });
  it('honors pre-aborted calls and preserves engine conflict details for recovery', async () => {
    const f = fixture();
    const aborted = AbortSignal.abort();
    await f.invoke('apply_edits', {}, aborted);
    expect(f.apply).not.toHaveBeenCalled();
    const { EditorError } = await import('../../src/core/errors');
    f.apply.mockRejectedValueOnce(
      new EditorError('REVISION_CONFLICT', 'Stale project revision'),
    );
    expect(
      await f.invoke('apply_edits', {
        projectId: f.host.projectId,
        expectedRevision: 0,
        requestId: 'stale',
        operations: [{ type: 'renameProject', name: 'x' }],
      }),
    ).toMatchObject({ isError: true, error: { code: 'REVISION_CONFLICT' } });
    await f.bridge.dispose();
  });
  it('blocks unrelated assets and cancellation during asynchronous scope validation', async () => {
    const f = fixture();
    let finish!: (value: { entries: { assetId: string }[] }) => void;
    const listed = new Promise<{ entries: { assetId: string }[] }>(
      (resolve) => {
        finish = resolve;
      },
    );
    f.host.editor.library = {
      forProject: () => ({ list: () => listed }),
    } as unknown as Editor['library'];
    const batch = {
      projectId: f.host.projectId,
      expectedRevision: 0,
      requestId: 'image',
      operations: [
        {
          type: 'addTrack',
          track: {
            id: 'v',
            kind: 'video',
            clips: [
              {
                id: 'image',
                kind: 'image',
                assetId: 'mine',
                startUs: 0,
                durationUs: 1000,
              },
            ],
          },
        },
      ],
    };
    const controller = new AbortController();
    const cancelled = f.invoke('apply_edits', batch, controller.signal);
    controller.abort();
    finish({ entries: [{ assetId: 'mine' }] });
    expect(await cancelled).toMatchObject({
      isError: true,
      error: { code: 'CANCELLED' },
    });
    expect(f.apply).not.toHaveBeenCalled();
    const foreign = structuredClone(batch);
    foreign.operations[0]!.track.clips[0]!.assetId = 'foreign';
    expect(await f.invoke('apply_edits', foreign)).toMatchObject({
      isError: true,
      error: { code: 'NOT_FOUND' },
    });
    expect(f.apply).not.toHaveBeenCalled();
    await f.invoke('apply_edits', batch);
    expect(f.apply).toHaveBeenCalledOnce();
    await f.bridge.dispose();
  });
  it('unregisters only its own tools using the standard registration signal', async () => {
    const f = fixture();
    const registrations = new Map<string, AbortSignal>();
    const context: ModelContext = {
      registerTool: vi.fn(async (tool, options) => {
        registrations.set(tool.name, options.signal);
      }),
    };
    const session = registerProjectTools(context, f.host);
    await session.ready;
    expect(registrations.size).toBe(f.bridge.tools.length);
    expect([...registrations.values()].every((signal) => !signal.aborted)).toBe(
      true,
    );
    await session.dispose();
    expect([...registrations.values()].every((signal) => signal.aborted)).toBe(
      true,
    );
    await f.bridge.dispose();
  });
  it('rolls back partial registration and reports a denied browser policy once', async () => {
    const f = fixture();
    let signal: AbortSignal | undefined;
    let count = 0;
    const session = registerProjectTools(
      {
        registerTool: async (_tool, options) => {
          signal = options.signal;
          if (++count === 2)
            throw new DOMException('Policy denied', 'NotAllowedError');
        },
      },
      f.host,
    );
    await session.ready;
    expect(signal?.aborted).toBe(true);
    expect(f.host.onError).toHaveBeenCalledOnce();
    await session.dispose();
    await f.bridge.dispose();
  });
});

describe('site job ownership', () => {
  it('preserves coded errors from the engine task queue boundary', async () => {
    const bridge = new SiteToolJobs();
    const job = {
      id: 'rejected',
      completion: Promise.reject(
        Object.assign(new Error('Prepare the model'), {
          code: 'MODEL_REQUIRED',
        }),
      ),
      cancel: vi.fn(),
      subscribe: () => () => {},
    };
    bridge.track(job);
    expect(
      await bridge.act(job.id, 'wait', new AbortController().signal),
    ).toMatchObject({ state: 'failed', error: { code: 'MODEL_REQUIRED' } });
    await bridge.dispose();
  });
  it('keeps results running until encoded and revokes retained file URLs on release', async () => {
    const jobs = new Jobs();
    const bridge = new SiteToolJobs();
    let finish!: () => void;
    const barrier = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const cleanup = vi.fn(async () => {});
    const job = jobs.start(async () => new Blob(['local']));
    bridge.track(
      job,
      async (blob, file) => {
        await barrier;
        return file(blob, 'out.txt');
      },
      cleanup,
    );
    await job.completion;
    expect(
      await bridge.act(job.id, 'status', AbortSignal.abort()),
    ).toMatchObject({ state: 'running' });
    finish();
    const result = await bridge.act(
      job.id,
      'wait',
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      state: 'completed',
      result: { size: 5, name: 'out.txt' },
    });
    await bridge.act(job.id, 'release', new AbortController().signal);
    expect(revoke).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    await bridge.dispose();
    await jobs.dispose();
    revoke.mockRestore();
  });
  it('cancels active work on view retirement and disposes a late delivered artifact', async () => {
    const jobs = new Jobs();
    const bridge = new SiteToolJobs();
    let finish!: () => void;
    const barrier = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const cleanup = vi.fn(async () => {});
    const job = jobs.start(
      async () => {
        await barrier;
        return 'committed';
      },
      { acceptCommittedResult: true },
    );
    bridge.track(job, async (value) => value, cleanup);
    const disposed = bridge.dispose();
    finish();
    await disposed;
    expect(cleanup).toHaveBeenCalledOnce();
    await expect(
      bridge.act(job.id, 'status', new AbortController().signal),
    ).rejects.toThrow('Unknown job');
    await jobs.dispose();
  });
});
