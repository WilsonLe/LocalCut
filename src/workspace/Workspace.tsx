import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Download,
  Files,
  FolderOpen,
  LoaderCircle,
  Plus,
  Scissors,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  Asset,
  Clip,
  EditOperation,
  Editor,
  ExportResult,
  Job,
  Project,
} from '../editor';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Toaster } from '../components/ui/sonner';
import { Conversation } from './Conversation';
import { Preview } from './Preview';
import { Timeline } from './Timeline';
import {
  appendAsset,
  clipName,
  downloadFile,
  formatTime,
  projectDuration,
} from './helpers';

type DialogName = 'new' | 'projects' | 'properties' | 'export' | null;
type Artifact = ExportResult & { dispose: () => Promise<void> };
interface Progress {
  label: string;
  fraction?: number;
}

export function Workspace() {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string>();
  const [timeUs, setTimeUs] = useState(0);
  const [seekRevision, setSeekRevision] = useState(0);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [drawer, setDrawer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [format, setFormat] = useState<'mp4' | 'webm'>('mp4');
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [exportError, setExportError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const instance = useRef<Promise<Editor> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const projectId = useRef<string | null>(null);
  const currentJob = useRef<{ cancel(): void } | null>(null);
  const cancelRequested = useRef(false);
  const artifactRef = useRef<Artifact | null>(null);
  const alive = useRef(true);
  const lock = useRef(false);
  const refreshToken = useRef(0);
  const unsubscribe = useRef<(() => void) | null>(null);
  const disposeAssistant = useRef<(() => Promise<void>) | null>(null);
  const registerCleanup = useCallback((cleanup: () => Promise<void>) => {
    disposeAssistant.current = cleanup;
  }, []);
  const error = useCallback((value: unknown) => {
    const detail =
      value && typeof value === 'object' && 'code' in value
        ? String(value.code)
        : '';
    if (detail === 'CANCELLED') {
      toast('Operation cancelled');
      return;
    }
    const message =
      value instanceof Error
        ? value.message
        : 'The operation could not be completed.';
    toast.error(
      message.length > 240
        ? 'The editor could not accept those settings. Check the values and try again.'
        : message,
    );
  }, []);
  const refresh = useCallback(async () => {
    const id = projectId.current,
      engine = editorRef.current,
      token = ++refreshToken.current;
    if (!id || !engine) return;
    const snapshot = await engine.projects.snapshot(id);
    const ids = [
      ...new Set(
        snapshot.tracks.flatMap((track) =>
          track.clips.flatMap((clip) => (clip.assetId ? [clip.assetId] : [])),
        ),
      ),
    ];
    const media = await Promise.all(
      ids.map((assetId) => engine.assets.inspect(assetId)),
    );
    if (
      !alive.current ||
      id !== projectId.current ||
      token !== refreshToken.current
    )
      return;
    setProject(snapshot);
    setAssets(media);
    setSelected((previous) =>
      snapshot.tracks.some((track) =>
        track.clips.some((clip) => clip.id === previous),
      )
        ? previous
        : undefined,
    );
    setTimeUs((previous) =>
      Math.min(previous, Math.max(0, projectDuration(snapshot) - 1)),
    );
  }, []);
  const ensureEditor = useCallback(async () => {
    instance.current ??= import('../editor')
      .then(async ({ createEditor }) => {
        const engine = await createEditor();
        if (!alive.current) {
          await engine.dispose();
          throw new Error('Workspace closed');
        }
        editorRef.current = engine;
        setEditor(engine);
        unsubscribe.current = engine.events.projects((event) => {
          if (event.projectId !== projectId.current) return;
          if (event.type === 'deleted') {
            projectId.current = null;
            setProject(null);
            setAssets([]);
            setSelected(undefined);
            toast('This project was deleted in another window.');
          } else void refresh().catch(error);
        });
        return engine;
      })
      .catch((failure) => {
        instance.current = null;
        throw failure;
      });
    return instance.current;
  }, [refresh, error]);
  useEffect(
    () => () => {
      alive.current = false;
      currentJob.current?.cancel();
      unsubscribe.current?.();
      void artifactRef.current?.dispose();
      void (async () => {
        await disposeAssistant.current?.();
        await editorRef.current?.dispose();
      })();
    },
    [],
  );
  const action = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    cancelRequested.current = false;
    setBusy(true);
    try {
      await work();
    } catch (failure) {
      if (alive.current) error(failure);
    } finally {
      lock.current = false;
      if (alive.current) {
        setBusy(false);
        setProgress(null);
      }
      currentJob.current = null;
    }
  };
  const cancelWork = () => {
    cancelRequested.current = true;
    currentJob.current?.cancel();
  };
  const checkCancelled = () => {
    if (cancelRequested.current)
      throw Object.assign(new Error('Operation cancelled'), {
        code: 'CANCELLED',
      });
  };
  const awaitJob = async <T,>(job: Job<T>, label: string) => {
    currentJob.current = job;
    setProgress({ label });
    const stop = job.subscribe((event) => {
      if (alive.current) setProgress({ label, fraction: event.progress });
    });
    try {
      return await job.completion;
    } finally {
      stop();
      currentJob.current = null;
    }
  };
  const openProject = async (snapshot: Project) => {
    projectId.current = snapshot.id;
    setSelected(undefined);
    setTimeUs(0);
    setDialog(null);
    await refresh();
  };
  const apply = async (operations: EditOperation[]) => {
    const engine = await ensureEditor();
    if (!projectId.current) throw new Error('Create or open a project first.');
    const snapshot = await engine.projects.snapshot(projectId.current);
    await engine.commands.apply({
      projectId: snapshot.id,
      expectedRevision: snapshot.revision,
      requestId: crypto.randomUUID(),
      operations,
    });
    await refresh();
  };
  const importMedia = (files: File[]) =>
    void action(async () => {
      const engine = await ensureEditor();
      if (!projectId.current)
        await openProject(await engine.projects.create('Untitled project'));
      for (const file of files) {
        checkCancelled();
        const asset = await awaitJob(
          engine.assets.import(file),
          `Importing ${file.name}`,
        );
        checkCancelled();
        const snapshot = await engine.projects.snapshot(projectId.current!);
        const operations = appendAsset(snapshot, asset);
        await engine.commands.apply({
          projectId: snapshot.id,
          expectedRevision: snapshot.revision,
          requestId: crypto.randomUUID(),
          operations,
        });
        const insert = operations.find(
          (operation) => operation.type === 'insertClip',
        );
        await refresh();
        if (insert?.type === 'insertClip') setSelected(insert.clip.id);
      }
      setDrawer(true);
      toast.success(
        `${files.length} ${files.length === 1 ? 'file' : 'files'} added to the timeline`,
      );
    });
  const startExport = () =>
    void action(async () => {
      const engine = await ensureEditor();
      if (!project) return;
      setExportError('');
      try {
        const preflight = await awaitJob(
          engine.exports.preflight(project.id, { format }),
          'Checking browser codecs',
        );
        checkCancelled();
        if (!preflight.supported)
          throw new Error(
            `This browser cannot export ${format.toUpperCase()} with the required video and audio codecs.`,
          );
        const result = await awaitJob(
          engine.exports.start(project.id, { format }),
          'Exporting video',
        );
        if (cancelRequested.current) {
          await result.dispose();
          checkCancelled();
        }
        if (!alive.current) {
          await result.dispose();
          return;
        }
        await artifactRef.current?.dispose();
        artifactRef.current = result;
        setArtifact(result);
        toast.success('Your video is ready to save');
      } catch (failure) {
        if (
          failure instanceof Error &&
          !('code' in failure && failure.code === 'CANCELLED')
        )
          setExportError(failure.message);
        throw failure;
      }
    });
  const closeExport = () => {
    if (busy) {
      cancelWork();
      return;
    }
    void artifactRef.current?.dispose();
    artifactRef.current = null;
    setArtifact(null);
    setDialog(null);
    setExportError('');
  };
  const total = projectDuration(project);
  const selectedClip = project?.tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.id === selected);
  const seek = (value: number) => {
    setTimeUs(value);
    setSeekRevision((value) => value + 1);
  };
  return (
    <div className="workspace">
      <header className="workspace-header">
        <a
          className="brand"
          href={import.meta.env.BASE_URL}
          aria-label="LocalCut home"
        >
          <Scissors aria-hidden="true" />
          LocalCut
        </a>
        <Button
          variant="ghost"
          className="project-picker"
          aria-label="Open project"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              const engine = await ensureEditor();
              setProjects(await engine.projects.list());
              setDialog('projects');
            })
          }
        >
          {project?.name ?? 'Untitled project'}
          <ChevronDown />
        </Button>
        <span className="local-indicator">
          <Check /> On this device
        </span>
        <div className="header-actions">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setDialog('new')}
          >
            <Plus /> New project
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-expanded={drawer}
            onClick={() => setDrawer(!drawer)}
          >
            <Files /> Media
          </Button>
          <Button
            size="sm"
            disabled={!total || busy}
            onClick={() => {
              setExportError('');
              setDialog('export');
            }}
          >
            <ArrowUpRight /> Export
          </Button>
        </div>
      </header>
      <div className="workspace-columns">
        <Conversation
          editor={editor}
          project={project}
          selectedClipId={selected}
          onApplied={refresh}
          onError={error}
          registerCleanup={registerCleanup}
        />
        <main className="editing-area">
          {drawer && (
            <section className="media-library" aria-label="Project media">
              <div className="section-heading">
                <h2>Media</h2>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => fileInput.current?.click()}
                  >
                    <Upload /> Import media
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!project || busy}
                    onClick={() =>
                      void action(async () => {
                        const engine = await ensureEditor();
                        downloadFile(
                          new Blob(
                            [await engine.projects.exportJSON(project!.id)],
                            { type: 'application/json' },
                          ),
                          `${project!.name}.localcut.json`,
                        );
                      })
                    }
                  >
                    <Download /> Backup
                  </Button>
                </div>
              </div>
              {assets.length ? (
                <div className="media-grid">
                  {assets.map((asset) => (
                    <div className="media-item" key={asset.id}>
                      <div className="media-symbol">
                        {asset.kind === 'audio' ? <Files /> : <FilmIcon />}
                      </div>
                      <span title={asset.name}>{asset.name}</span>
                      <small>
                        {asset.status === 'missing'
                          ? 'Missing · relink file'
                          : asset.kind === 'image'
                            ? `${asset.width} × ${asset.height}`
                            : formatTime(asset.durationUs)}
                      </small>
                      {asset.status === 'missing' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const input = document.createElement('input');
                            input.type = 'file';
                            input.onchange = () => {
                              const file = input.files?.[0];
                              if (file)
                                void action(async () => {
                                  const engine = await ensureEditor();
                                  await awaitJob(
                                    engine.assets.relink(asset.id, file),
                                    'Relinking media',
                                  );
                                  await refresh();
                                });
                            };
                            input.click();
                          }}
                        >
                          Relink
                        </Button>
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
          )}
          <Preview
            editor={editor}
            project={project}
            timeUs={timeUs}
            seekRevision={seekRevision}
            onTime={setTimeUs}
            onImport={() => fileInput.current?.click()}
            onError={error}
          />
          <Timeline
            project={project}
            assets={assets}
            selected={selected}
            timeUs={timeUs}
            busy={busy}
            onSelect={setSelected}
            onTime={seek}
            onUndo={() =>
              void action(async () => {
                const engine = await ensureEditor();
                const snapshot = await engine.projects.snapshot(project!.id);
                await engine.commands.undo(
                  snapshot.id,
                  crypto.randomUUID(),
                  snapshot.revision,
                );
                await refresh();
                toast.success('Edit undone');
              })
            }
            onRedo={() =>
              void action(async () => {
                const engine = await ensureEditor();
                const snapshot = await engine.projects.snapshot(project!.id);
                await engine.commands.redo(
                  snapshot.id,
                  crypto.randomUUID(),
                  snapshot.revision,
                );
                await refresh();
                toast.success('Edit restored');
              })
            }
            onSplit={() =>
              void action(async () => {
                await apply([
                  {
                    type: 'splitClip',
                    clipId: selected!,
                    atUs: Math.round(timeUs),
                    rightClipId: crypto.randomUUID(),
                  },
                ]);
                toast.success('Clip split');
              })
            }
            onDelete={() =>
              void action(async () => {
                await apply([{ type: 'removeClip', clipId: selected! }]);
                toast.success('Clip removed');
              })
            }
            onProperties={() => setDialog('properties')}
            onText={() =>
              void action(async () => {
                const track = project!.tracks.find(
                  (track) => track.kind === 'overlay',
                );
                const trackId = track?.id ?? crypto.randomUUID();
                const id = crypto.randomUUID();
                await apply([
                  ...(!track
                    ? [
                        {
                          type: 'addTrack' as const,
                          track: { id: trackId, kind: 'overlay' as const },
                        },
                      ]
                    : []),
                  {
                    type: 'insertClip',
                    trackId,
                    clip: {
                      id,
                      kind: 'text',
                      startUs: Math.round(timeUs),
                      durationUs: 3_000_000,
                      width: project!.width,
                      height: project!.height,
                      y: project!.height * 0.3,
                      text: { text: 'Your story starts here', fontSize: 64 },
                    },
                  },
                ]);
                setSelected(id);
                setDialog('properties');
              })
            }
          />
        </main>
      </div>
      <footer className="workspace-footer">
        <span>Local media · Private by default</span>
        <span>
          {project
            ? `Revision ${project.revision} · Saved locally`
            : 'No project open'}
        </span>
      </footer>
      <input
        ref={fileInput}
        className="sr-only"
        type="file"
        multiple
        accept="video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/x-wav,audio/webm,image/png,image/jpeg,image/webp"
        aria-label="Import media"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length) importMedia(files);
        }}
      />
      <input
        ref={backupInput}
        className="sr-only"
        type="file"
        accept=".json"
        aria-label="Import project backup"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file)
            void action(async () => {
              const engine = await ensureEditor();
              await openProject(
                await engine.projects.importJSON(await file.text()),
              );
            });
        }}
      />
      <Dialog
        open={dialog === 'new'}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Save your edits on this device. Media stays in your browser.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const name = String(
                new FormData(event.currentTarget).get('name') ?? '',
              ).trim();
              if (!name) return;
              void action(async () => {
                const engine = await ensureEditor();
                await openProject(await engine.projects.create(name));
                toast.success('Project created');
              });
            }}
          >
            <Label htmlFor="project-name">Project name</Label>
            <Input
              id="project-name"
              name="name"
              defaultValue="Untitled project"
              required
              maxLength={1000}
              autoFocus
            />
            <DialogFooter className="mt-6">
              <Button disabled={busy} type="submit">
                {busy && <LoaderCircle className="animate-spin" />}Create
                project
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog === 'projects'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Open project</DialogTitle>
            <DialogDescription>
              Projects saved in this browser.
            </DialogDescription>
          </DialogHeader>
          <div className="project-list">
            {projects.length ? (
              projects.map((item) => (
                <Button
                  className="justify-between h-auto py-3"
                  variant="outline"
                  key={item.id}
                  disabled={busy}
                  onClick={() => void action(() => openProject(item))}
                >
                  <span className="truncate">{item.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatTime(projectDuration(item))}
                  </span>
                </Button>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No saved projects yet.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => backupInput.current?.click()}
            >
              <FolderOpen /> Import backup
            </Button>
            <Button disabled={busy} onClick={() => setDialog('new')}>
              New project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog === 'properties' && !!selectedClip}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clip properties</DialogTitle>
            <DialogDescription>
              {selectedClip ? clipName(selectedClip, assets) : ''}
            </DialogDescription>
          </DialogHeader>
          {selectedClip && (
            <Properties
              key={`${selectedClip.id}:${project?.revision}`}
              clip={selectedClip}
              busy={busy}
              onSave={(operations) =>
                void action(async () => {
                  await apply(operations);
                  setDialog(null);
                  toast.success('Clip updated');
                })
              }
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog === 'export'}
        onOpenChange={(open) => {
          if (!open) closeExport();
        }}
      >
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Export video</DialogTitle>
            <DialogDescription>
              {artifact
                ? 'Your video is ready. Save a copy to your device.'
                : 'Export locally with your browser’s video and audio codecs.'}
            </DialogDescription>
          </DialogHeader>
          {!artifact && !busy && (
            <>
              <Label htmlFor="export-format">Format</Label>
              <Select
                value={format}
                onValueChange={(value) => {
                  if (value === 'mp4' || value === 'webm') setFormat(value);
                }}
              >
                <SelectTrigger id="export-format" aria-label="Format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mp4">MP4</SelectItem>
                  <SelectItem value="webm">WebM</SelectItem>
                </SelectContent>
              </Select>
              <dl className="export-details">
                <div>
                  <dt>Resolution</dt>
                  <dd>
                    {project?.width} × {project?.height}
                  </dd>
                </div>
                <div>
                  <dt>Frame rate</dt>
                  <dd>
                    {project
                      ? project.frameRate.num / project.frameRate.den
                      : 30}{' '}
                    fps
                  </dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>{formatTime(total)}</dd>
                </div>
              </dl>
            </>
          )}
          {busy && progress && <ProgressView progress={progress} />}
          {artifact && (
            <p className="text-sm">
              {(artifact.file.size / 1024 / 1024).toFixed(1)} MB ·{' '}
              {artifact.format.toUpperCase()} · Revision {artifact.revision}
            </p>
          )}
          {exportError && (
            <p role="alert" className="text-sm text-destructive">
              {exportError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeExport}>
              {busy ? 'Cancel export' : 'Close'}
            </Button>
            {artifact ? (
              <Button
                onClick={() =>
                  downloadFile(
                    artifact.file,
                    `${project?.name ?? 'LocalCut'}.${artifact.format}`,
                  )
                }
              >
                <Download /> Save video
              </Button>
            ) : (
              <Button disabled={busy || !total} onClick={startExport}>
                Export video
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={busy && !!progress && dialog !== 'export'}
        onOpenChange={() => {}}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{progress?.label ?? 'Working'}</DialogTitle>
            <DialogDescription>Processing on this device.</DialogDescription>
          </DialogHeader>
          {progress && <ProgressView progress={progress} />}
          <DialogFooter>
            <Button variant="outline" onClick={cancelWork}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Toaster position="bottom-right" closeButton />
    </div>
  );
}
function FilmIcon() {
  return <Files aria-hidden="true" />;
}
function ProgressView({ progress }: { progress: Progress }) {
  return progress.fraction === undefined ? (
    <LoaderCircle aria-label={progress.label} className="animate-spin" />
  ) : (
    <div
      role="progressbar"
      aria-label={progress.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress.fraction * 100)}
      className="job-progress"
    >
      <div
        style={{
          width: `${Math.max(0, Math.min(1, progress.fraction)) * 100}%`,
        }}
      />
    </div>
  );
}
function Properties({
  clip,
  busy,
  onSave,
}: {
  clip: Clip;
  busy: boolean;
  onSave: (operations: EditOperation[]) => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const startUs = Math.round(Number(form.get('start')) * 1e6),
          enteredDurationUs = Math.round(Number(form.get('duration')) * 1e6),
          speed = Number(form.get('speed')),
          gain = Number(form.get('gain'));
        const isTimedSource = clip.kind === 'video' || clip.kind === 'audio';
        const durationUs =
          isTimedSource &&
          enteredDurationUs === clip.durationUs &&
          speed !== clip.speed
            ? Math.round((clip.sourceOutUs! - clip.sourceInUs) / speed)
            : enteredDurationUs;
        const patch: Extract<EditOperation, { type: 'updateClip' }>['patch'] = {
          startUs,
          durationUs,
          speed,
          gain,
        };
        if (clip.kind === 'video' || clip.kind === 'audio')
          patch.sourceOutUs = clip.sourceInUs + Math.round(durationUs * speed);
        if (clip.text)
          patch.text = { ...clip.text, text: String(form.get('text') ?? '') };
        onSave([{ type: 'updateClip', clipId: clip.id, patch }]);
      }}
      className="grid gap-4"
    >
      <div className="grid grid-cols-2 gap-4">
        {[
          {
            name: 'start',
            label: 'Start (seconds)',
            value: clip.startUs / 1e6,
            min: 0,
            max: undefined,
          },
          {
            name: 'duration',
            label: 'Duration (seconds)',
            value: clip.durationUs / 1e6,
            min: 0.000001,
            max: undefined,
          },
          {
            name: 'speed',
            label: 'Speed',
            value: clip.speed,
            min: 0.25,
            max: 4,
          },
          { name: 'gain', label: 'Gain', value: clip.gain, min: 0, max: 16 },
        ].map((field) => (
          <div className="grid gap-2" key={field.name}>
            <Label htmlFor={`clip-${field.name}`}>{field.label}</Label>
            <Input
              id={`clip-${field.name}`}
              name={field.name}
              type="number"
              required
              min={field.min}
              max={field.max}
              step="any"
              defaultValue={field.value}
            />
          </div>
        ))}
      </div>
      {clip.text && (
        <div className="grid gap-2">
          <Label htmlFor="clip-text">Text</Label>
          <Input id="clip-text" name="text" defaultValue={clip.text.text} />
        </div>
      )}
      <DialogFooter>
        <Button type="submit" disabled={busy}>
          Apply properties
        </Button>
      </DialogFooter>
    </form>
  );
}
