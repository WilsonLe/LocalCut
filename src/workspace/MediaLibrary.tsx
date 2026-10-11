import { useEffect, useState, useRef, type PointerEvent } from 'react';
import { Files, Music, Upload, ScreenShare } from 'lucide-react';
import type { Asset, Editor } from '../editor';
import type { IndexConnection } from './Conversation';
import AssetIndexControls from './AssetIndexControls';
import { Button } from '../components/ui/button';
import { Empty, EmptyContent } from '../components/ui/empty';
import { Tooltip } from '../components/ui/tooltip';
import { MEDIA_DRAG_EVENT, formatTime } from './helpers';

export default function MediaLibrary({
  editor,
  indexConnection,
  readOnly,
  assets,
  canEdit,
  onImport,
  onRecord,
  onRelink,
  onAssetDrag,
}: {
  editor: Editor | null;
  indexConnection: IndexConnection | null;
  readOnly: boolean;
  assets: Asset[];
  canEdit: boolean;
  onImport: () => void;
  onRecord: () => void;
  onRelink: (id: string) => void;
  onAssetDrag: (id: string | null) => void;
}) {
  const drag = useRef<{
    pointerId: number;
    assetId: string;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const emit = (
    phase: 'move' | 'drop' | 'cancel',
    assetId: string,
    clientX = 0,
    clientY = 0,
  ) =>
    document.dispatchEvent(
      new CustomEvent(MEDIA_DRAG_EVENT, {
        detail: { phase, assetId, clientX, clientY },
      }),
    );
  const cancel = () => {
    if (drag.current?.moved) {
      emit('cancel', drag.current.assetId);
      onAssetDrag(null);
    }
    drag.current = null;
  };
  const dragProps = (asset: Asset) => ({
    draggable: false,
    'data-draggable': canEdit && !readOnly && asset.status === 'ready',
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (
        event.button !== 0 ||
        !canEdit ||
        readOnly ||
        asset.status !== 'ready'
      )
        return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        pointerId: event.pointerId,
        assetId: asset.id,
        x: event.clientX,
        y: event.clientY,
        moved: false,
      };
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      const gesture = drag.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      if (!canEdit || readOnly) {
        cancel();
        return;
      }
      if (
        !gesture.moved &&
        Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 4
      )
        return;
      if (!gesture.moved) {
        gesture.moved = true;
        onAssetDrag(asset.id);
      }
      emit('move', asset.id, event.clientX, event.clientY);
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      if (drag.current.moved)
        emit('drop', asset.id, event.clientX, event.clientY);
      drag.current = null;
      onAssetDrag(null);
    },
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Escape' && drag.current) {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    },
  });
  return (
    <section className="media-library" aria-label="Project media">
      <div className="section-heading">
        <h2>Media</h2>
        {canEdit && (
          <Tooltip content="Record screen">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Record screen"
              onClick={onRecord}
            >
              <ScreenShare aria-hidden="true" />
            </Button>
          </Tooltip>
        )}
      </div>
      <div className="media-grid">
        {assets.map((asset) => (
          <div className="media-item" key={asset.id}>
            <AssetIndexControls
              editor={editor}
              asset={asset}
              connection={indexConnection}
              readOnly={readOnly}
              details={
                <>
                  <div>{asset.name}</div>
                  <div>
                    {asset.kind} · {asset.type}
                  </div>
                  {asset.kind !== 'audio' && (
                    <div>
                      {asset.width} × {asset.height}
                    </div>
                  )}
                  {asset.kind !== 'image' && (
                    <div>{formatTime(asset.durationUs)}</div>
                  )}
                  <div>{Math.ceil(asset.size / 1024)} KiB</div>
                  {asset.status === 'missing' && (
                    <div>Missing · relink file</div>
                  )}
                </>
              }
            >
              <AssetPreview
                editor={editor}
                asset={asset}
                {...dragProps(asset)}
              />
            </AssetIndexControls>
            {asset.status === 'missing' && canEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRelink(asset.id)}
              >
                Relink
              </Button>
            )}
          </div>
        ))}
        {canEdit && (
          <Empty className="media-import-card">
            <EmptyContent className="h-full max-w-none">
              <Tooltip content="Import media">
                <Button
                  variant="ghost"
                  className="media-import-action"
                  onClick={onImport}
                >
                  <span className="media-import-symbol" aria-hidden="true">
                    <Upload />
                  </span>
                  <span className="sr-only">Import media</span>
                </Button>
              </Tooltip>
            </EmptyContent>
          </Empty>
        )}
      </div>
    </section>
  );
}

function AssetPreview({
  editor,
  asset,
  ...props
}: {
  editor: Editor | null;
  asset: Asset;
} & React.ComponentProps<'button'>) {
  const [preview, setPreview] = useState<{
    editor: Editor;
    id: string;
    url: string;
  }>();
  useEffect(() => {
    if (!editor || asset.status !== 'ready' || asset.kind === 'audio') return;
    let active = true;
    let url: string | undefined;
    const job = editor.assets.thumbnails(asset.id, [0], 240);
    void job.completion
      .then((frames) => {
        if (!active || !frames[0]) return;
        url = URL.createObjectURL(frames[0].blob);
        setPreview({ editor, id: asset.id, url });
      })
      .catch(() => {
        // A preview is optional; import and editing remain available if decoding fails.
      });
    return () => {
      active = false;
      job.cancel();
      if (url) URL.revokeObjectURL(url);
    };
  }, [editor, asset.id, asset.kind, asset.status]);
  const url =
    asset.status === 'ready' &&
    preview?.editor === editor &&
    preview?.id === asset.id
      ? preview.url
      : undefined;
  return (
    <button
      type="button"
      className="media-asset-preview"
      aria-label={`Asset details for ${asset.name}`}
      {...props}
    >
      <span className="media-symbol">
        {url ? (
          <img
            draggable={false}
            src={url}
            alt={`Thumbnail for ${asset.name}`}
          />
        ) : asset.kind === 'audio' ? (
          <Music aria-hidden="true" />
        ) : (
          <Files aria-hidden="true" />
        )}
      </span>
      <span className="media-asset-name">{asset.name}</span>
    </button>
  );
}
