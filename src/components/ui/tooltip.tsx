import type { ReactElement, ReactNode } from 'react';
import { useId, useState } from 'react';
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';

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
  return (
    <TooltipPrimitive.Root open={open} onOpenChange={setOpen}>
      <TooltipPrimitive.Trigger
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
