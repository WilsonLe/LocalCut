import { interfaceScale } from './appearance';
import { hasBlockingOverlay } from './overlays';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type ViewCommand = 'zoomIn' | 'zoomOut' | 'zoomFit';
export function anchoredOffset(
  offset: number,
  anchor: number,
  before: number,
  after: number,
) {
  return anchor - ((anchor - offset) * after) / before;
}
export function wheelPixels(
  event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>,
  page: number,
) {
  return (
    event.deltaY *
    (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? page : 1)
  );
}
interface View {
  scale: number;
  x: number;
  y: number;
}
/** Non-passive listeners own zoom only on the pointed editing surface. */
export function useViewport(
  kind: 'timeline' | 'preview',
  identity: string,
  enabled: boolean,
) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const state = useRef(view);
  const [width, setWidth] = useState(0);
  const pendingScroll = useRef<number | null>(null);
  useLayoutEffect(() => {
    state.current = view;
    if (pendingScroll.current !== null && ref.current) {
      ref.current.scrollLeft = pendingScroll.current;
      pendingScroll.current = null;
    }
  }, [view]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = new ResizeObserver(() => setWidth(element.clientWidth));
    resize.observe(element);
    return () => resize.disconnect();
  }, [identity, enabled]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Identity changes reset transient view state without persisting it to a project.
    pendingScroll.current = null;
    state.current = { scale: 1, x: 0, y: 0 };
    setView(state.current);
    element.scrollLeft = 0;
    let drag: { id: number; x: number; y: number } | undefined;
    const allowed = () => enabled && !hasBlockingOverlay();
    const zoom = (factor: number, x: number, y: number, fit = false) => {
      const previous = state.current;
      const scale = fit
        ? 1
        : Math.min(
            kind === 'timeline' ? 32 : 8,
            Math.max(1, previous.scale * factor),
          );
      const next = { scale, x: 0, y: 0 };
      if (kind === 'timeline') {
        pendingScroll.current = fit
          ? 0
          : Math.max(
              0,
              -anchoredOffset(
                -(pendingScroll.current ?? element.scrollLeft),
                Math.max(0, x - 76),
                previous.scale,
                scale,
              ),
            );
      } else if (!fit && scale > 1) {
        next.x = anchoredOffset(previous.x, x, previous.scale, scale);
        next.y = anchoredOffset(previous.y, y, previous.scale, scale);
      }
      state.current = next;
      setView(next);
    };
    const wheel = (event: WheelEvent) => {
      if (
        !allowed() ||
        event.altKey ||
        (event.ctrlKey && event.metaKey) ||
        (event.target instanceof Element &&
          event.target.closest(
            'input, select, textarea, [contenteditable="true"]',
          ))
      )
        return;
      const rect = element.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const delta = Math.max(
          -240,
          Math.min(240, wheelPixels(event, element.clientHeight)),
        );
        zoom(
          Math.exp(-delta * 0.005),
          (event.clientX - rect.left) / interfaceScale(),
          (event.clientY - rect.top) / interfaceScale(),
        );
      } else if (kind === 'timeline' && event.shiftKey) {
        event.preventDefault();
        element.scrollLeft +=
          event.deltaX || wheelPixels(event, element.clientWidth);
      }
    };
    const command = (event: Event) => {
      // The resolver and palette authorize commands; the palette is still
      // mounted during its exit animation. Pointer gestures retain modal guards.
      if (!enabled) return;
      const name = (event as CustomEvent<ViewCommand>).detail;
      zoom(
        name === 'zoomIn' ? 1.25 : 0.8,
        element.clientWidth / 2,
        element.clientHeight / 2,
        name === 'zoomFit',
      );
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 1 || !allowed()) return;
      event.preventDefault();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      element.setPointerCapture(event.pointerId);
      element.focus();
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = (event.clientX - drag.x) / interfaceScale(),
        dy = (event.clientY - drag.y) / interfaceScale();
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (kind === 'timeline') element.scrollLeft -= dx;
      else if (state.current.scale > 1) {
        state.current = {
          ...state.current,
          x: state.current.x + dx,
          y: state.current.y + dy,
        };
        setView(state.current);
      }
    };
    const up = () => {
      drag = undefined;
    };
    const auxiliary = (event: MouseEvent) => {
      if (event.button === 1 && allowed()) event.preventDefault();
    };
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('editor-view', command);
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
    element.addEventListener('lostpointercapture', up);
    element.addEventListener('auxclick', auxiliary);
    return () => {
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('editor-view', command);
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
      element.removeEventListener('lostpointercapture', up);
      element.removeEventListener('auxclick', auxiliary);
    };
  }, [kind, identity, enabled]);
  return { ref, view, width };
}
