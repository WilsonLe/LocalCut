import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { CSSProperties } from 'react';
import {
  ArrowUpRight,
  HardDrive,
  History,
  LoaderCircle,
  Keyboard,
  PanelRightClose,
  ChevronDown,
  Download,
  Files,
  Plus,
  Scissors,
  Settings2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  Asset,
  EditOperation,
  Editor,
  ExportResult,
  Job,
  Project,
  ProjectVersion,
  ProjectVersionInfo,
} from '../editor';
import { Button } from '../components/ui/button';
import { Toaster } from '../components/ui/sonner';
import { Conversation } from './Conversation';
import { Preview } from './Preview';
import type { PreviewControls } from './Preview';
import { Tooltip } from '../components/ui/tooltip';
import { frameStep } from './shortcuts';
import { useEditorShortcuts } from './useEditorShortcuts';
import { Timeline } from './Timeline';
import { useAppearance } from './appearance';
import {
  appendAsset,
  downloadFile,
  formatTime,
  projectDuration,
} from './helpers';

import type { DialogName, Progress } from './WorkspaceDialogs';
const WorkspaceDialogs = lazy(() => import('./WorkspaceDialogs'));
const WorkspaceMenu = lazy(() => import('./WorkspaceMenu'));
const AppearancePanel = lazy(() => import('./AppearancePanel'));
type Artifact = ExportResult & { dispose: () => Promise<void> };

