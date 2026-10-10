import { useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { LoaderCircle, Scan, History, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Asset, AssetIndexRun, Editor, Job, JobEvent } from '../editor';
import type { IndexConnection } from './Conversation';
import { getIndexConsent, useIndexConsent } from './index-consent';
import { Button } from '../components/ui/button';
import { Tooltip } from '../components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { formatTime } from './helpers';
import { errorText } from './conversation-errors';
import { hashDistance, histogramDistance } from '../core/asset-index';
const indexError = (e: unknown) => {
  const code = e && typeof e === 'object' && 'code' in e ? e.code : '';
  if (code === 'QUOTA_EXCEEDED')
    return 'Device storage is full. Delete an index run to free space, then retry.';
  if (code === 'MODEL_UNSUPPORTED')
    return 'Choose a chat model supporting the required audio/image/video inputs.';
  if (code === 'INVALID_RESPONSE')
    return 'The model returned invalid labels. Completed outputs are saved; retry explicitly.';
  if (code === 'CANCELLED')
    return 'Indexing cancelled. Completed outputs are saved.';
  if (code === 'UNSUPPORTED_CODEC')
    return 'Chrome cannot encode this excerpt with its required video and audio.';
  return errorText(e);
};

export default function AssetIndexControls({
  editor,
  asset,
  connection,
  readOnly,
  children,
  details,
}: {
  editor: Editor | null;
  asset: Asset;
  connection: IndexConnection | null;
  readOnly: boolean;
  children: ReactElement;
  details: ReactNode;
}) {
  const allowed = useIndexConsent();
  const [runs, setRuns] = useState<AssetIndexRun[]>([]),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<JobEvent | null>(null),
    [open, setOpen] = useState(false),
    [selected, setSelected] = useState<string>(),
    [offset, setOffset] = useState(0),
    [duplicate, setDuplicate] = useState(false);
  const current = useRef<{
    job: Job<AssetIndexRun>;
    indexer: ReturnType<IndexConnection['api']['createAssetIndexer']>;
  } | null>(null);
  const mounted = useRef(false);
  const refresh = async () => {
    if (!editor) return;
    const all = await editor.assets.indexes.list();
    if (!mounted.current) return;
    const local = all.filter((r) => r.assetId === asset.id);
    setRuns(local);
    const frame = local.find((r) => !r.invalidated)?.analysis.frames[0];
    setDuplicate(
      asset.kind === 'image' &&
        !!frame &&
        all.some(
          (r) =>
            r.assetId !== asset.id &&
            !r.invalidated &&
            r.source.kind === 'image' &&
            !!r.analysis.frames[0] &&
            hashDistance(frame.hash, r.analysis.frames[0]!.hash) <= 5 &&
            histogramDistance(frame, r.analysis.frames[0]!) < 0.05,
        ),
    );
  };
  useEffect(() => {
    mounted.current = true;
    void refresh().catch((e) => toast.error(indexError(e)));
    return () => {
      mounted.current = false;
      current.current?.job.cancel();
      void current.current?.indexer.dispose();
    };
    // This card owns one asset and its active job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, asset.id, asset.status]);
  useEffect(() => {
    const owner = current.current;
    if (!allowed || !connection || readOnly) {
      owner?.job.cancel();
      void owner?.indexer.dispose();
    }
    return () => {
      current.current?.job.cancel();
      void current.current?.indexer.dispose();
    };
  }, [allowed, connection, readOnly]);
  const start = async (runId?: string) => {
    if (
      !editor ||
      !connection ||
      current.current ||
      busy ||
      !allowed ||
      readOnly
    )
      return;
    const indexer = connection.api.createAssetIndexer({
      editor,
      provider: connection.provider,
      model: connection.model,
      consent: getIndexConsent,
    });
    const job = indexer.run(asset.id, runId);
    current.current = { job, indexer };
    setBusy(true);
    const notification = toast.loading('Indexing asset…');
    const stop = job.subscribe((event) => {
      if (mounted.current) {
        setProgress(event);
        if (event.state === 'running')
          toast.loading(
            event.stage === 'scan'
              ? 'Finding scenes…'
              : event.stage === 'generate'
                ? 'Generating index evidence…'
                : event.stage === 'label'
                  ? 'Labeling scenes…'
                  : 'Indexing asset…',
            { id: notification },
          );
      }
    });
    try {
      await job.completion;
      if (mounted.current) toast.success('Asset indexed', { id: notification });
    } catch (e) {
      if (mounted.current) toast.error(indexError(e), { id: notification });
    } finally {
      stop();
      await indexer.dispose();
      current.current = null;
      if (mounted.current) {
        setBusy(false);
        setProgress(null);
        await refresh().catch((e) => toast.error(indexError(e)));
      } else toast.dismiss(notification);
    }
  };
  const latest = runs.find((r) => r.status === 'complete' && !r.invalidated),
    retry = runs.find(
      (r) =>
        !r.invalidated &&
        (r.status === 'failed' ||
          r.status === 'cancelled' ||
          r.status === 'analyzed'),
    );
  const viewing = runs.find((r) => r.id === selected) ?? runs[0];
  const compatible =
    !!connection &&
    connection.provider.status().connected &&
    (asset.kind === 'audio'
      ? connection.inputModalities.includes('audio')
      : connection.inputModalities.includes('image') &&
        (asset.kind === 'image' ||
          connection.inputModalities.includes('video')));
  return (
    <>
      <Tooltip
        content={
          <>
            {details}
            {allowed && !compatible && !readOnly && (
              <div>
                {connection
                  ? `Choose a chat model supporting ${asset.kind === 'video' ? 'image and video' : asset.kind} inputs to index this asset.`
                  : 'Connect AI and choose a compatible model to index this asset.'}
              </div>
            )}
            {allowed && latest?.label && (
              <>
                <div>{latest.label.summary}</div>
                <div>{latest.label.tags.slice(0, 4).join(' · ')}</div>
              </>
            )}
            {allowed && duplicate && <div>Visually similar image indexed</div>}
          </>
        }
      >
        {children}
      </Tooltip>
      {allowed && editor && (
        <div className="mt-2 w-full space-y-2">
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={
                !compatible || busy || readOnly || asset.status !== 'ready'
              }
              title={
                !compatible
                  ? 'Connect a chat model with the required audio/image/video inputs to index this asset'
                  : undefined
              }
              onClick={() => void start()}
            >
              {busy ? (
                <LoaderCircle className="motion-safe:animate-spin" />
              ) : (
                <Scan />
              )}
              {latest ? 'Reindex' : 'Index'}
            </Button>
            {busy && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => current.current?.job.cancel()}
              >
                Cancel indexing
              </Button>
            )}
            {!busy && retry && (
              <Button
                size="sm"
                variant="ghost"
                disabled={!compatible || readOnly || asset.status !== 'ready'}
                onClick={() => void start(retry.id)}
              >
                Retry indexing
              </Button>
            )}
            {!!runs.length && (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Index history for ${asset.name}`}
                onClick={() => {
                  setOpen(true);
                  setOffset(0);
                }}
              >
                <History />
              </Button>
            )}
          </div>
          {busy && (
            <div
              role="progressbar"
              aria-label="Asset indexing"
              aria-valuemin={0}
              aria-valuemax={100}
              {...(progress?.progress === undefined
                ? {}
                : { 'aria-valuenow': Math.round(progress.progress * 100) })}
              className="h-1 overflow-hidden rounded bg-muted"
            >
              <div
                className="h-full bg-primary"
                style={{
                  width:
                    progress?.progress === undefined
                      ? '25%'
                      : `${progress.progress * 100}%`,
                }}
              />
            </div>
          )}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="max-h-[calc(var(--app-viewport-height)*0.85)] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Asset index</DialogTitle>
                <DialogDescription>
                  {asset.name} ·{' '}
                  {Math.ceil(
                    runs.reduce(
                      (n, r) =>
                        n +
                        new Blob([JSON.stringify(r)]).size +
                        r.analysis.scenes.reduce(
                          (s, c) =>
                            s + c.artifacts.reduce((a, f) => a + f.size, 0),
                          0,
                        ),
                      0,
                    ) / 1024,
                  )}{' '}
                  KiB retained
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-wrap gap-2">
                {runs.map((run, i) => (
                  <Button
                    key={run.id}
                    size="sm"
                    variant={viewing?.id === run.id ? 'secondary' : 'outline'}
                    onClick={() => {
                      setSelected(run.id);
                      setOffset(0);
                    }}
                  >
                    Run {runs.length - i} ·{' '}
                    {run.invalidated ? 'Source changed' : run.status}
                  </Button>
                ))}
              </div>
              {viewing && (
                <>
                  {viewing.label && (
                    <p className="text-sm">{viewing.label.summary}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {viewing.analysis.scenes.length} detected{' '}
                    {asset.kind === 'image'
                      ? 'image'
                      : asset.kind === 'audio'
                        ? 'audio segments'
                        : 'scenes'}{' '}
                    · scan {(viewing.analysis.scanMs / 1000).toFixed(2)}s ·
                    evidence {(viewing.analysis.generationMs / 1000).toFixed(2)}
                    s
                  </p>
                  {viewing.analysis.scenes
                    .slice(offset, offset + 5)
                    .map((scene) => (
                      <div
                        className="space-y-2 rounded-lg border p-3"
                        key={`${viewing.id}:${scene.id}`}
                      >
                        <p className="text-sm font-medium">
                          {scene.id}
                          {asset.kind !== 'image'
                            ? ` · ${formatTime(scene.startUs)}–${formatTime(scene.endUs)}`
                            : ''}
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {scene.artifacts.map((artifact) => (
                            <Evidence
                              key={artifact.id}
                              editor={editor}
                              runId={viewing.id}
                              artifactId={artifact.id}
                              kind={artifact.kind}
                            />
                          ))}
                        </div>
                        {scene.label && (
                          <p className="text-sm">{scene.label.summary}</p>
                        )}
                        {scene.label?.sound && (
                          <p className="text-xs text-muted-foreground">
                            {scene.label.sound}
                          </p>
                        )}
                      </div>
                    ))}
                  <div className="flex justify-between gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!offset}
                      onClick={() => setOffset((v) => Math.max(0, v - 5))}
                    >
                      Previous scenes
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={offset + 5 >= viewing.analysis.scenes.length}
                      onClick={() => setOffset((v) => v + 5)}
                    >
                      Next scenes
                    </Button>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busy || readOnly}
                    onClick={() =>
                      void editor.assets.indexes
                        .remove(viewing.id)
                        .then(() => {
                          setSelected(undefined);
                          return refresh();
                        })
                        .catch((e) => toast.error(indexError(e)))
                    }
                  >
                    <Trash2 />
                    Delete this run
                  </Button>
                </>
              )}
            </DialogContent>
          </Dialog>
        </div>
      )}
    </>
  );
}
function Evidence({
  editor,
  runId,
  artifactId,
  kind,
}: {
  editor: Editor;
  runId: string;
  artifactId: string;
  kind: 'image' | 'video' | 'audio';
}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true,
      objectUrl = '';
    void editor.assets.indexes
      .artifact(runId, artifactId)
      .then((file) => {
        if (active) {
          objectUrl = URL.createObjectURL(file);
          setUrl(objectUrl);
        }
      })
      .catch((e) => {
        if (active) toast.error(indexError(e));
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [editor, runId, artifactId]);
  if (!url)
    return (
      <LoaderCircle
        className="motion-safe:animate-spin"
        aria-label="Loading index evidence"
      />
    );
  return kind === 'image' ? (
    <img
      src={url}
      alt="Indexed representative frame"
      className="w-full rounded"
    />
  ) : kind === 'audio' ? (
    <audio
      src={url}
      controls
      preload="metadata"
      aria-label="Indexed audio excerpt"
      className="w-full"
    />
  ) : (
    <video
      src={url}
      controls
      preload="metadata"
      aria-label="Indexed action excerpt"
      className="w-full rounded"
    />
  );
}
