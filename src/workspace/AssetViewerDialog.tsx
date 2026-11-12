import { useCallback, useEffect, useRef, useState } from 'react';
import type { Asset, Editor } from '../editor';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../components/ui/dialog';

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
  const [url, setUrl] = useState('');
  const [failure, setFailure] = useState('');
  const media = useRef<HTMLMediaElement | null>(null);
  const attachMedia = useCallback((element: HTMLMediaElement | null) => {
    const previous = media.current;
    if (previous && previous !== element) {
      previous.pause();
      previous.removeAttribute('src');
      previous.load();
    }
    media.current = element;
  }, []);
  useEffect(() => {
    let active = true;
    let sourceUrl: string | undefined;
    void editor.assets
      .file(asset.id)
      .then((file) => {
        if (!active) return;
        sourceUrl = URL.createObjectURL(file);
        setUrl(sourceUrl);
      })
      .catch(() => {
        if (active)
          setFailure(
            'Could not open this source. If the file is missing, relink it from the asset actions menu.',
          );
      });
    return () => {
      active = false;
      const element = media.current;
      if (element) {
        element.pause();
        element.removeAttribute('src');
        element.load();
      }
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    };
  }, [editor, asset.id]);
  const unsupported = () =>
    setFailure(
      'This browser could not display this file. Download it from the asset actions menu to open it on your device.',
    );
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
            Original asset preview
          </DialogDescription>
        </DialogHeader>
        {failure ? (
          <p role="alert">{failure}</p>
        ) : url ? (
          asset.kind === 'image' ? (
            <img
              src={url}
              alt={asset.name}
              onError={unsupported}
              className="mx-auto max-h-[60dvh] max-w-full object-contain"
            />
          ) : asset.kind === 'video' ? (
            <video
              ref={attachMedia}
              src={url}
              controls
              playsInline
              preload="metadata"
              aria-label={`Preview of ${asset.name}`}
              onError={unsupported}
              className="max-h-[60dvh] w-full bg-black"
            />
          ) : (
            <audio
              ref={attachMedia}
              src={url}
              controls
              preload="metadata"
              aria-label={`Preview of ${asset.name}`}
              onError={unsupported}
              className="w-full"
            />
          )
        ) : (
          <p role="status">Loading preview…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
