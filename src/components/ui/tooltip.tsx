import type { ReactElement, ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';

const touchContents = new WeakMap<HTMLElement, ReactNode>();
export function getTouchTooltipContent(anchor: HTMLElement) {
  return touchContents.get(anchor);
}

/** Shared shadcn/Base UI tooltip; every trigger remains keyboard focusable. */
export function Tooltip({
  children,
  content,
  toggleOnClick = false,
}: {
  children: ReactElement;
  content: ReactNode;
  /** Opt in for help buttons that must also disclose their text on touch. */
  toggleOnClick?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = trigger.current;
    if (!element) return;
    touchContents.set(element, content);
    return () => {
      touchContents.delete(element);
    };
  }, [content]);
  return (
    <TooltipPrimitive.Root open={open} onOpenChange={setOpen}>
      <TooltipPrimitive.Trigger
        ref={trigger}
        render={children}
        delay={200}
        aria-describedby={open ? id : undefined}
        onClick={toggleOnClick ? () => setOpen((value) => !value) : undefined}
      />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner
          sideOffset={6}
          collisionPadding={8}
          className="z-50"
        >
          <TooltipPrimitive.Popup
            id={id}
            role="tooltip"
            data-slot="tooltip-content"
            className="max-w-64 rounded-md bg-foreground px-3 py-2 text-xs leading-relaxed text-background shadow-md"
          >
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/** Shared popup for the workspace's delegated touch-hold gesture. */
export function TouchTooltip({
  anchor,
  content,
}: {
  anchor: HTMLElement;
  content: ReactNode;
}) {
  const id = useId();
  useEffect(() => {
    const tokens = (anchor.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter(Boolean);
    anchor.setAttribute('aria-describedby', [...tokens, id].join(' '));
    return () => {
      const remaining = (anchor.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .filter((token) => token && token !== id);
      if (remaining.length)
        anchor.setAttribute('aria-describedby', remaining.join(' '));
      else anchor.removeAttribute('aria-describedby');
    };
  }, [anchor, id]);
  return (
    <TooltipPrimitive.Root open>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner
          anchor={anchor}
          sideOffset={6}
          collisionPadding={8}
          className="z-[100] pointer-events-none"
        >
          <TooltipPrimitive.Popup
            id={id}
            role="tooltip"
            data-slot="touch-tooltip"
            className="max-w-64 rounded-md bg-foreground px-3 py-2 text-xs leading-relaxed text-background shadow-md"
          >
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
