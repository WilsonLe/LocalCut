import type { ModelContext, SiteTool } from './types';

type Scope = 'workspace' | 'project';
type Phase = 'registering' | 'unavailable' | 'ready' | 'error';
interface ScopeState {
  phase: Phase;
  count: number;
  error?: string;
}
export interface ConnectionState {
  scopes: Partial<Record<Scope, ScopeState>>;
  lastRequest: number | null;
}
interface ToolSet {
  tools: SiteTool[];
  dispose?(): void | Promise<void>;
}

/** Ephemeral registration/activity metadata; no project content or agent identity. */
export function createToolConnection(clock = Date.now) {
  let state: ConnectionState = { scopes: {}, lastRequest: null };
  const listeners = new Set<() => void>();
  const owners = new Map<Scope, object>();
  const refreshers = new Map<Scope, () => Promise<void>>();
  const publish = (next: ConnectionState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const update = (scope: Scope, owner: object, value: ScopeState) => {
    if (owners.get(scope) !== owner) return;
    publish({ ...state, scopes: { ...state.scopes, [scope]: value } });
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async refresh() {
      await Promise.allSettled(
        [...refreshers.values()].map((refresh) => refresh()),
      );
    },
    register(
      scope: Scope,
      getContext: () => ModelContext | undefined,
      load: (signal: AbortSignal) => Promise<ToolSet>,
      onError: (error: unknown) => void,
    ) {
      const owner = {};
      const lifetime = new AbortController();
      let binding: AbortController | undefined;
      let loaded: Promise<ToolSet> | undefined;
      let queue: Promise<void> = Promise.resolve();
      owners.set(scope, owner);
      const refresh = () => {
        binding?.abort();
        const current = new AbortController();
        binding = current;
        const active = () =>
          !lifetime.signal.aborted &&
          !current.signal.aborted &&
          owners.get(scope) === owner;
        update(scope, owner, { phase: 'registering', count: 0 });
        queue = queue.then(async () => {
          if (!active()) return;
          try {
            const context = getContext();
            if (!context?.registerTool) {
              update(scope, owner, { phase: 'unavailable', count: 0 });
              return;
            }
            loaded ??= load(lifetime.signal).catch((error: unknown) => {
              loaded = undefined;
              throw error;
            });
            const set = await loaded;
            if (!active()) return;
            for (const tool of set.tools) {
              if (!active()) return;
              await context.registerTool(
                {
                  ...tool,
                  execute(input, options) {
                    if (!active())
                      return Promise.resolve({
                        isError: true,
                        error: {
                          code: 'DISPOSED',
                          message:
                            'Tools refreshed. Discover the current tools and retry.',
                        },
                      });
                    publish({ ...state, lastRequest: clock() });
                    // Refresh retires entry points, not an already accepted call/job.
                    return tool.execute(input, options);
                  },
                },
                { signal: current.signal },
              );
            }
            if (active())
              update(scope, owner, { phase: 'ready', count: set.tools.length });
          } catch (error) {
            if (!active()) return;
            current.abort();
            update(scope, owner, {
              phase: 'error',
              count: 0,
              error:
                error instanceof Error
                  ? error.message
                  : 'Could not register browser tools.',
            });
            onError(error);
          }
        });
        return queue;
      };
      refreshers.set(scope, refresh);
      void refresh();
      return {
        get ready() {
          return queue;
        },
        async dispose() {
          lifetime.abort();
          binding?.abort();
          if (owners.get(scope) === owner) {
            owners.delete(scope);
            refreshers.delete(scope);
            const scopes = { ...state.scopes };
            delete scopes[scope];
            publish({ ...state, scopes });
          }
          const set = await loaded?.catch(() => undefined);
          await set?.dispose?.();
          await queue;
        },
      };
    },
  };
}

export const browserAgentConnection = createToolConnection();

export function connectionLabel(state: ConnectionState) {
  const scopes = Object.values(state.scopes);
  if (scopes.some((scope) => scope.phase === 'registering'))
    return 'Refreshing…';
  if (scopes.some((scope) => scope.phase === 'error'))
    return 'Registration failed';
  if (!scopes.length || scopes.some((scope) => scope.phase === 'unavailable'))
    return 'Browser access unavailable';
  return 'Tools ready';
}
