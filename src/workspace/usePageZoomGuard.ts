import { useEffect } from 'react';

/** Browser chrome retains authority over site zoom. Own only page-delivered inputs. */
export function usePageZoomGuard() {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        !event.isComposing &&
        !event.altKey &&
        (event.ctrlKey || event.metaKey) &&
        ['+', '=', '-', '_', '0'].includes(event.key)
      )
        event.preventDefault();
    };
    const wheel = (event: WheelEvent) => {
      // Editing surfaces handle their own wheel first; ordinary scrolling stays native.
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    };
    const gesture = (event: Event) => event.preventDefault();
    window.addEventListener('keydown', key, true);
    window.addEventListener('wheel', wheel, { passive: false });
    for (const name of ['gesturestart', 'gesturechange', 'gestureend'])
      window.addEventListener(name, gesture, { passive: false });
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('wheel', wheel);
      for (const name of ['gesturestart', 'gesturechange', 'gestureend'])
        window.removeEventListener(name, gesture);
    };
  }, []);
}
