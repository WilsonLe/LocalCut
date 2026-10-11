import { useEffect, useState, useRef } from 'react';
import {
  Files,
  Music,
  Upload,
  ScreenShare,
  Pencil,
  Trash2,
  Link,
} from 'lucide-react';
import type { Asset, Editor } from '../editor';
import type { IndexConnection } from './Conversation';
import AssetIndexControls from './AssetIndexControls';
import { Menu } from '@base-ui/react/menu';
import { toast } from 'sonner';
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
import { formatTime } from './helpers';

export default function MediaLibrary({
  editor,
  indexConnection,
  readOnly,
  assets,
  canEdit,
  onImport,
  onRecord,
  onRelink,
  onRename,
  onDelete,
}: {
  editor: Editor | null;
  indexConnection: IndexConnection | null;
  readOnly: boolean;
  assets: Asset[];
  canEdit: boolean;
  onImport: () => void;
  onRecord: () => void;
  onRelink: (id: string) => void;
  onRename: (asset: Asset, name: string) => Promise<void>;
  onDelete: (asset: Asset) => Promise<void>;
}) {
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
}: {
  editor: Editor | null;
  asset: Asset;
  canEdit: boolean;
  connection: IndexConnection | null;
  readOnly: boolean;
  onRelink: (id: string) => void;
  onRename: (asset: Asset, name: string) => Promise<void>;
  onDelete: (asset: Asset) => Promise<void>;
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
      toast.success(
        dialog === 'rename' ? 'Asset renamed' : 'Asset removed from project',
      );
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
        <AssetPreview editor={editor} asset={asset} />
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
          <img src={url} alt={`Thumbnail for ${asset.name}`} />
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
