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
  History,
  Search,
  PanelRightClose,
  ChevronDown,
  Download,
  Files,
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
import type { ConversationControls } from './Conversation';
import type { WorkspaceCommand } from './commands';
import { Preview } from './Preview';
import type { PreviewControls } from './Preview';
import { Tooltip } from '../components/ui/tooltip';
import { frameStep } from './shortcuts';
import { useEditorShortcuts } from './useEditorShortcuts';
import { Timeline } from './Timeline';
import { useAppearance } from './appearance';
import {
  saveWorkspacePreferences,
  useWorkspacePreferences,
} from './preferences';
import {
  appendAsset,
  clipName,
  downloadFile,
  formatTime,
  projectDuration,
} from './helpers';

import type { DialogName, Progress } from './WorkspaceDialogs';
const WorkspaceDialogs = lazy(() => import('./WorkspaceDialogs'));
const CommandPalette = lazy(() => import('./CommandPalette'));
const WorkspaceMenu = lazy(() => import('./WorkspaceMenu'));
const AppearancePanel = lazy(() => import('./AppearancePanel'));
type Artifact = ExportResult & { dispose: () => Promise<void> };

export function Workspace() {
  const { dark } = useAppearance();
  const { preferences, saved: preferencesSaved } = useWorkspacePreferences();
  const { chatCollapsed, chatWidth, exportFormat: format } = preferences;
  // Imports can reveal media for this session without changing the user's layout.
  const [mediaOverride, setMediaOverride] = useState<boolean | null>(null);
  const [mediaPreference, setMediaPreference] = useState(preferences.mediaOpen);
  if (mediaPreference !== preferences.mediaOpen) {
    setMediaPreference(preferences.mediaOpen);
    setMediaOverride(null);
  }
  const drawer = mediaOverride ?? preferences.mediaOpen;
  const toggleMedia = () => {
    saveWorkspacePreferences({ mediaOpen: !drawer });
    setMediaOverride(null);
  };
  const toggleChat = () =>
    saveWorkspacePreferences({ chatCollapsed: !chatCollapsed });
  const setFormat = (exportFormat: 'mp4' | 'webm') =>
    saveWorkspacePreferences({ exportFormat });
  const setChatWidth = (chatWidth: number) =>
    saveWorkspacePreferences({ chatWidth });
  useEffect(() => {
    if (!preferencesSaved)
      toast.error(
        'Workspace preferences could not be saved. Allow browser storage to keep them after reload.',
      );
  }, [preferencesSaved]);
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
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [paletteCommands, setPaletteCommands] = useState<WorkspaceCommand[]>(
    [],
  );
  const conversationControls = useRef<ConversationControls>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
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
    if (!browsing.current) {
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
    }
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
            setVersions([]);
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
    setVersions([]);
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
      setMediaOverride(true);
      toast.success(
        `${files.length} ${files.length === 1 ? 'file' : 'files'} added to the timeline`,
      );
    });
  const relinkMedia = (assetId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file)
        void action(async () => {
          if (browsing.current) return;
          const engine = await ensureEditor();
          await awaitJob(
            engine.assets.relink(assetId, file),
            'Relinking media',
          );
          await refresh();
        });
    };
    input.click();
  };
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
      await editor.projects.versions.save(project.id);
      setVersions(await editor.projects.versions.list(project.id));
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
      toggleChat,
      toggleMedia,
      shortcuts: () => setDialog('shortcuts'),
      commands: () => showCommands(),
    },
  });
  const getCommands = () => {
    const commands: WorkspaceCommand[] = [];
    const command = (
      id: string,
      label: string,
      group: string,
      available: boolean,
      run: () => void,
      shortcut?: string,
    ) => {
      if (available) commands.push({ id, label, group, run, shortcut });
    };
    const editable = !!project && !browsed && !busy;
    const focusEditor = () =>
      document.querySelector<HTMLElement>('[data-editor-shortcuts]')?.focus();
    const navigate = (value: number) => {
      seek(value);
      focusEditor();
    };
    command(
      'new',
      'New project',
      'Project',
      !busy,
      () => setDialog('new'),
      'N',
    );
    command('open', 'Open project', 'Project', !busy, showProjects, 'Mod+O');
    command(
      'backup',
      'Download project backup',
      'Project',
      editable,
      backupProject,
    );
    command(
      'import-backup',
      'Import project backup',
      'Project',
      !busy && !browsed,
      () => backupInput.current?.click(),
    );
    command(
      'import',
      'Import media',
      'Media',
      !busy && !browsed,
      () => fileInput.current?.click(),
      'Mod+I',
    );
    for (const asset of assets) {
      command(
        `relink-${asset.id}`,
        `Relink ${asset.name}`,
        'Media',
        editable && asset.status === 'missing',
        () => relinkMedia(asset.id),
      );
    }
    command('undo', 'Undo', 'Editing', editable, undo, 'Mod+Z');
    command('redo', 'Redo', 'Editing', editable, redo, 'Mod+Shift+Z');
    command(
      'split',
      'Split clip at playhead',
      'Editing',
      editable && canSplit,
      split,
      'S',
    );
    command(
      'delete',
      'Delete selected clip',
      'Editing',
      editable && !!selectedClip,
      deleteClip,
      'Delete',
    );
    command(
      'duplicate',
      'Duplicate selected clip',
      'Editing',
      editable && !!selectedClip,
      duplicate,
      'D',
    );
    command('text', 'Add text', 'Editing', editable, addText, 'T');
    command(
      'properties',
      'Clip properties',
      'Editing',
      !busy && !!selectedClip,
      () => setDialog('properties'),
    );
    for (const track of viewProject?.tracks ?? [])
      for (const clip of track.clips) {
        command(
          `select-${clip.id}`,
          `Select ${clipName(clip, browsed ? versionAssets : assets)} (${formatTime(clip.startUs)})`,
          'Clips',
          !busy,
          () => {
            setSelected(clip.id);
            navigate(clip.startUs);
          },
        );
      }
    command(
      'play',
      'Play or pause preview',
      'Playback',
      !!total && !busy,
      () => {
        previewControls.current?.togglePlayback();
        focusEditor();
      },
      'Space',
    );
    for (const [id, label, frames, shortcut] of [
      ['previous', 'Previous frame', -1, '←'],
      ['next', 'Next frame', 1, '→'],
      ['previous-ten', 'Back ten frames', -10, 'Shift+←'],
      ['next-ten', 'Forward ten frames', 10, 'Shift+→'],
    ] as const)
      command(
        id,
        label,
        'Playback',
        !!total && !busy,
        () =>
          navigate(frameStep(timeUs, frames, viewProject!.frameRate, total)),
        shortcut,
      );
    command(
      'start',
      'Go to beginning',
      'Playback',
      !!total && !busy,
      () => navigate(0),
      'Home',
    );
    command(
      'end',
      'Go to last frame',
      'Playback',
      !!total && !busy,
      () => navigate(frameStep(total, 0, viewProject!.frameRate, total)),
      'End',
    );
    command(
      'versions',
      'Browse project versions',
      'Versions',
      !!project && !busy,
      showVersions,
    );
    for (const version of versions)
      command(
        `version-${version.id}`,
        `Browse version ${version.number}`,
        'Versions',
        !!project && !busy,
        () => browseVersion(version.id),
      );
    command(
      'current',
      'Return to current version',
      'Versions',
      !!browsed && !busy,
      leaveVersion,
    );
    command(
      'restore',
      'Restore as new version',
      'Versions',
      !!browsed && !busy,
      restoreVersion,
    );
    command(
      'close-versions',
      'Close versions',
      'Versions',
      versionsOpen && !busy,
      () => {
        leaveVersion();
        setVersionsOpen(false);
      },
    );
    command(
      'export',
      'Export video',
      'Export',
      editable && !!total,
      showExport,
      'Mod+E',
    );
    command(
      'mp4',
      'Use MP4 export format',
      'Export',
      !busy && !browsed && format !== 'mp4',
      () => setFormat('mp4'),
    );
    command(
      'webm',
      'Use WebM export format',
      'Export',
      !busy && !browsed && format !== 'webm',
      () => setFormat('webm'),
    );
    command(
      'chat',
      chatCollapsed ? 'Expand chat' : 'Collapse chat',
      'View',
      true,
      () => {
        toggleChat();
        focusEditor();
      },
      'C',
    );
    command(
      'media',
      drawer ? 'Collapse media' : 'Expand media',
      'View',
      true,
      () => {
        toggleMedia();
        focusEditor();
      },
      'M',
    );
    command(
      'appearance',
      appearanceOpen ? 'Close appearance' : 'Appearance',
      'Settings',
      true,
      () => (appearanceOpen ? closeAppearance() : setAppearanceOpen(true)),
    );
    command('settings', 'Workspace settings', 'Settings', true, openSettings);
    command(
      'shortcuts',
      'Keyboard shortcuts',
      'Settings',
      true,
      () => setDialog('shortcuts'),
      '?',
    );
    const revealChat = (run: () => void) => () => {
      saveWorkspacePreferences({ chatCollapsed: false });
      run();
    };
    for (const item of conversationControls.current?.commands() ?? [])
      commands.push({ ...item, run: revealChat(item.run) });
    return commands;
  };
  const showCommands = () => {
    setPaletteCommands(getCommands());
    setCommandsOpen(true);
  };
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
        {!busy && (
          <Button
            variant="ghost"
            className="project-picker"
            aria-label="Open project"
            onClick={showProjects}
          >
            {viewProject?.name ?? 'Untitled project'}
            <ChevronDown />
          </Button>
        )}
        <div className="header-actions">
          {project && !busy && (
            <Button
              variant="outline"
              size="sm"
              aria-expanded={versionsOpen}
              onClick={showVersions}
            >
              <History /> Versions
            </Button>
          )}
          {!!total && !busy && !browsed && (
            <Button size="sm" onClick={showExport}>
              <ArrowUpRight /> Export
            </Button>
          )}
          {!busy && (
            <Button
              id="workspace-command-trigger"
              variant="ghost"
              size="icon-sm"
              aria-label="Commands"
              aria-haspopup="dialog"
              onClick={showCommands}
            >
              <Search />
            </Button>
          )}
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
                onToggleMedia={toggleMedia}
                onToggleChat={toggleChat}
                onExport={showExport}
                onFormatChange={setFormat}
                onAppearance={() => setAppearanceOpen(true)}
                onShortcuts={() => setDialog('shortcuts')}
                onCommands={showCommands}
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
            controlsRef={conversationControls}
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
            onToggle={toggleChat}
          />
          <main
            className="editing-area"
            data-editor-shortcuts
            tabIndex={0}
            aria-label="Video editor"
          >
            {versionsOpen && (
              <section
                className="version-browser"
                aria-label="Project versions"
              >
                <div className="section-heading">
                  <h2>Versions</h2>
                  {!busy && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        leaveVersion();
                        setVersionsOpen(false);
                      }}
                    >
                      Close versions
                    </Button>
                  )}
                </div>
                <div
                  className="version-list"
                  role="group"
                  aria-label="Saved versions"
                >
                  {versions.map(
                    (version) =>
                      !busy && (
                        <Button
                          key={version.id}
                          variant={
                            browsed?.id === version.id ? 'secondary' : 'ghost'
                          }
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
                      ),
                  )}
                </div>
                {browsed && (
                  <div className="version-actions">
                    <span>Version {browsed.number} · Read-only</span>
                    {!busy && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={leaveVersion}
                      >
                        Return to current
                      </Button>
                    )}
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
                onClick={toggleMedia}
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
                    {!busy && !browsed && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fileInput.current?.click()}
                      >
                        <Upload /> Import media
                      </Button>
                    )}
                    {!!project && !busy && !browsed && (
                      <Button variant="ghost" size="sm" onClick={backupProject}>
                        <Download /> Backup
                      </Button>
                    )}
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
                        {asset.status === 'missing' && !busy && !browsed && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              relinkMedia(asset.id);
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
      {commandsOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            open
            onOpenChange={setCommandsOpen}
            commands={paletteCommands}
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
