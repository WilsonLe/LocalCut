import { describe, expect, it, vi } from 'vitest';
import {
  createToolConnection,
  connectionLabel,
} from '../../src/workspace/webmcp/connection';
import type { ModelContext, SiteTool } from '../../src/workspace/webmcp/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const registered = new Map<string, SiteTool>();
  const context: ModelContext = {
    async registerTool(tool, options) {
      if (options.signal.aborted) throw options.signal.reason;
      if (registered.has(tool.name)) throw new Error('Duplicate name');
      registered.set(tool.name, tool);
      options.signal.addEventListener(
        'abort',
        () => registered.delete(tool.name),
        { once: true },
      );
    },
  };
  const tool: SiteTool = {
    name: 'localcut_example',
    description: 'Example',
    inputSchema: {},
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: vi.fn(async () => 'result'),
  };
  return { registered, context, tool };
}

describe('browser tool registration connection', () => {
  it('stays inert when unsupported and recovers after late API injection without reloading', async () => {
    const f = fixture();
    const connection = createToolConnection();
    const context: { current?: ModelContext } = {};
    const load = vi.fn(async () => ({ tools: [f.tool] }));
    const registration = connection.register(
      'workspace',
      () => context.current,
      load,
      vi.fn(),
    );
    await registration.ready;
    expect(connectionLabel(connection.getSnapshot())).toBe(
      'Browser access unavailable',
    );
    expect(load).not.toHaveBeenCalled();
    context.current = f.context;
    await connection.refresh();
    expect(connectionLabel(connection.getSnapshot())).toBe('Tools ready');
    expect(connection.getSnapshot().scopes.workspace?.count).toBe(1);
    expect(connection.getSnapshot().lastRequest).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    await registration.dispose();
    expect(f.registered.size).toBe(0);
  });

  it('refreshes both scopes without duplicates and preserves their tool sets/results', async () => {
    const f = fixture();
    const connection = createToolConnection();
    const dispose = vi.fn();
    const load = vi.fn(async () => ({ tools: [f.tool], dispose }));
    const app = connection.register(
      'workspace',
      () => f.context,
      load,
      vi.fn(),
    );
    const project = connection.register(
      'project',
      () => f.context,
      async () => ({ tools: [{ ...f.tool, name: 'localcut_project' }] }),
      vi.fn(),
    );
    await Promise.all([app.ready, project.ready]);
    f.registered.set('another_feature', { ...f.tool, name: 'another_feature' });
    const retired = f.registered.get(f.tool.name)!;
    await connection.refresh();
    await connection.refresh();
    expect([...f.registered.keys()].sort()).toEqual([
      'another_feature',
      'localcut_example',
      'localcut_project',
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
    expect(
      await retired.execute({}, { signal: new AbortController().signal }),
    ).toMatchObject({ error: { code: 'DISPOSED' } });
    expect(
      await f.registered
        .get(f.tool.name)!
        .execute({}, { signal: new AbortController().signal }),
    ).toBe('result');
    await app.dispose();
    expect(f.registered.has('localcut_project')).toBe(true);
    await project.dispose();
    expect([...f.registered.keys()]).toEqual(['another_feature']);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps accepted requests and the service lifetime alive through a refresh', async () => {
    const f = fixture();
    const connection = createToolConnection();
    const pending = deferred<string>();
    let lifetime!: AbortSignal;
    const registration = connection.register(
      'project',
      () => f.context,
      async (signal) => {
        lifetime = signal;
        return { tools: [{ ...f.tool, execute: () => pending.promise }] };
      },
      vi.fn(),
    );
    await registration.ready;
    const result = f.registered
      .get(f.tool.name)!
      .execute({}, { signal: new AbortController().signal });
    await connection.refresh();
    expect(lifetime.aborted).toBe(false);
    pending.resolve('committed result');
    expect(await result).toBe('committed result');
    await registration.dispose();
    expect(lifetime.aborted).toBe(true);
  });

  it('cleans partial registrations, reports failure and retries the same service owner', async () => {
    const f = fixture();
    const connection = createToolConnection();
    const error = new Error('Browser denied tools');
    const report = vi.fn();
    let fail = true;
    const context: ModelContext = {
      async registerTool(tool, options) {
        if (fail && tool.name === 'second') throw error;
        await f.context.registerTool(tool, options);
      },
    };
    const load = vi.fn(async () => ({
      tools: [f.tool, { ...f.tool, name: 'second' }],
    }));
    const registration = connection.register(
      'workspace',
      () => context,
      load,
      report,
    );
    await registration.ready;
    expect(connectionLabel(connection.getSnapshot())).toBe(
      'Registration failed',
    );
    expect(f.registered.size).toBe(0);
    expect(report).toHaveBeenCalledWith(error);
    fail = false;
    await connection.refresh();
    expect(connectionLabel(connection.getSnapshot())).toBe('Tools ready');
    expect(f.registered.size).toBe(2);
    expect(load).toHaveBeenCalledTimes(1);
    await registration.dispose();
  });

  it('retries a failed lazy loader and detects API removal/replacement', async () => {
    const f = fixture();
    const connection = createToolConnection();
    let context: ModelContext | undefined = f.context;
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('Chunk missing'))
      .mockResolvedValue({ tools: [f.tool] });
    const registration = connection.register(
      'workspace',
      () => context,
      load,
      vi.fn(),
    );
    await registration.ready;
    await connection.refresh();
    expect(load).toHaveBeenCalledTimes(2);
    context = undefined;
    await connection.refresh();
    expect(f.registered.size).toBe(0);
    expect(connectionLabel(connection.getSnapshot())).toBe(
      'Browser access unavailable',
    );
    const replacement = fixture();
    context = replacement.context;
    await connection.refresh();
    expect(replacement.registered.size).toBe(1);
    expect(f.registered.size).toBe(0);
    await registration.dispose();
    expect(replacement.registered.size).toBe(0);
  });

  it('ignores superseded setup and never publishes after disposal', async () => {
    const f = fixture();
    const connection = createToolConnection();
    const gate = deferred<void>();
    const started = deferred<void>();
    const context: ModelContext = {
      async registerTool(tool, options) {
        started.resolve();
        await gate.promise;
        if (!options.signal.aborted)
          await f.context.registerTool(tool, options);
      },
    };
    const registration = connection.register(
      'workspace',
      () => context,
      async () => ({ tools: [f.tool] }),
      vi.fn(),
    );
    await started.promise;
    const refresh = connection.refresh();
    const disposed = registration.dispose();
    gate.resolve();
    await Promise.all([refresh, disposed]);
    expect(connection.getSnapshot().scopes).toEqual({});
    expect(f.registered.size).toBe(0);
  });

  it('observes request time without retaining input or implying an active agent connection', async () => {
    const f = fixture();
    const connection = createToolConnection(() => 1234);
    const registration = connection.register(
      'workspace',
      () => f.context,
      async () => ({ tools: [f.tool] }),
      vi.fn(),
    );
    await registration.ready;
    await f.registered
      .get(f.tool.name)!
      .execute(
        { privateTranscript: 'not retained' },
        { signal: new AbortController().signal },
      );
    expect(connection.getSnapshot().lastRequest).toBe(1234);
    expect(JSON.stringify(connection.getSnapshot())).not.toContain(
      'privateTranscript',
    );
    expect(JSON.stringify(connection.getSnapshot())).not.toContain(
      'not retained',
    );
    expect(connectionLabel(connection.getSnapshot())).toBe('Tools ready');
    await connection.refresh();
    expect(connection.getSnapshot().lastRequest).toBe(1234);
    await registration.dispose();
  });

  it('disposes services even while browser registration is still pending', async () => {
    const f = fixture();
    const connection = createToolConnection();
    const gate = deferred<void>();
    const started = deferred<void>();
    const dispose = vi.fn();
    const registration = connection.register(
      'project',
      () => ({
        async registerTool() {
          started.resolve();
          await gate.promise;
        },
      }),
      async () => ({ tools: [f.tool], dispose }),
      vi.fn(),
    );
    await started.promise;
    const ending = registration.dispose();
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    gate.resolve();
    await ending;
    expect(connection.getSnapshot().scopes).toEqual({});
  });

  it('does not let a retired owner clear its replacement or receive new refreshes', async () => {
    const first = fixture();
    const second = fixture();
    const connection = createToolConnection();
    const old = connection.register(
      'project',
      () => first.context,
      async () => ({ tools: [first.tool] }),
      vi.fn(),
    );
    await old.ready;
    const next = connection.register(
      'project',
      () => second.context,
      async () => ({ tools: [second.tool] }),
      vi.fn(),
    );
    await next.ready;
    await old.dispose();
    expect(connectionLabel(connection.getSnapshot())).toBe('Tools ready');
    expect(second.registered.size).toBe(1);
    await connection.refresh();
    expect(first.registered.size).toBe(0);
    expect(second.registered.size).toBe(1);
    await next.dispose();
    expect(connection.getSnapshot().scopes).toEqual({});
  });
});
