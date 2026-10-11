import {
  lazy,
  Suspense,
  useEffect,
  useState,
  useRef,
  type PointerEvent,
} from 'react';
import {
  Files,
  AudioLines,
  Music,
  Upload,
  ScreenShare,
  Pencil,
  Trash2,
  Link,
} from 'lucide-react';
import type { Asset, Editor } from '../editor';
import type { IndexConnection } from './Conversation';
const TaskQueueControl = lazy(() => import('./TaskQueueControl'));
const AssetIndexControls = lazy(() => import('./AssetIndexControls'));
import { Menu } from '@base-ui/react/menu';
import { assetMenuItemClass } from './AssetMenu';
import { Input } from '../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../components/ui/dialog';

import { Button } from '../components/ui/button';
import { Empty, EmptyContent } from '../components/ui/empty';
import { Tooltip } from '../components/ui/tooltip';
import { MEDIA_DRAG_EVENT, formatTime } from './helpers';

export default function MediaLibrary({
  editor,
  queueOwner = editor,
  indexConnection,
  readOnly,
  assets,
  canEdit,
  onImport,
  onRecord,
  onSpeech,
  headerActions,
  onRelink,
  onRename,
  onDelete,
  onAssetDrag,
}: {
  editor: Editor | null;
  queueOwner?: Pick<Editor, 'tasks'> | null;
  indexConnection: IndexConnection | null;
  readOnly: boolean;
  assets: Asset[];
  canEdit: boolean;
  onImport: () => void;
  onRecord: () => void;
  onSpeech?: () => void;
  headerActions?: React.ReactNode;
  onRelink: (id: string) => void;
  onRename: (asset: Asset, name: string) => Promise<void>;
  onDelete: (asset: Asset) => Promise<void>;
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
      if (event.pointerType !== 'touch') {
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
      }
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
        // Let vertical touch gestures pan the library, including on thumbnails.
        if (
          event.pointerType === 'touch' &&
          Math.abs(event.clientY - gesture.y) >=
            Math.abs(event.clientX - gesture.x)
        )
          return;
        gesture.moved = true;
        event.currentTarget.setPointerCapture(event.pointerId);
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
        {queueOwner && (
          <Suspense fallback={null}>
            <TaskQueueControl editor={queueOwner} />
          </Suspense>
        )}
        {onSpeech && !readOnly && (
          <Tooltip content="Generate a spoken narration from your script">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Text to speech"
              onClick={onSpeech}
            >
              <AudioLines />
            </Button>
          </Tooltip>
        )}
        {headerActions}
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
          <MediaAssetCard
            key={asset.id}
            editor={editor}
            asset={asset}
            connection={indexConnection}
            readOnly={readOnly}
            canEdit={canEdit}
            onRelink={onRelink}
            onRename={onRename}
            onDelete={onDelete}
            previewProps={dragProps(asset)}
          />
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

function MediaAssetCard({
  editor,
  asset,
  connection,
  readOnly,
  canEdit,
  onRelink,
  onRename,
  onDelete,
  previewProps,
}: {
  editor: Editor | null;
  asset: Asset;
  canEdit: boolean;
  connection: IndexConnection | null;
  readOnly: boolean;
  onRelink: (id: string) => void;
  onRename: (asset: Asset, name: string) => Promise<void>;
  onDelete: (asset: Asset) => Promise<void>;
  previewProps: React.ComponentProps<'button'>;
}) {
  const blocked = readOnly || !canEdit;
  const card = useRef<HTMLDivElement>(null);
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const [name, setName] = useState('');
  const [original, setOriginal] = useState(asset);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');
  const actions = (
    <>
      <Menu.Item
        className={assetMenuItemClass}
        disabled={blocked || saving}
        onClick={() => {
          setOriginal(asset);
          setName(asset.name);
          setFailure('');
          setDialog('rename');
        }}
      >
        <Pencil aria-hidden="true" />
        Rename
      </Menu.Item>
      {asset.status === 'missing' && (
        <Menu.Item
          className={assetMenuItemClass}
          disabled={blocked || saving}
          onClick={() => onRelink(asset.id)}
        >
          <Link aria-hidden="true" />
          Relink
        </Menu.Item>
      )}
      <Menu.Item
        className={`${assetMenuItemClass} text-destructive`}
        disabled={blocked || saving}
        onClick={() => {
          setFailure('');
          setDialog('delete');
        }}
      >
        <Trash2 aria-hidden="true" />
        Delete
      </Menu.Item>
    </>
  );
  const submit = async () => {
    if (saving || blocked) return;
    setSaving(true);
    setFailure('');
    try {
      if (dialog === 'rename') await onRename(original, name.trim());
      else await onDelete(asset);
      setDialog(null);
    } catch (e) {
      setFailure(
        e instanceof Error
          ? e.message
          : 'Could not update this asset. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="media-item" ref={card}>
      <AssetIndexControls
        editor={editor}
        asset={asset}
        connection={connection}
        readOnly={readOnly}
        actions={actions}
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
            {asset.status === 'missing' && <div>Missing · relink file</div>}
          </>
        }
      >
        <AssetPreview editor={editor} asset={asset} {...previewProps} />
      </AssetIndexControls>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setDialog(null);
        }}
      >
        <DialogContent
          finalFocus={() =>
            card.current?.querySelector<HTMLButtonElement>(
              '.media-actions-trigger',
            ) ?? false
          }
        >
          <DialogHeader>
            <DialogTitle>
              {dialog === 'rename' ? 'Rename asset' : 'Delete asset'}
            </DialogTitle>
            <DialogDescription>
              {dialog === 'rename'
                ? 'Update the media name in this browser. The original file stays unchanged.'
                : `Remove ${asset.name} and all its timeline clips from this project? Undo can restore them. Original media and saved index runs are retained for saved versions.`}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {dialog === 'rename' && (
              <label className="grid gap-2">
                Asset name
                <Input
                  autoFocus
                  value={name}
                  disabled={saving || blocked}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
            )}
            {failure && (
              <p role="alert" className="text-destructive">
                {failure}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => setDialog(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant={dialog === 'delete' ? 'destructive' : 'default'}
                disabled={
                  saving || blocked || (dialog === 'rename' && !name.trim())
                }
              >
                {saving
                  ? 'Saving…'
                  : dialog === 'rename'
                    ? 'Save name'
                    : 'Delete asset'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
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
