import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog';

export default function MobileMediaDialog({
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
      <DialogContent
        className="mobile-media-dialog translate-y-0"
        showCloseButton={false}
        keepMounted
        finalFocus={() =>
          document.getElementById('mobile-media-trigger') ??
          document.getElementById('desktop-media-trigger')
        }
      >
        <DialogTitle className="sr-only">Media library</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
