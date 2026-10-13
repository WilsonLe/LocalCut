import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
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
      <DialogContent>
        <DialogHeader className="border-0 pb-0">
          <DialogTitle>Update available</DialogTitle>
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
