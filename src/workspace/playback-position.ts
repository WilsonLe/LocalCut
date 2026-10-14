import { useSyncExternalStore } from 'react';

/** View-only clock: frequent playback updates belong to small display consumers. */
export function createPlaybackPosition() {
  let timeUs = 0;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => timeUs,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(value: number) {
      if (value === timeUs) return;
      timeUs = value;
      for (const listener of listeners) listener();
    },
  };
}
export type PlaybackPosition = ReturnType<typeof createPlaybackPosition>;
export function usePlaybackTime(position: PlaybackPosition) {
  return useSyncExternalStore(position.subscribe, position.getSnapshot);
}
export function usePlaybackRange(
  position: PlaybackPosition,
  start?: number,
  end?: number,
) {
  return useSyncExternalStore(
    position.subscribe,
    () =>
      start !== undefined &&
      end !== undefined &&
      position.getSnapshot() > start &&
      position.getSnapshot() < end,
  );
}
