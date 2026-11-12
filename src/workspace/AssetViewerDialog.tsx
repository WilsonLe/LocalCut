import type { Asset, Editor } from '../editor';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../components/ui/dialog';
import { AssetClipPreview } from './AssetClipPreview';

export default function AssetViewerDialog({
  editor,
  asset,
  onClose,
  finalFocus,
}: {
  editor: Editor;
  asset: Asset;
  onClose: () => void;
  finalFocus: () => HTMLElement | false;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-4xl" finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle className="pr-8 wrap-anywhere">{asset.name}</DialogTitle>
          <DialogDescription className="sr-only">
            Source preview
          </DialogDescription>
        </DialogHeader>
        <AssetClipPreview
          editor={editor}
          asset={asset}
          startUs={0}
          endUs={asset.durationUs}
          expanded
        />
      </DialogContent>
    </Dialog>
  );
}
