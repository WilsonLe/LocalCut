import { useContext, type ComponentProps } from 'react';
import { LoaderCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFocusContext,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';

export interface LoadingDialogProps {
  open?: boolean;
  title: string;
  onClose: () => void;
  finalFocus?: ComponentProps<typeof DialogContent>['finalFocus'];
  showCloseButton?: boolean;
  handoff?: () => boolean;
}

export default function LoadingDialog({
  open = true,
  title,
  onClose,
  finalFocus,
  showCloseButton = true,
  handoff,
}: LoadingDialogProps) {
  const inheritedFocus = useContext(DialogFocusContext);
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-dialog-loading
        showCloseButton={showCloseButton}
        finalFocus={
          handoff
            ? (type) => {
                if (handoff()) return false;
                const target = finalFocus ?? inheritedFocus;
                return typeof target === 'function'
                  ? target(type)
                  : typeof target === 'object'
                    ? target.current
                    : target;
              }
            : finalFocus
        }
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div role="status" aria-label={`Loading ${title.toLowerCase()}…`}>
          <LoaderCircle className="animate-spin motion-reduce:animate-none" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
