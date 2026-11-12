import type { Asset, Editor } from '../editor';
import { useEffect } from 'react';
import { ScanSearch, Square } from 'lucide-react';
import { Button } from '../components/ui/button';
import type { AssetIndexState } from './useAssetIndexing';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../components/ui/dialog';
import { AssetClipPreview } from './AssetClipPreview';

export default function AssetViewerDialog({
  editor,
  asset,
  onClose,
  finalFocus,
  readOnly,
  indexState,
  onIndex,
  onCancelIndex,
  onInspectIndex,
}: {
  editor: Editor;
  asset: Asset;
  onClose: () => void;
  finalFocus: () => HTMLElement | false;
  readOnly: boolean;
  indexState: AssetIndexState | undefined;
  onIndex: () => void;
  onCancelIndex: () => void;
  onInspectIndex: (assetId: string) => Promise<void>;
}) {
  const count = (value: number, noun: string) =>
    `${value} ${noun}${value === 1 ? '' : 's'}`;
  const result = indexState?.result;
  const summary = result
    ? [
        'Indexed',
        count(result.scenes, 'scene'),
        ...(result.frames ? [count(result.frames, 'frame')] : []),
        ...(result.audioWindows
          ? [count(result.audioWindows, 'audio window')]
          : []),
      ].join(' · ')
    : undefined;
  useEffect(() => {
    void onInspectIndex(asset.id);
  }, [onInspectIndex, asset.id]);
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
        <DialogFooter className="items-center gap-3 sm:justify-between">
          <div
            className="min-w-0 text-sm text-muted-foreground"
            role={indexState?.error ? 'alert' : 'status'}
          >
            {indexState?.error ??
              (indexState?.running
                ? `${indexState.stage}${indexState.progress === undefined ? '' : ` · ${Math.round(indexState.progress * 100)}%`}`
                : result
                  ? summary
                  : indexState?.stage)}
          </div>
          {indexState?.running ? (
            <Button variant="outline" onClick={onCancelIndex}>
              <Square aria-hidden="true" /> Cancel indexing
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={onIndex}
              disabled={readOnly || asset.status !== 'ready'}
            >
              <ScanSearch aria-hidden="true" /> Index asset
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