export function Workspace() {
  const { dark } = useAppearance();
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const closeAppearance = () => {
    setAppearanceOpen(false);
    document.getElementById('workspace-settings-trigger')?.focus();
  };
  const [editor, setEditor] = useState<Editor | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<ProjectVersionInfo[]>([]);
  const [browsed, setBrowsed] = useState<ProjectVersion | null>(null);
  const [versionAssets, setVersionAssets] = useState<Asset[]>([]);
  const browsing = useRef(false);
  const viewProject = browsed?.project ?? project;
  const [assets, setAssets] = useState<Asset[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string>();
  const [timeUs, setTimeUs] = useState(0);
  const [seekRevision, setSeekRevision] = useState(0);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [drawer, setDrawer] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [chatWidth, setChatWidth] = useState(320);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [format, setFormat] = useState<'mp4' | 'webm'>('mp4');
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [exportError, setExportError] = useState('');
  const previewControls = useRef<PreviewControls>(null);
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
  const unsubscribeVersions = useRef<(() => void) | null>(null);
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
    if (detail === 'REVISION_CONFLICT') {
      toast.error('Project changed. Review the latest values and try again.');
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
        unsubscribeVersions.current = engine.events.versions((event) => {
          if (event.projectId !== projectId.current) return;
          if (event.error) error(event.error);
          else
            void engine.projects.versions
              .list(event.projectId)
              .then((value) => {
                if (alive.current && event.projectId === projectId.current)
                  setVersions(value);
              })
              .catch(error);
        });
        unsubscribe.current = engine.events.projects((event) => {
          if (event.projectId !== projectId.current) return;
          if (event.type === 'deleted') {
            projectId.current = null;
            setProject(null);
            browsing.current = false;
            setBrowsed(null);
            setVersionsOpen(false);
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
      unsubscribeVersions.current?.();
      void artifactRef.current?.dispose();
      void (async () => {
        await disposeAssistant.current?.();
        await editorRef.current?.dispose().catch(() => {});
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
      if (
        failure &&
        typeof failure === 'object' &&
        'code' in failure &&
        failure.code === 'REVISION_CONFLICT'
      )
        await refresh().catch(error);
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
    const engine = await ensureEditor();
    if (projectId.current)
      await engine.projects.versions.save(projectId.current);
    await engine.projects.open(snapshot.id);
    browsing.current = false;
    setBrowsed(null);
    setVersionsOpen(false);
    projectId.current = snapshot.id;
    setSelected(undefined);
    setTimeUs(0);
    setDialog(null);
    await refresh();
  };
  const apply = async (operations: EditOperation[]) => {
    if (browsing.current)
      throw new Error('Return to the current version to edit.');
    if (!project) throw new Error('Create or open a project first.');
    const engine = await ensureEditor();
    if (project.id !== projectId.current)
      throw new Error('The active project changed. Try again.');
    await engine.commands.apply({
      projectId: project.id,
      expectedRevision: project.revision,
      requestId: crypto.randomUUID(),
      operations,
    });
    await refresh();
  };
  const importMedia = (files: File[]) =>
    void action(async () => {
      if (browsing.current) return;
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
  const total = projectDuration(viewProject);
  const selectedClip = viewProject?.tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.id === selected);
  const seek = (value: number) => {
    setTimeUs(value);
    setSeekRevision((value) => value + 1);
  };
  const showProjects = () =>
    void action(async () => {
      const engine = await ensureEditor();
      setProjects(await engine.projects.list());
      setDialog('projects');
    });
  const backupProject = () =>
    void action(async () => {
      if (!project) return;
      const engine = await ensureEditor();
      downloadFile(
        new Blob([await engine.projects.exportJSON(project.id)], {
          type: 'application/json',
        }),
        `${project.name}.localcut.json`,
      );
    });
  const showVersions = () =>
    void action(async () => {
      if (!project || !editor) return;
      await editor.projects.versions.save(project.id);
      setVersions(await editor.projects.versions.list(project.id));
      setVersionsOpen(true);
    });
  const browseVersion = (id: string) =>
    void action(async () => {
      if (!project || !editor) return;
      const version = await editor.projects.versions.snapshot(project.id, id);
      const ids = [
        ...new Set(
          version.project.tracks.flatMap((t) =>
            t.clips.flatMap((c) => (c.assetId ? [c.assetId] : [])),
          ),
        ),
      ];
      const media = await Promise.all(
        ids.map((id) => editor.assets.inspect(id)),
      );
      browsing.current = true;
      setBrowsed(version);
      setVersionAssets(media);
      setSelected(undefined);
      seek(0);
      setDialog(null);
    });
  const leaveVersion = () =>
    void action(async () => {
      await refresh();
      browsing.current = false;
      setBrowsed(null);
      setSelected(undefined);
      seek(0);
    });
  const restoreVersion = () =>
    void action(async () => {
      if (!project || !editor || !browsed) return;
      await editor.projects.versions.restore(
        project.id,
        browsed.id,
        crypto.randomUUID(),
        project.revision,
      );
      await refresh();
      setVersions(await editor.projects.versions.list(project.id));
      browsing.current = false;
      setBrowsed(null);
      setSelected(undefined);
      seek(0);
      toast.success('Restored as a new version');
    });
  const showExport = () => {
    setExportError('');
    setDialog('export');
  };
  const openSettings = () => {
    setSettingsLoaded(true);
    setSettingsOpen(true);
  };
  const undo = () => {
    if (browsing.current || !project) return;
    void action(async () => {
      const engine = await ensureEditor();
      await engine.commands.undo(
        project!.id,
        crypto.randomUUID(),
        project!.revision,
      );
      await refresh();
      toast.success('Edit undone');
    });
  };
  const redo = () => {
    if (browsing.current || !project) return;
    void action(async () => {
      const engine = await ensureEditor();
      await engine.commands.redo(
        project!.id,
        crypto.randomUUID(),
        project!.revision,
      );
      await refresh();
      toast.success('Edit restored');
    });
  };
  const split = () => {
    if (!project || !selectedClip) return;
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
    });
  };
  const deleteClip = () => {
    if (!project || !selectedClip) return;
    void action(async () => {
      await apply([{ type: 'removeClip', clipId: selected! }]);
      toast.success('Clip removed');
    });
  };
  const addText = () => {
    if (!project) return;
    void action(async () => {
      const track = project!.tracks.find((track) => track.kind === 'overlay');
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
    });
  };
  const duplicate = () => {
    const track = project?.tracks.find((track) =>
      track.clips.some((clip) => clip.id === selected),
    );
    if (!selectedClip || !track) return;
    void action(async () => {
      const id = crypto.randomUUID();
      await apply([
        {
          type: 'duplicateClip',
          clipId: selectedClip.id,
          newClipId: id,
          trackId: track.id,
          startUs: selectedClip.startUs + selectedClip.durationUs,
        },
      ]);
      setSelected(id);
      toast.success('Clip duplicated');
    });
  };
  const canSplit =
    !!selectedClip &&
    timeUs > selectedClip.startUs &&
    timeUs < selectedClip.startUs + selectedClip.durationUs;
  useEditorShortcuts({
    enabled: !busy,
    actions: {
      playPause: total
        ? () => previewControls.current?.togglePlayback()
        : undefined,
      previousFrame: project
        ? () => seek(frameStep(timeUs, -1, viewProject!.frameRate, total))
        : undefined,
      nextFrame: project
        ? () => seek(frameStep(timeUs, 1, viewProject!.frameRate, total))
        : undefined,
      previousTenFrames: project
        ? () => seek(frameStep(timeUs, -10, viewProject!.frameRate, total))
        : undefined,
      nextTenFrames: project
        ? () => seek(frameStep(timeUs, 10, viewProject!.frameRate, total))
        : undefined,
      start: project ? () => seek(0) : undefined,
      end: project
        ? () => seek(frameStep(total, 0, viewProject!.frameRate, total))
        : undefined,
      split: canSplit && !browsed ? split : undefined,
      delete: selectedClip && !browsed ? deleteClip : undefined,
      duplicate: selectedClip && !browsed ? duplicate : undefined,
      addText: project && !browsed ? addText : undefined,
      undo: project && !browsed ? undo : undefined,
      redo: project && !browsed ? redo : undefined,
      newProject: () => setDialog('new'),
      openProject: showProjects,
      import: !browsed ? () => fileInput.current?.click() : undefined,
      export: total && !browsed ? showExport : undefined,
      toggleChat: () => setChatCollapsed((collapsed) => !collapsed),
      toggleMedia: () => setDrawer((open) => !open),
      shortcuts: () => setDialog('shortcuts'),
    },
  });
  const settingsTrigger = (
    <Button
      id="workspace-settings-trigger"
      variant="ghost"
      size="icon-sm"
      aria-label="Workspace settings"
      aria-haspopup="menu"
      aria-controls="workspace-settings-menu"
      aria-expanded={settingsOpen}
      onClick={openSettings}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          openSettings();
        }
      }}
    >
      <Settings2 />
    </Button>
  );
  return (
    <div
      className="workspace"
      data-chat-collapsed={chatCollapsed}
      data-media-open={drawer}
      style={{ '--chat-preferred-width': `${chatWidth}px` } as CSSProperties}
    >
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
          onClick={showProjects}
        >
          {viewProject?.name ?? 'Untitled project'}
          <ChevronDown />
        </Button>
        <Tooltip
          content={
            project
              ? browsed
                ? `Version ${browsed.number} · Read-only`
                : `Revision ${project.revision} · Saved locally. Original media stays on this device.`
              : 'Projects and media are saved on this device.'
          }
        >
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Local storage information"
            className="local-indicator"
          >
            <HardDrive />
          </Button>
        </Tooltip>
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
            disabled={!project || busy}
            aria-expanded={versionsOpen}
            onClick={showVersions}
          >
            {busy && versionsOpen ? (
              <LoaderCircle
                className="animate-spin"
                aria-label="Loading versions"
              />
            ) : (
              <History />
            )}{' '}
            Versions
          </Button>
          <Button
            size="sm"
            disabled={!total || busy || !!browsed}
            onClick={showExport}
          >
            <ArrowUpRight /> Export
          </Button>
          <Tooltip content="Keyboard shortcuts (?)">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Keyboard shortcuts"
              onClick={() => setDialog('shortcuts')}
            >
              <Keyboard />
            </Button>
          </Tooltip>
          {settingsLoaded ? (
            <Suspense fallback={settingsTrigger}>
              <WorkspaceMenu
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                busy={busy || !!browsed}
                hasProject={!!project}
                canExport={!!total}
                mediaOpen={drawer}
                chatCollapsed={chatCollapsed}
                format={format}
                onNew={() => setDialog('new')}
                onOpen={showProjects}
                onBackup={backupProject}
                onImportBackup={() => backupInput.current?.click()}
                onToggleMedia={() => setDrawer((open) => !open)}
                onToggleChat={() => setChatCollapsed((collapsed) => !collapsed)}
                onExport={showExport}
                onFormatChange={setFormat}
                onAppearance={() => setAppearanceOpen(true)}
              />
            </Suspense>
          ) : (
            settingsTrigger
          )}
        </div>
      </header>
      <div className="workspace-body" data-appearance-open={appearanceOpen}>
      <div className="workspace-columns">
        <Conversation
          editor={editor}
          project={project}
          readOnly={!!browsed}
          selectedClipId={selected}
          onApplied={refresh}
          onError={error}
          registerCleanup={registerCleanup}
          collapsed={chatCollapsed}
          width={chatWidth}
          onResize={setChatWidth}
          onToggle={() => setChatCollapsed((collapsed) => !collapsed)}
        />
        <main
          className="editing-area"
          data-editor-shortcuts
          tabIndex={0}
          aria-label="Video editor"
        >
          {versionsOpen && (
            <section className="version-browser" aria-label="Project versions">
              <div className="section-heading">
                <h2>Versions</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    leaveVersion();
                    setVersionsOpen(false);
                  }}
                >
                  Close versions
                </Button>
              </div>
              <div
                className="version-list"
                role="group"
                aria-label="Saved versions"
              >
                {versions.map((version) => (
                  <Button
                    key={version.id}
                    variant={browsed?.id === version.id ? 'secondary' : 'ghost'}
                    disabled={busy}
                    aria-pressed={browsed?.id === version.id}
                    onClick={() => browseVersion(version.id)}
                  >
                    Version {version.number} ·{' '}
                    {new Date(version.createdAt).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                    {version.kind === 'restore' ? ' · Restored' : ''}
                  </Button>
                ))}
              </div>
              {browsed && (
                <div className="version-actions">
                  <span>Version {browsed.number} · Read-only</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={leaveVersion}
                  >
                    Return to current
                  </Button>
                  <Button size="sm" disabled={busy} onClick={restoreVersion}>
                    Restore as new version
                  </Button>
                </div>
              )}
            </section>
          )}
          <div className="editing-content">
            <Preview
              controlsRef={previewControls}
              editor={editor}
              project={viewProject}
              versionId={browsed?.id}
              timeUs={timeUs}
              seekRevision={seekRevision}
              onTime={setTimeUs}
              onImport={() => fileInput.current?.click()}
              onError={error}
            />
            <Timeline
              project={viewProject}
              assets={browsed ? versionAssets : assets}
              readOnly={!!browsed}
              selected={selected}
              timeUs={timeUs}
              busy={busy}
              onSelect={setSelected}
              onTime={seek}
              onUndo={undo}
              onRedo={redo}
              onSplit={split}
              onDelete={deleteClip}
              onProperties={() => setDialog('properties')}
              onText={addText}
            />
          </div>
        </main>
        <aside
          className="media-panel"
          aria-label="Media library"
          data-collapsed={!drawer}
        >
          <Tooltip content={drawer ? 'Collapse media' : 'Open media'}>
            <Button
              className="media-toggle"
              variant="ghost"
              size="icon-sm"
              aria-label={drawer ? 'Collapse media' : 'Expand media'}
              aria-expanded={drawer}
              aria-controls="workspace-media-content"
              onClick={() => setDrawer((open) => !open)}
            >
              {drawer ? <PanelRightClose /> : <Files />}
            </Button>
          </Tooltip>
          <div
            id="workspace-media-content"
            className="media-content"
            inert={!drawer}
            aria-hidden={!drawer}
          >
            <section className="media-library" aria-label="Project media">
              <div className="section-heading">
                <h2>Media</h2>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !!browsed}
                    onClick={() => fileInput.current?.click()}
                  >
                    <Upload /> Import media
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!project || busy || !!browsed}
                    onClick={backupProject}
                  >
                    <Download /> Backup
                  </Button>
                </div>
              </div>
              {(browsed ? versionAssets : assets).length ? (
                <div className="media-grid">
                  {(browsed ? versionAssets : assets).map((asset) => (
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
                          disabled={busy || !!browsed}
                          onClick={() => {
                            const input = document.createElement('input');
                            input.type = 'file';
                            input.onchange = () => {
                              const file = input.files?.[0];
                              if (file)
                                void action(async () => {
                                  if (browsing.current) return;
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
          </div>
        </aside>
        </div>
        {appearanceOpen && (
          <Suspense
            fallback={
              <section className="appearance-panel" role="status">
                Loading appearance…
              </section>
            }
          >
            <AppearancePanel onClose={closeAppearance} />
          </Suspense>
        )}
      </div>
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
              if (browsing.current) return;
              const engine = await ensureEditor();
              await openProject(
                await engine.projects.importJSON(await file.text()),
              );
            });
        }}
      />
      {(dialog || (busy && progress)) && (
        <Suspense fallback={null}>
          <WorkspaceDialogs
            dialog={dialog}
            busy={busy}
            project={viewProject}
            readOnly={!!browsed}
            projects={projects}
            selectedClip={selectedClip}
            assets={browsed ? versionAssets : assets}
            format={format}
            artifact={artifact}
            exportError={exportError}
            progress={progress}
            total={total}
            onDialogChange={setDialog}
            onCloseExport={closeExport}
            onStartExport={startExport}
            onFormatChange={setFormat}
            onCancelWork={cancelWork}
            onImportBackup={() => backupInput.current?.click()}
            onOpenProject={(snapshot) =>
              void action(() => openProject(snapshot))
            }
            onCreateProject={(name) =>
              void action(async () => {
                const engine = await ensureEditor();
                await openProject(await engine.projects.create(name));
                toast.success('Project created');
              })
            }
            onSaveProperties={(operations) =>
              void action(async () => {
                await apply(operations);
                setDialog(null);
                toast.success('Clip updated');
              })
            }
          />
        </Suspense>
      )}
      <Toaster
        theme={dark ? 'dark' : 'light'}
        position="bottom-right"
        closeButton
      />
    </div>
  );
}
function FilmIcon() {
  return <Files aria-hidden="true" />;
}
