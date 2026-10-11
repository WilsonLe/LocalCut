import { lazy, Suspense, useEffect, useState } from 'react';
import { Files, Music, Upload, ScreenShare } from 'lucide-react';
import type { Asset, Editor } from '../editor';
import type { IndexConnection } from './Conversation';
const AssetIndexControls = lazy(() => import('./AssetIndexControls'));
import { Button } from '../components/ui/button';
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
}: {
  editor: Editor | null;
  indexConnection: IndexConnection | null;
  readOnly: boolean;
  assets: Asset[];
  canEdit: boolean;
  onImport: () => void;
  onRecord: () => void;
  onRelink: (id: string) => void;
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
        {canEdit && (
          <Tooltip content="Import media">
            <button
              type="button"
              className="media-import-card"
              onClick={onImport}
            >
              <Upload aria-hidden="true" />
              <span className="sr-only">Import media</span>
            </button>
          </Tooltip>
        )}
        {assets.map((asset) => (
          <div className="media-item" key={asset.id}>
            <Suspense fallback={<AssetPreview editor={null} asset={asset} />}>
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
                <AssetPreview editor={editor} asset={asset} />
              </AssetIndexControls>
            </Suspense>
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
