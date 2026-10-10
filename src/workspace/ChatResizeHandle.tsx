import { useLayoutEffect, useRef, useState } from 'react';
import { interfaceScale } from './appearance';
import { CHAT_MIN_WIDTH, CHAT_MAX_WIDTH } from './preferences';

interface ChatResizeHandleProps {
  width: number;
  onResize: (width: number) => void;
  minWidth?: number;
  maxWidth?: number;
}

/** The CYOBot chat divider, oriented for LocalCut's left-hand conversation. */
export function ChatResizeHandle({
  width,
  onResize,
  minWidth = CHAT_MIN_WIDTH,
  maxWidth = CHAT_MAX_WIDTH,
}: ChatResizeHandleProps) {
  const handle = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    id: number;
    x: number;
    width: number;
    preferred: number;
  } | null>(null);
  const [bounds, setBounds] = useState({ width, max: maxWidth });

  useLayoutEffect(() => {
    const panel = handle.current?.parentElement;
    const columns = panel?.parentElement;
    if (!panel || !columns) return;
    const measure = () => {
      const media = columns.querySelector('.media-panel');
      const available =
        columns.clientWidth -
        (media instanceof HTMLElement ? media.offsetWidth : 0) -
        minWidth;
      const next = {
        width: Math.round(panel.offsetWidth),
        max: Math.min(maxWidth, Math.max(minWidth, available)),
      };
      setBounds((previous) =>
        previous.width === next.width && previous.max === next.max
          ? previous
          : next,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(columns);
    observer.observe(panel);
    const media = columns.querySelector('.media-panel');
    if (media) observer.observe(media);
    measure();
    return () => observer.disconnect();
  }, [minWidth, maxWidth]);

  const resize = (value: number) =>
    onResize(Math.max(minWidth, Math.min(bounds.max, value)));

  return (
    <div
      ref={handle}
      role="separator"
      aria-label="Resize workspace chat"
      aria-orientation="vertical"
      aria-controls="workspace-chat"
      aria-valuemin={minWidth}
      aria-valuemax={bounds.max}
      aria-valuenow={bounds.width}
      aria-valuetext={`${bounds.width} pixels`}
      tabIndex={0}
      className="absolute inset-y-0 right-0 z-20 hidden w-2 touch-none cursor-col-resize items-center justify-center outline-none hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring min-[901px]:flex"
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        gesture.current = {
          id: event.pointerId,
          x: event.clientX,
          width: bounds.width,
          preferred: width,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = gesture.current;
        if (start?.id === event.pointerId)
          resize(start.width + (event.clientX - start.x) / interfaceScale());
      }}
      onPointerUp={(event) => {
        if (gesture.current?.id !== event.pointerId) return;
        gesture.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        if (gesture.current) onResize(gesture.current.preferred);
        gesture.current = null;
      }}
      onLostPointerCapture={() => {
        gesture.current = null;
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 64 : 16;
        const renderedWidth = Math.round(
          event.currentTarget.parentElement?.offsetWidth ?? bounds.width,
        );
        const value =
          event.key === 'ArrowRight'
            ? renderedWidth + step
            : event.key === 'ArrowLeft'
              ? renderedWidth - step
              : event.key === 'Home'
                ? minWidth
                : event.key === 'End'
                  ? bounds.max
                  : null;
        if (value !== null) {
          event.preventDefault();
          resize(value);
        }
      }}
    >
      <span aria-hidden="true" className="h-8 w-0.5 rounded-full bg-border" />
    </div>
  );
}
