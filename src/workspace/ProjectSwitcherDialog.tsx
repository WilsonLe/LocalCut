import type { ReactNode, RefObject } from 'react';
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog';

export default function ProjectSwitcherDialog({
  children,
  onOpenChange,
  trigger,
}: {
  children: ReactNode;
  trigger: RefObject<HTMLButtonElement | null>;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className="project-switcher-dialog h-[min(40rem,calc(var(--app-viewport-height)-2rem))] sm:max-w-4xl"
        finalFocus={trigger}
      >
        <DialogTitle className="sr-only">Projects</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
