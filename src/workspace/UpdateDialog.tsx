import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { reloadWorkspace } from './ReleaseRecovery';

export default function UpdateDialog({
  open,
  onOpenChange,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-auto">
        <DialogHeader>
          <DialogTitle>Update available</DialogTitle>
          <DialogDescription>
            A newer version of LocalCut is ready. Finish active work before
            updating. Saved projects and media stay on this device. Chat and
            other session state reset.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Later
          </Button>
          <Button
            aria-disabled={busy}
            onClick={() => {
              if (!busy) reloadWorkspace();
            }}
          >
            Update now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
