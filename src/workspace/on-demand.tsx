import {
  useEffect,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from 'react';

/** Optional UI code publishes through a store update, not a Suspense retry. */
export function onDemand<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>,
  fallback: (props: Props) => ReactNode,
) {
  type State =
    | { status: 'pending' }
    | { status: 'ready'; Component: ComponentType<Props> }
    | { status: 'failed'; error: unknown };
  let state: State = { status: 'pending' };
  let pending: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const snapshot = () => state;
  const publish = (next: State) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const preload = () =>
    (pending ??= Promise.resolve()
      .then(load)
      .then(
        ({ default: Component }) => publish({ status: 'ready', Component }),
        (error: unknown) => {
          publish({ status: 'failed', error });
          throw error;
        },
      ));
  function OnDemand(props: Props) {
    const current = useSyncExternalStore(subscribe, snapshot);
    useEffect(() => {
      // Render failures go through the existing ReleaseRecovery boundary.
      void preload().catch(() => {});
    }, []);
    if (current.status === 'failed') throw current.error;
    if (current.status === 'ready') {
      const { Component } = current;
      return <Component {...props} />;
    }
    return fallback(props);
  }
  return Object.assign(OnDemand, {
    preload,
    isReady: () => state.status === 'ready',
  });
}
