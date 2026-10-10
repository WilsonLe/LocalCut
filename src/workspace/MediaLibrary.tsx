import { lazy, Suspense } from 'react';
import { Download, Files, Upload } from 'lucide-react';
import type { Asset, Editor } from '../editor';
import type { IndexConnection } from './Conversation';
const AssetIndexControls = lazy(() => import('./AssetIndexControls'));
import { Button } from '../components/ui/button';
import { formatTime } from './helpers';

export default function MediaLibrary({
  editor,
  indexConnection,
  readOnly,
  assets,
  canEdit,
  hasProject,
  onImport,
  onBackup,
  onRelink,
}: {
  editor: Editor | null;
  indexConnection: IndexConnection | null;
  readOnly: boolean;
  assets: Asset[];
  canEdit: boolean;
  hasProject: boolean;
  onImport: () => void;
  onBackup: () => void;
  onRelink: (id: string) => void;
}) {
  return (
    <section className="media-library" aria-label="Project media">
      <div className="section-heading">
        <h2>Media</h2>
        <div className="flex gap-2">
          {canEdit && (
            <Button variant="outline" size="sm" onClick={onImport}>
              <Upload />
              Import media
            </Button>
          )}
          {hasProject && canEdit && (
            <Button variant="ghost" size="sm" onClick={onBackup}>
              <Download />
              Backup
            </Button>
          )}
        </div>
      </div>
      {assets.length ? (
        <div className="media-grid">
          {assets.map((asset) => (
            <div className="media-item" key={asset.id}>
              <div className="media-symbol">
                <Files aria-hidden="true" />
              </div>
              <span title={asset.name}>{asset.name}</span>
              <small>
                {asset.status === 'missing'
                  ? 'Missing · relink file'
                  : asset.kind === 'image'
                    ? `${asset.width} × ${asset.height}`
                    : formatTime(asset.durationUs)}
              </small>
              {asset.status === 'missing' && canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRelink(asset.id)}
                >
                  Relink
                </Button>
              )}
              {editor && (
                <Suspense fallback={null}>
                  <AssetIndexControls
                    editor={editor}
                    asset={asset}
                    connection={indexConnection}
                    readOnly={readOnly}
                  />
                </Suspense>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Import video, audio or images to add them to the timeline.
        </p>
      )}
    </section>
  );
}
