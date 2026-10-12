import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../components/ui/button';

function revealAction(lane: HTMLDivElement, action: HTMLElement) {
  const bounds = lane.getBoundingClientRect();
  const target = action.getBoundingClientRect();
  if (!bounds.width || !lane.clientWidth || !target.width) return;
  const scale = bounds.width / lane.clientWidth;
  const inset = 44 * scale;
  const delta =
    target.left < bounds.left + inset
      ? target.left - bounds.left - inset
      : target.right > bounds.right - inset
        ? target.right - bounds.right + inset
        : 0;
  lane.scrollLeft += delta / scale;
}

/** Titles stay visible while actions share one touch/keyboard scroll lane. */
export function PanelHeader({
  title,
  children,
  label,
  className = '',
}: {
  title: ReactNode;
  children: ReactNode;
  label: string;
  className?: string;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const update = () => {
      const left = element.scrollLeft > 1;
      const right =
        element.scrollWidth - element.clientWidth - element.scrollLeft > 1;
      setEdges((previous) =>
        previous.left === left && previous.right === right
          ? previous
          : { left, right },
      );
    };
    const resize = () => {
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        active !== element &&
        element.contains(active)
      )
        revealAction(element, active);
      update();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    if (content.current) observer.observe(content.current);
    element.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', update);
    };
  }, []);
  return (
    <header className={`panel-header ${className}`}>
      <div className="panel-header-title">{title}</div>
      <div className="panel-header-action-lane">
        <div
          ref={scroll}
          className="panel-header-scroll"
          role="region"
          aria-label={`${label} actions`}
          tabIndex={0}
          onFocusCapture={(event) => {
            if (event.target === event.currentTarget) return;
            revealAction(event.currentTarget, event.target);
          }}
        >
          <div ref={content} className="panel-header-actions">
            {children}
          </div>
        </div>
        {([-1, 1] as const).map((direction) => {
          const left = direction === -1;
          if (!(left ? edges.left : edges.right)) return null;
          return (
            <div
              key={direction}
              className={`panel-header-edge ${left ? 'panel-header-edge-left' : 'panel-header-edge-right'}`}
            >
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Scroll ${label} actions ${left ? 'left' : 'right'}`}
                onClick={() => {
                  scroll.current?.focus({ preventScroll: true });
                  scroll.current?.scrollBy({
                    left:
                      direction *
                      Math.max(44, scroll.current.clientWidth * 0.75),
                    behavior: 'instant',
                  });
                }}
              >
                {left ? <ChevronLeft /> : <ChevronRight />}
              </Button>
            </div>
          );
        })}
      </div>
    </header>
  );
}

export default PanelHeader;
