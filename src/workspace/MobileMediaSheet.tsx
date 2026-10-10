import type { ReactNode } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '../components/ui/dialog';

export default function MobileMediaSheet({
  children,
  open,
  onClose,
}: {
  children: ReactNode;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPortal keepMounted>
        <DialogOverlay />
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className="mobile-media-sheet fixed z-50 grid text-sm text-foreground outline-none"
          inert={!open}
          aria-hidden={!open || undefined}
          onKeyDownCapture={(event) => {
            if (
              event.key === 'Escape' &&
              !event.currentTarget.hasAttribute('data-nested-dialog-open') &&
              event.target instanceof Element &&
              event.target.closest('[role="dialog"]') === event.currentTarget
            ) {
              // Asset tooltips must not consume the sheet's close shortcut.
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }
          }}
          finalFocus={() =>
            document.getElementById('mobile-media-trigger') ??
            document.getElementById('desktop-media-trigger')
          }
        >
          <DialogTitle className="sr-only">Media library</DialogTitle>
          {children}
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}
