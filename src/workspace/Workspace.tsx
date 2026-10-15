import { useMediaImport } from './useMediaImport';
import { useWorkspaceLayout } from './useWorkspaceLayout';
import { useTimelineEditing } from './useTimelineEditing';
import { createPlaybackPosition, usePlaybackRange } from './playback-position';
import { LoadingDialog, onDemandDialog } from './on-demand-dialog';
import type { StoryboardControls } from './Storyboard';
import { ProjectTabs } from './ProjectTabs';
import type { ProjectTab } from './ProjectTabs';
const PanelHeader = lazy(() => import('./PanelHeader'));
const Storyboard = lazy(() =>
  import('./Storyboard').then(({ Storyboard }) => ({ default: Storyboard })),
);
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  LoaderCircle,
  Search,
  PanelLeftClose,
  Scissors,
  Files,
  Upload,
  Settings2,
} from 'lucide-react';
import { toast } from './notifications';
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
import {
  showErrorToast,
  registerErrorSession,
  subscribeErrorDetails,
} from './error-toast';
import type { ErrorReport } from './error-toast';
const ErrorDetailsDialog = onDemandDialog(
  () => import('./ErrorDetailsDialog'),
  ({ onClose }) => ({ title: 'Error details', onClose }),
);
import { NotificationControl } from './NotificationControl';
// Capture callback secrets before loading the conversation or any asynchronous work.
import './oauth-callback';
const Conversation = lazy(() =>
  import('./Conversation').then(({ Conversation }) => ({
    default: Conversation,
  })),
);
import type { ConversationControls } from './Conversation';
import type { WorkspaceCommand } from './commands';
import type { IndexConnection } from './Conversation';
const WorkspacePanels = lazy(() =>
  import('./WorkspacePanels').then(({ WorkspacePanels }) => ({
    default: WorkspacePanels,
  })),
);
const EditorPanels = lazy(() =>
  import('./WorkspacePanels').then(({ EditorPanels }) => ({
    default: EditorPanels,
  })),
);
import type { PreviewControls } from './Preview';
const Tooltip = lazy(() =>
  import('../components/ui/tooltip').then(({ Tooltip }) => ({
    default: Tooltip,
  })),
);
import {
  nudgeSelection,
  trimAtPlayhead,
  editBoundary,
} from './editing-actions';
import type { EditorShortcut } from './shortcuts';
import { frameStep, dispatchViewCommand } from './shortcuts';
import { useEditorShortcuts } from './useEditorShortcuts';
import { useWorkspaceRoute } from './useWorkspaceRoute';
import {
  useWorkspaceProject,
  readWorkspaceProject,
} from './useWorkspaceProject';
import { useProjectNavigation } from './useProjectNavigation';
import { useProjectCatalog } from './useProjectCatalog';
import { rememberProject } from './recent-project';
import { selectionIds } from '../core/timeline';
import { useAppearance } from './appearance';
import { usePageZoomGuard } from './usePageZoomGuard';
import { useFileDrop } from './useFileDrop';
const ImportProgressDialog = onDemandDialog(
  () => import('./ImportProgressDialog'),
  ({ onClose }) => ({ title: 'Import media', onClose }),
);
import { assetClip, downloadFile, projectDuration } from './helpers';

import type { DialogName, Progress } from './WorkspaceDialogs';
const MediaLibrary = lazy(() => import('./MediaLibrary'));
const TaskQueueControl = lazy(() => import('./TaskQueueControl'));
const TaskQueueNotifications = lazy(() => import('./TaskQueueNotifications'));
const ScreenRecordingDialog = onDemandDialog(
  () => import('./ScreenRecordingDialog'),
  ({ onClose }) => ({ title: 'Record screen', onClose }),
);
const MobileNavigation = lazy(() => import('./MobileNavigation'));
const WorkspaceDialogs = onDemandDialog(
  () => import('./WorkspaceDialogs'),
  (props) => ({
    title:
      props.dialog === 'new'
        ? 'New project'
        : props.dialog === 'text'
          ? 'Add text'
          : props.dialog === 'properties'
            ? 'Clip properties'
            : props.dialog === 'export'
              ? 'Export video'
              : props.dialog === 'shortcuts'
                ? 'Keyboard shortcuts'
                : (props.progress?.label ?? 'Working'),
    onClose: () => {
      if (props.dialog === 'export') props.onCloseExport();
      else if (!props.busy) props.onDialogChange(null);
    },
    showCloseButton: !props.busy,
    finalFocus:
      props.dialog === 'properties' && props.propertiesOpener
        ? () =>
            props.propertiesOpener?.isConnected
              ? props.propertiesOpener
              : document.getElementById('workspace-settings-trigger')
        : undefined,
  }),
);
const Preview = lazy(() =>
  import('./Preview').then(({ Preview }) => ({ default: Preview })),
);
const Timeline = lazy(() =>
  import('./Timeline').then(({ Timeline }) => ({ default: Timeline })),
);
const CommandPalette = onDemandDialog(
  () => import('./CommandPalette'),
  ({ onOpenChange }) => ({
    title: 'Commands',
    onClose: () => onOpenChange(false),
    finalFocus: () => document.getElementById('workspace-command-trigger'),
  }),
);
const WorkspaceMenu = lazy(() => import('./WorkspaceMenu'));
const WorkspaceTransferDialog = onDemandDialog(
  () => import('./WorkspaceTransferDialog'),
  ({ mode, projectOnly, onClose }) => ({
    title: `${mode === 'export' ? 'Export' : 'Import'} ${projectOnly ? 'project' : 'workspace'}`,
    onClose,
    finalFocus: () => document.getElementById('workspace-settings-trigger'),
  }),
);
const AppearancePanel = lazy(() => import('./AppearancePanel'));
import ProjectBrowser from './ProjectBrowser';
const ProjectSwitcherDialog = onDemandDialog(
  () => import('./ProjectSwitcherDialog'),
  ({ trigger, onOpenChange }) => ({
    title: 'Projects',
    onClose: () => onOpenChange(false),
    finalFocus: trigger,
  }),
);
import {
  WorkspaceSkeleton,
  PreviewSkeleton,
  TimelineSkeleton,
  StoryboardSkeleton,
} from './LoadingState';
type Artifact = ExportResult & { dispose: () => Promise<void> };

export function Workspace() {
  usePageZoomGuard();
  const { dark } = useAppearance();
  const {
    narrow,
    mobileTab,
    setMobileTab,
    selectMobileTab,
    composerFocused,
    onMediaFocus,
    onMediaBlur,
    mediaTriggerRef,
    mediaLoaded,
    drawer,
    setMediaOverride,
    toggleMedia,
    toggleChat,
    visibleChatCollapsed,
    chatCollapsed,
    format,
    setFormat,
  } = useWorkspaceLayout();
  const header = useRef<HTMLElement>(null);
  const [projectTab, setProjectTab] = useState<ProjectTab>('editor');
  const [storyboardLoaded, setStoryboardLoaded] = useState(false);
  const chooseProjectTab = (tab: ProjectTab) => {
    if (tab === 'storyboard') {
      setStoryboardLoaded(true);
      previewControls.current?.pause();
    }
    setProjectTab(tab);
    if (narrow) setMobileTab('edit');
  };
  const [transfer, setTransfer] = useState<{
    mode: 'export' | 'import';
    projectOnly?: boolean;
    projectId?: string;
  } | null>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const closeAppearance = () => {
    setAppearanceOpen(false);
    document.getElementById('workspace-settings-trigger')?.focus();
  };
  const [editor, setEditor] = useState<Editor | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const captureQueue = useRef<Promise<Editor['tasks']> | null>(null);
  const [captureOwner, setCaptureOwner] = useState<Pick<
    Editor,
    'tasks'
  > | null>(null);
  const queueOwner = editor ?? captureOwner;
  const {
    project,
    assets,
    getProjectId,
    activate,
    clear: clearProject,
    refresh: refreshProject,
  } = useWorkspaceProject(editorRef);
  const { route, routeKey, go } = useWorkspaceRoute({ restoreRecent: true });
  const projectsOpen = route.screen === 'projects';
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false);
  const projectSwitcherTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!header.current) {
      document.documentElement.style.setProperty(
        '--workspace-header-height',
        '0px',
      );
      return;
    }
    const measure = () =>
      document.documentElement.style.setProperty(
        '--workspace-header-height',
        `${header.current!.offsetHeight}px`,
      );
    const observer = new ResizeObserver(measure);
    observer.observe(header.current);
    measure();
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty(
        '--workspace-header-height',
      );
    };
  }, [narrow, projectsOpen]);

  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<ProjectVersionInfo[]>([]);
  const [browsed, setBrowsed] = useState<ProjectVersion | null>(null);
  const [versionAssets, setVersionAssets] = useState<Asset[]>([]);
  const browsing = useRef(false);
  const viewProject = browsed?.project ?? project;
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [indexConnection, setIndexConnection] =
    useState<IndexConnection | null>(null);
  const [selected, setSelected] = useState<string>();
  const [selection, setSelection] = useState<string[]>([]);
  const selectedIds = selectionIds(viewProject, [
    ...(selected ? [selected] : []),
    ...selection,
  ]);
  const selectClip = (id: string, additive = false) => {
    const members = selectionIds(viewProject, [id]);
    const alreadySelected = members.every((member) =>
      selectedIds.includes(member),
    );
    const next = additive
      ? alreadySelected
        ? selectedIds.filter((member) => !members.includes(member))
        : [...new Set([...selectedIds, ...members])]
      : members;
    setSelection(next);
    setSelected(next.includes(id) ? id : next[0]);
  };
  const [playbackPosition] = useState(createPlaybackPosition);
  const [timeUs, setPausedTimeUs] = useState(0);
  const setTimeUs = useCallback(
    (value: number | ((previous: number) => number)) => {
      const next =
        typeof value === 'function'
          ? value(playbackPosition.getSnapshot())
          : value;
      playbackPosition.publish(next);
      setPausedTimeUs(next);
    },
    [playbackPosition],
  );
  const [seekRevision, setSeekRevision] = useState(0);
  const [dialog, setDialogState] = useState<DialogName>(null);
  const [propertiesOpener, setPropertiesOpener] = useState<HTMLElement | null>(
    null,
  );
  const setDialog = useCallback(
    (next: DialogName) => {
      setDialogState(next);
      if (next !== 'properties') setPropertiesOpener(null);
    },
    [setDialogState, setPropertiesOpener],
  );
  const commandRequest = useRef(0);
  const commandCompleted = useRef(0);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [paletteCommands, setPaletteCommands] = useState<
    WorkspaceCommand[] | null
  >(null);
  const changeCommandsOpen = useCallback((open: boolean) => {
    if (!open) commandRequest.current++;
    setCommandsOpen(open);
  }, []);
  const conversationControls = useRef<ConversationControls>(null);
  const pendingAISettings = useRef(false);
  const registerConversationControls = useCallback(
    (controls: ConversationControls | null) => {
      conversationControls.current = controls;
      if (controls && pendingAISettings.current) {
        pendingAISettings.current = false;
        controls.openSettings();
      }
    },
    [],
  );
  const showAISettings = () => {
    if (conversationControls.current)
      conversationControls.current.openSettings();
    else pendingAISettings.current = true;
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [operationBusy, setBusy] = useState(false);
  const recordingRouteKey = JSON.stringify([
    routeKey,
    route.screen,
    route.screen === 'invalid' ? undefined : route.projectId,
  ]);
  const [recordingRoute, setRecordingRoute] = useState<string | null>(null);
  const [recordingAdding, setRecordingAdding] = useState(false);
  if (
    recordingRoute !== null &&
    (recordingRoute !== recordingRouteKey || route.screen !== 'editor')
  ) {
    // Creating the recording's first project changes the URL during import.
    // Preserve its review/retry UI only for that same active project; other
    // navigation retires the capture even when Back returns to an old route key.
    setRecordingRoute(
      recordingAdding &&
        route.screen === 'editor' &&
        route.projectId === project?.id
        ? recordingRouteKey
        : null,
    );
  }
  const [progress, setProgress] = useState<Progress | null>(null);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [exportError, setExportError] = useState('');
  const previewControls = useRef<PreviewControls>(null);
  const storyboardControls = useRef<StoryboardControls>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const instance = useRef<Promise<Editor> | null>(null);
  const currentJob = useRef<{ cancel(): void } | null>(null);
  const cancelRequested = useRef(false);
  const artifactRef = useRef<Artifact | null>(null);
  const alive = useRef(true);
  const lock = useRef(false);
  const unsubscribeVersions = useRef<(() => void) | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const disposeAssistant = useRef<(() => Promise<void>) | null>(null);
  const registerCleanup = useCallback((cleanup: () => Promise<void>) => {
    disposeAssistant.current = cleanup;
  }, []);
  const [errorReport, setErrorReport] = useState<ErrorReport | null>(null);
  useLayoutEffect(() => subscribeErrorDetails(setErrorReport), []);
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
      showErrorToast(
        value,
        'Project changed. Review the latest values and try again.',
      );
      return;
    }
    const message =
      value instanceof Error
        ? value.message
        : 'The operation could not be completed.';
    showErrorToast(
      value,
      message.length > 240
        ? 'The editor could not accept those settings. Check the values and try again.'
        : message,
    );
  }, []);
  const refresh = useCallback(async () => {
    const snapshot = await refreshProject();
    if (!snapshot || !alive.current) return;
    if (!browsing.current) {
      setSelection((previous) =>
        previous.filter((id) =>
          snapshot.tracks.some((t) => t.clips.some((c) => c.id === id)),
        ),
      );
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
  }, [refreshProject, setTimeUs, setSelection, setSelected]);
  const ensureTasks = useCallback(async () => {
    if (editorRef.current) return editorRef.current.tasks;
    captureQueue.current ??= import('../editor')
      .then(({ TaskQueue }) => {
        const tasks = new TaskQueue('localcut');
        if (!alive.current) throw new Error('Workspace closed');
        tasks.start();
        setCaptureOwner({ tasks });
        return tasks;
      })
      .catch((failure) => {
        captureQueue.current = null;
        throw failure;
      });
    return captureQueue.current;
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
          if (event.projectId !== getProjectId()) return;
          if (event.error) error(event.error);
          else
            void engine.projects.versions
              .list(event.projectId)
              .then((value) => {
                if (alive.current && event.projectId === getProjectId())
                  setVersions(value);
              })
              .catch(error);
        });
        unsubscribe.current = engine.events.projects((event) => {
          if (event.projectId !== getProjectId()) return;
          if (event.type === 'deleted') {
            clearProject();
            browsing.current = false;
            setBrowsed(null);
            setVersionsOpen(false);
            setVersions([]);
            setSelected(undefined);
            setSelection([]);
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
  }, [refresh, error, clearProject, getProjectId]);
  const catalog = useProjectCatalog(
    projectsOpen || projectSwitcherOpen,
    editor,
    ensureEditor,
    error,
  );
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
        await captureQueue.current
          ?.then((tasks) => tasks.dispose())
          .catch(() => {});
      })();
    },
    [],
  );
  const action = async (work: () => Promise<void>) => {
    if (lock.current) return false;
    lock.current = true;
    cancelRequested.current = false;
    setBusy(true);
    try {
      await work();
      return true;
    } catch (failure) {
      if (
        failure &&
        typeof failure === 'object' &&
        'code' in failure &&
        failure.code === 'REVISION_CONFLICT'
      )
        await refresh().catch(error);
      if (alive.current) error(failure);
      return false;
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
  const resetProjectView = useCallback(() => {
    browsing.current = false;
    setBrowsed(null);
    setVersionsOpen(false);
    setVersions([]);
    setVersionAssets([]);
    setSelected(undefined);
    setSelection([]);
    setTimeUs(0);
    setDialog(null);
    setAppearanceOpen(false);
    previewControls.current?.pause();
  }, [setTimeUs, setDialog, setSelected, setSelection]);
  const openProject = useCallback(
    async (snapshot: Project, signal?: AbortSignal, updateRoute = true) => {
      const startingUrl = window.location.href;
      const current = () =>
        alive.current &&
        !signal?.aborted &&
        (!updateRoute || window.location.href === startingUrl);
      const engine = await ensureEditor();
      const previousId = getProjectId();
      if (previousId) await engine.projects.versions.save(previousId);
      await engine.projects.open(snapshot.id);
      const next = await readWorkspaceProject(engine, snapshot.id);
      if (!current()) return;
      await artifactRef.current?.dispose();
      if (!current()) return;
      artifactRef.current = null;
      setArtifact(null);
      setExportError('');
      resetProjectView();
      activate(next);
      rememberProject(next.project.id);
      if (updateRoute) go('editor', snapshot.id);
      requestAnimationFrame(() => {
        if (!alive.current || getProjectId() !== snapshot.id) return;
        const target = document.querySelector<HTMLElement>(
          '[data-editor-shortcuts]',
        );
        if (target?.getClientRects().length && !target.closest('[inert]'))
          target.focus();
      });
    },
    [ensureEditor, getProjectId, activate, go, resetProjectView],
  );
  const restoreProject = useCallback(
    async (id: string | undefined, signal: AbortSignal) => {
      previewControls.current?.pause();
      setRecordingRoute(null);
      setProjectSwitcherOpen(false);
      setDialog(null);
      setTransfer(null);
      changeCommandsOpen(false);
      setSettingsOpen(false);
      setAppearanceOpen(false);
      if (id) {
        const engine = await ensureEditor();
        const snapshot = await engine.projects.snapshot(id);
        if (!signal.aborted) await openProject(snapshot, signal, false);
      } else {
        const engine = editorRef.current;
        const previousId = getProjectId();
        if (engine && previousId)
          await engine.projects.versions.save(previousId);
        if (signal.aborted || !alive.current) return;
        await artifactRef.current?.dispose();
        if (signal.aborted || !alive.current) return;
        artifactRef.current = null;
        setArtifact(null);
        setExportError('');
        resetProjectView();
        clearProject();
      }
    },
    [
      ensureEditor,
      openProject,
      getProjectId,
      clearProject,
      resetProjectView,
      setDialog,
      changeCommandsOpen,
      setSettingsOpen,
      setTransfer,
      setRecordingRoute,
    ],
  );
  const navigation = useProjectNavigation({
    route,
    routeKey,
    currentProjectId: project?.id,
    enabled: !operationBusy,
    restore: restoreProject,
  });
  const busy = operationBusy || navigation.blocked;
  useLayoutEffect(() =>
    registerErrorSession(() => ({
      projectId: project?.id ?? null,
      revision: project?.revision ?? null,
      projectFormat: project
        ? {
            width: project.width,
            height: project.height,
            frameRate: project.frameRate,
          }
        : null,
      selectedClipIds: selectedIds,
      playheadUs: playbackPosition.getSnapshot(),
      projectTab,
      mobileTab,
      narrow,
      mediaOpen: drawer,
      chatCollapsed,
      viewingVersionId: browsed?.id ?? null,
      busy,
      trackCount: viewProject?.tracks.length ?? 0,
      clipCount:
        viewProject?.tracks.reduce(
          (count, track) => count + track.clips.length,
          0,
        ) ?? 0,
    })),
  );
  const [mediaDrag, setMediaDrag] = useState<{
    assetId: string;
    projectId: string;
    revision: number;
  } | null>(null);
  const draggingAsset =
    !busy &&
    !browsed &&
    mediaDrag?.projectId === project?.id &&
    mediaDrag?.revision === project?.revision
      ? (assets.find(
          (asset) =>
            asset.id === mediaDrag?.assetId && asset.status === 'ready',
        ) ?? null)
      : null;
  if (mediaDrag && !draggingAsset) setMediaDrag(null);
  const dropAsset = (trackId: string, startUs: number) => {
    const asset = draggingAsset;
    setMediaDrag(null);
    if (!asset || !project) return;
    const track = project.tracks.find((track) => track.id === trackId);
    if (
      track?.locked ||
      track?.kind !== (asset.kind === 'audio' ? 'audio' : 'video')
    )
      return;
    const clip = assetClip(project, asset, startUs);
    void action(async () => {
      await apply([{ type: 'insertClip', trackId, clip }]);
      setSelected(clip.id);
      setSelection([]);
    });
  };
  const apply = async (
    operations: EditOperation[],
    scope?: { projectId: string; revision: number },
  ) => {
    if (browsing.current)
      throw new Error('Return to the current version to edit.');
    if (!project) throw new Error('Create or open a project first.');
    const engine = await ensureEditor();
    if (
      scope &&
      (scope.projectId !== project.id || scope.revision !== project.revision)
    )
      throw new Error('The project changed. Try again.');
    if (project.id !== getProjectId())
      throw new Error('The active project changed. Try again.');
    await engine.commands.apply({
      projectId: project.id,
      expectedRevision: project.revision,
      requestId: crypto.randomUUID(),
      operations,
    });
    await refresh();
  };
  const { importMedia, importBatch, dismissImportBatch } = useMediaImport({
    busy,
    browsing,
    alive,
    lock,
    action,
    ensureEditor,
    getProjectId,
    openProject,
    refresh,
    error,
    revealMedia: () => setMediaOverride(true),
  });
  const fileHovering = useFileDrop(
    !busy && !browsed,
    (files, directories, folderId) => {
      if (narrow) selectMobileTab('media');
      void importMedia(files, folderId, directories);
    },
    project?.id ?? null,
  );
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
  const playheadInsideSelection = usePlaybackRange(
    playbackPosition,
    selectedClip?.startUs,
    selectedClip ? selectedClip.startUs + selectedClip.durationUs : undefined,
  );
  const selectionLocked = !!viewProject?.tracks.some(
    (track) =>
      track.locked && track.clips.some((clip) => selectedIds.includes(clip.id)),
  );
  const seek = (value: number) => {
    setTimeUs(value);
    setSeekRevision((value) => value + 1);
  };
  const showProjectSwitcher = () => {
    if (lock.current) return;
    previewControls.current?.pause();
    setDialog(null);
    setAppearanceOpen(false);
    setProjectSwitcherOpen(true);
  };
  const showProjects = () => {
    if (lock.current) return;
    previewControls.current?.pause();
    setDialog(null);
    setAppearanceOpen(false);
    setProjectSwitcherOpen(false);
    go('projects', getProjectId() ?? undefined);
    if (projectsOpen) void catalog.refresh();
  };
  const returnToEditor = () => {
    go('editor', getProjectId() ?? undefined);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('[data-editor-shortcuts]')?.focus(),
    );
  };
  const beginTransfer = (value: NonNullable<typeof transfer>) => {
    void action(async () => {
      if (
        storyboardControls.current &&
        !(await storyboardControls.current.flush())
      )
        return;
      setTransfer(value);
    });
  };
  const backupProject = () =>
    void action(async () => {
      if (!project) return;
      if (
        storyboardControls.current &&
        !(await storyboardControls.current.flush())
      )
        return;
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
      if (
        storyboardControls.current &&
        !(await storyboardControls.current.flush())
      )
        return;
      await editor.projects.versions.save(project.id);
      setVersions(await editor.projects.versions.list(project.id));
      setVersionsOpen(true);
    });
  const browseVersion = (id: string) =>
    void action(async () => {
      if (!project || !editor) return;
      if (
        storyboardControls.current &&
        !(await storyboardControls.current.flush())
      )
        return;
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
      setRecordingRoute(null);
      browsing.current = true;
      setBrowsed(version);
      setVersionAssets(media);
      setSelected(undefined);
      setSelection([]);
      seek(0);
      setDialog(null);
    });
  const leaveVersion = () =>
    void action(async () => {
      await refresh();
      browsing.current = false;
      setBrowsed(null);
      setSelected(undefined);
      setSelection([]);
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
      setSelection([]);
      seek(0);
    });
  const showExport = () => {
    setExportError('');
    setDialog('export');
  };
  const openSettings = () => {
    setSettingsLoaded(true);
    setSettingsOpen(true);
  };
  const addText = () => {
    if (project && !browsed) setDialog('text');
  };
  const {
    undo,
    redo,
    split,
    deleteClip,
    addTrack,
    reorderTrack,
    trackOperation,
    insertText,
    duplicate,
    canGroup,
    group,
    ungroup,
    canSeparate,
    separateAudio,
    overlap,
    activeTransition,
    setTransition,
    canSplit,
    clearSelection,
    selectAll,
    copy,
    cut,
    paste,
    editSelection,
    trimStartOperations,
    trimEndOperations,
    rippleOperations,
    clipboard,
    selectedGroups,
  } = useTimelineEditing({
    project,
    viewProject,
    selectedClip,
    selected,
    selectedIds,
    assets,
    busy,
    browsed: !!browsed,
    browsing,
    selectionLocked,
    playheadInsideSelection,
    playbackPosition,
    action,
    apply,
    ensureEditor,
    refresh,
    setDialog,
    setSelected,
    setSelection,
  });
  const shortcutActions: Partial<
    Record<EditorShortcut, (event?: KeyboardEvent) => void>
  > = {
    playPause: total
      ? () => previewControls.current?.togglePlayback()
      : undefined,
    save:
      project && !browsed
        ? () =>
            void action(async () => {
              await editor!.projects.versions.save(project.id);
              toast.success('Project saved');
            })
        : undefined,
    play: total ? () => previewControls.current?.play() : undefined,
    pause: total ? () => previewControls.current?.pause() : undefined,
    previousCut:
      viewProject && total
        ? () =>
            seek(
              Math.min(
                editBoundary(viewProject, playbackPosition.getSnapshot(), -1),
                frameStep(total, 0, viewProject.frameRate, total),
              ),
            )
        : undefined,
    nextCut:
      viewProject && total
        ? () =>
            seek(
              Math.min(
                editBoundary(viewProject, playbackPosition.getSnapshot(), 1),
                frameStep(total, 0, viewProject.frameRate, total),
              ),
            )
        : undefined,
    zoomIn: total ? () => dispatchViewCommand('zoomIn') : undefined,
    zoomOut: total ? () => dispatchViewCommand('zoomOut') : undefined,
    zoomFit: total ? () => dispatchViewCommand('zoomFit') : undefined,
    selectAll: total ? selectAll : undefined,
    clearSelection: selectedIds.length ? clearSelection : undefined,
    copy: selectedIds.length && !browsed ? copy : undefined,
    cut: selectedIds.length && !browsed && !selectionLocked ? cut : undefined,
    paste:
      project && clipboard?.projectId === project.id && !browsed
        ? paste
        : undefined,
    nudgeLeft:
      selectedIds.length && !browsed && !selectionLocked
        ? () => editSelection(nudgeSelection(project!, selectedIds, -1))
        : undefined,
    nudgeRight:
      selectedIds.length && !browsed && !selectionLocked
        ? () => editSelection(nudgeSelection(project!, selectedIds, 1))
        : undefined,
    nudgeTenLeft:
      selectedIds.length && !browsed && !selectionLocked
        ? () => editSelection(nudgeSelection(project!, selectedIds, -10))
        : undefined,
    nudgeTenRight:
      selectedIds.length && !browsed && !selectionLocked
        ? () => editSelection(nudgeSelection(project!, selectedIds, 10))
        : undefined,
    trimStart:
      trimStartOperations.length && !browsed
        ? () =>
            editSelection(
              trimAtPlayhead(
                selectedClip!,
                playbackPosition.getSnapshot(),
                'start',
              ),
              true,
            )
        : undefined,
    trimEnd:
      trimEndOperations.length && !browsed
        ? () =>
            editSelection(
              trimAtPlayhead(
                selectedClip!,
                playbackPosition.getSnapshot(),
                'end',
              ),
              true,
            )
        : undefined,
    rippleDelete:
      rippleOperations.length &&
      !browsed &&
      !viewProject?.tracks.some((track) => track.locked)
        ? () => editSelection(rippleOperations, true)
        : undefined,
    properties: total
      ? (event) => {
          const id =
            event?.target instanceof Element
              ? event.target.closest<HTMLElement>('.timeline-clip')?.dataset
                  .clipId
              : undefined;
          if (id) {
            selectClip(id);
            setDialog('properties');
          } else if (selectedClip) setDialog('properties');
        }
      : undefined,
    previousFrame: project
      ? () =>
          seek(
            frameStep(
              playbackPosition.getSnapshot(),
              -1,
              viewProject!.frameRate,
              total,
            ),
          )
      : undefined,
    nextFrame: project
      ? () =>
          seek(
            frameStep(
              playbackPosition.getSnapshot(),
              1,
              viewProject!.frameRate,
              total,
            ),
          )
      : undefined,
    previousTenFrames: project
      ? () =>
          seek(
            frameStep(
              playbackPosition.getSnapshot(),
              -10,
              viewProject!.frameRate,
              total,
            ),
          )
      : undefined,
    nextTenFrames: project
      ? () =>
          seek(
            frameStep(
              playbackPosition.getSnapshot(),
              10,
              viewProject!.frameRate,
              total,
            ),
          )
      : undefined,
    start: project ? () => seek(0) : undefined,
    end: project
      ? () => seek(frameStep(total, 0, viewProject!.frameRate, total))
      : undefined,
    split: canSplit && !browsed ? split : undefined,
    delete:
      selectedClip && !browsed && !selectionLocked ? deleteClip : undefined,
    duplicate:
      selectedClip && !browsed && !selectionLocked ? duplicate : undefined,
    group: canGroup && !browsed ? group : undefined,
    ungroup:
      selectedGroups.length && !browsed && !selectionLocked
        ? ungroup
        : undefined,
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
  };
  useEditorShortcuts({
    enabled: !busy,
    actions: projectsOpen
      ? {
          openProject: showProjects,
          commands: () => showCommands(),
          shortcuts: () => setDialog('shortcuts'),
        }
      : shortcutActions,
  });
  const showCommands = () => {
    const token = ++commandRequest.current;
    setPaletteCommands(null);
    setCommandsOpen(true);
    void Promise.all([
      import('./workspace-command-list'),
      CommandPalette.preload(),
    ])
      .then(([{ workspaceCommands }]) => {
        if (!alive.current || token !== commandRequest.current) return;
        setPaletteCommands(
          workspaceCommands(
            [
              projectsOpen,
              busy,
              project,
              browsed,
              viewProject,
              versionAssets,
              assets,
              !!selectedClip,
              selectedGroups.length > 0,
              !!overlap,
              !!activeTransition,
              total,
              canSplit,
              canSeparate,
              canGroup,
              playbackPosition.getSnapshot(),
              versions,
              versionsOpen,
              format,
              narrow ? mobileTab !== 'chat' : chatCollapsed,
              drawer,
              appearanceOpen,
              setDialog,
              showProjects,
              returnToEditor,
              () => backupInput.current?.click(),
              beginTransfer,
              setAppearanceOpen,
              seek,
              backupProject,
              () => fileInput.current?.click(),
              relinkMedia,
              undo,
              redo,
              split,
              deleteClip,
              duplicate,
              separateAudio,
              group,
              ungroup,
              setTransition,
              addText,
              selectClip,
              () => previewControls.current?.togglePlayback(),
              showVersions,
              browseVersion,
              leaveVersion,
              restoreVersion,
              setVersionsOpen,
              showExport,
              setFormat,
              toggleChat,
              toggleMedia,
              closeAppearance,
              openSettings,
              () => conversationControls.current?.commands() ?? [],
            ],
            shortcutActions,
          ),
        );
        commandCompleted.current = token;
      })
      .catch((failure) => {
        if (!alive.current || token !== commandRequest.current) return;
        changeCommandsOpen(false);
        error(failure);
      });
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
  const mediaToggle = (
    <Button
      className="media-toggle"
      id="desktop-media-trigger"
      ref={mediaTriggerRef}
      variant="ghost"
      size="icon-sm"
      aria-label={drawer ? 'Collapse media' : 'Expand media'}
      aria-expanded={drawer}
      aria-controls="workspace-media-content"
      onClick={toggleMedia}
    >
      {drawer ? <PanelLeftClose /> : <Files />}
    </Button>
  );
  const headerActions = (
    <div className="header-actions">
      {queueOwner && (
        <Suspense fallback={null}>
          <TaskQueueControl editor={queueOwner} />
        </Suspense>
      )}
      <NotificationControl />
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
            hasProject={!!project && !projectsOpen}
            canExport={!!total && !projectsOpen}
            canBrowseVersions={!!project && !busy && !projectsOpen}
            mediaOpen={drawer}
            chatCollapsed={narrow ? mobileTab !== 'chat' : chatCollapsed}
            format={format}
            onNew={() => setDialog('new')}
            onOpen={showProjects}
            onBackup={backupProject}
            onImportBackup={() => backupInput.current?.click()}
            onToggleMedia={toggleMedia}
            onToggleChat={toggleChat}
            onExport={showExport}
            onVersions={showVersions}
            onFormatChange={setFormat}
            onProjectExport={() =>
              beginTransfer({
                mode: 'export',
                projectOnly: true,
                projectId: project?.id,
              })
            }
            onProjectImport={() =>
              beginTransfer({ mode: 'import', projectOnly: true })
            }
            onWorkspaceExport={() => beginTransfer({ mode: 'export' })}
            onWorkspaceImport={() => beginTransfer({ mode: 'import' })}
            onAppearance={() => setAppearanceOpen(true)}
            onShortcuts={() => setDialog('shortcuts')}
            onCommands={showCommands}
            onAISettings={showAISettings}
          />
        </Suspense>
      ) : (
        settingsTrigger
      )}
    </div>
  );
  const mediaPanel = (
    <aside
      className="media-panel"
      id="workspace-media"
      tabIndex={-1}
      aria-label="Media library"
      data-collapsed={!drawer}
      onFocusCapture={onMediaFocus}
      onBlurCapture={onMediaBlur}
    >
      {!narrow && (
        <Suspense fallback={mediaToggle}>
          <Tooltip content={drawer ? 'Collapse media' : 'Open media'}>
            {mediaToggle}
          </Tooltip>
        </Suspense>
      )}
      <div
        id="workspace-media-content"
        className="media-content"
        inert={!drawer}
        aria-hidden={!drawer}
      >
        {mediaLoaded && (
          <Suspense
            fallback={
              <div className="media-library" role="status">
                <LoaderCircle
                  className="animate-spin"
                  aria-label="Loading media"
                />
              </div>
            }
          >
            <MediaLibrary
              key={project?.id}
              projectId={project?.id}
              editor={editor}
              indexConnection={indexConnection}
              readOnly={!!browsed || navigation.blocked}
              assets={browsed ? versionAssets : assets}
              canEdit={!busy && !browsed}
              draggingAssetId={draggingAsset?.id ?? null}
              onImport={() => fileInput.current?.click()}
              onImportFiles={importMedia}
              onLibraryChanged={refresh}
              onSpeech={
                speechAvailable
                  ? () => conversationControls.current?.openSpeech()
                  : undefined
              }
              headerActions={
                narrow && mobileTab === 'media' ? headerActions : null
              }
              onRecord={() => {
                previewControls.current?.pause();
                setRecordingRoute(recordingRouteKey);
              }}
              onRelink={relinkMedia}
              onRename={async (asset, name) => {
                if (
                  browsing.current ||
                  busy ||
                  !project ||
                  project.id !== getProjectId()
                )
                  throw new Error('Return to the current project to edit.');
                const engine = await ensureEditor();
                await engine.assets.rename(asset.id, name, asset.name);
                await refresh();
              }}
              onDelete={async (asset) => {
                if (busy)
                  throw new Error('Wait for the current operation to finish.');
                const clips =
                  project?.tracks
                    .flatMap((track) => track.clips)
                    .filter((clip) => clip.assetId === asset.id) ?? [];
                await apply(
                  clips.map((clip) => ({
                    type: 'removeClip',
                    clipId: clip.id,
                  })),
                );
                setSelected(undefined);
                setSelection([]);
              }}
              onAssetDrag={(assetId) =>
                setMediaDrag(
                  assetId && project
                    ? {
                        assetId,
                        projectId: project.id,
                        revision: project.revision,
                      }
                    : null,
                )
              }
            />
          </Suspense>
        )}
      </div>
    </aside>
  );
  const projectBrowser = (
    <ProjectBrowser
      embedded={projectSwitcherOpen}
      projects={catalog.projects}
      editor={editor}
      onRename={catalog.rename}
      onDetails={catalog.updateDetails}
      onExport={(id) => {
        setProjectSwitcherOpen(false);
        beginTransfer({ mode: 'export', projectOnly: true, projectId: id });
      }}
      currentProjectId={project?.id}
      busy={busy}
      navigationBusy={operationBusy}
      refreshing={catalog.pending}
      loaded={catalog.loaded}
      failed={catalog.failed}
      onOpen={(id) => {
        setProjectSwitcherOpen(false);
        if (id !== getProjectId()) go('editor', id);
        else if (projectsOpen) returnToEditor();
      }}
      onBack={returnToEditor}
      onRefresh={() => void catalog.refresh()}
      onNew={() => {
        setProjectSwitcherOpen(false);
        setDialog('new');
      }}
      onImport={() => {
        setProjectSwitcherOpen(false);
        backupInput.current?.click();
      }}
    />
  );
  return (
    <div
      className="workspace"
      data-chat-collapsed={visibleChatCollapsed}
      data-media-open={drawer}
      data-mobile-tab={mobileTab}
      data-mobile-editor={narrow && !projectsOpen}
      data-composer-focused={composerFocused}
    >
      {fileHovering && (
        <div className="asset-drop-overlay" role="status">
          <div className="asset-drop-indicator">
            <Upload aria-hidden="true" />
            <span>Drop assets to import</span>
          </div>
        </div>
      )}
      {(!narrow || projectsOpen) && (
        <header ref={header} className="workspace-header">
          <span className="brand">
            <Scissors aria-hidden="true" />
            <span className="brand-name">LocalCut</span>
          </span>
          {!busy && !projectsOpen && (
            <Button
              variant="ghost"
              className="project-picker"
              ref={projectSwitcherTrigger}
              aria-label="Open project"
              aria-haspopup="dialog"
              aria-expanded={projectSwitcherOpen}
              onClick={showProjectSwitcher}
            >
              <span className="project-picker-name">
                {viewProject?.name ?? 'Untitled project'}
              </span>
              <span className="sr-only">Projects</span>
            </Button>
          )}
          {headerActions}
          {!projectsOpen && project && (
            <ProjectTabs value={projectTab} onChange={chooseProjectTab} />
          )}
        </header>
      )}
      {projectSwitcherOpen && (
        <Suspense fallback={null}>
          <ProjectSwitcherDialog
            trigger={projectSwitcherTrigger}
            onOpenChange={setProjectSwitcherOpen}
          >
            {projectBrowser}
          </ProjectSwitcherDialog>
        </Suspense>
      )}
      <div
        className="workspace-body"
        data-appearance-open={appearanceOpen}
        data-projects-open={projectsOpen || navigation.blocked}
      >
        {navigation.blocked && (!projectsOpen || navigation.error) && (
          <section
            className="project-browser"
            aria-label="Project navigation"
            aria-busy={navigation.loading}
          >
            <div className="project-browser-inner space-y-4">
              {navigation.error ? (
                <>
                  <p role="alert">{navigation.error}</p>
                  <div className="flex gap-2">
                    {route.screen !== 'invalid' && (
                      <Button onClick={navigation.retry}>Try again</Button>
                    )}
                    <Button variant="outline" onClick={() => go('projects')}>
                      Open saved projects
                    </Button>
                  </div>
                </>
              ) : (
                <WorkspaceSkeleton label="Opening project" />
              )}
            </div>
          </section>
        )}
        {projectsOpen && !navigation.error && projectBrowser}
        <Suspense
          fallback={
            <div className="workspace-columns">
              <WorkspaceSkeleton label="Loading workspace" />
            </div>
          }
        >
          <WorkspacePanels
            narrow={narrow}
            inert={projectsOpen || navigation.blocked}
            chatCollapsed={visibleChatCollapsed}
            mediaOpen={drawer}
            onCollapseChat={toggleChat}
            onCollapseMedia={toggleMedia}
            media={mediaPanel}
            mobileTab={mobileTab}
          >
            <Suspense
              fallback={
                <aside
                  aria-label="Editing conversation"
                  data-collapsed={visibleChatCollapsed}
                  className="conversation-panel min-w-0 border-b bg-background lg:border-l lg:border-b-0"
                />
              }
            >
              <Conversation
                mobile={narrow}
                headerActions={
                  narrow && mobileTab === 'chat' ? headerActions : null
                }
                controlsRef={registerConversationControls}
                onIndexConnection={setIndexConnection}
                onSpeechAvailability={setSpeechAvailable}
                editor={editor}
                project={project}
                readOnly={!!browsed || navigation.blocked}
                selectedClipId={selected}
                onApplied={refresh}
                onNewProject={() => setDialog('new')}
                onOpenProjects={showProjects}
                onError={error}
                registerCleanup={registerCleanup}
                collapsed={visibleChatCollapsed}
                active={!narrow || mobileTab === 'chat'}
                onToggle={toggleChat}
              />
            </Suspense>
            <main
              id="workspace-editor"
              className="editing-area"
              data-editor-shortcuts={projectTab === 'editor' ? '' : undefined}
              tabIndex={0}
              aria-label={
                projectTab === 'editor'
                  ? 'Video editor'
                  : 'Storyboard workspace'
              }
            >
              {narrow && (
                <Suspense
                  fallback={
                    <header
                      className="mobile-edit-heading panel-header"
                      aria-busy="true"
                    />
                  }
                >
                  <PanelHeader
                    className="mobile-edit-heading"
                    label="Edit"
                    title={
                      <Button
                        variant="ghost"
                        className="project-picker"
                        ref={projectSwitcherTrigger}
                        aria-label="Open project"
                        aria-haspopup="dialog"
                        aria-expanded={projectSwitcherOpen}
                        onClick={showProjectSwitcher}
                      >
                        <span className="project-picker-name">
                          {viewProject?.name ?? 'Edit'}
                        </span>
                      </Button>
                    }
                  >
                    {mobileTab === 'edit' ? headerActions : null}
                    {project && (
                      <ProjectTabs
                        value={projectTab}
                        onChange={chooseProjectTab}
                      />
                    )}
                  </PanelHeader>
                </Suspense>
              )}
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
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={restoreVersion}
                      >
                        Restore as new version
                      </Button>
                    </div>
                  )}
                </section>
              )}
              <div
                id="project-editor-panel"
                role="tabpanel"
                aria-labelledby="project-editor-tab"
                className="project-view-panel"
                hidden={projectTab !== 'editor'}
                inert={projectTab !== 'editor'}
              >
                <EditorPanels narrow={narrow}>
                  <Suspense fallback={<PreviewSkeleton />}>
                    <Preview
                      controlsRef={previewControls}
                      editor={editor}
                      project={viewProject}
                      versionId={browsed?.id}
                      timeUs={timeUs}
                      position={playbackPosition}
                      seekRevision={seekRevision}
                      onTime={setTimeUs}
                      onImport={() => fileInput.current?.click()}
                      onError={error}
                    />
                  </Suspense>
                  <Suspense fallback={<TimelineSkeleton />}>
                    <Timeline
                      editor={editor}
                      project={viewProject}
                      assets={browsed ? versionAssets : assets}
                      versionId={browsed?.id}
                      readOnly={!!browsed || navigation.blocked}
                      selected={selectedIds}
                      position={playbackPosition}
                      busy={busy}
                      onSelect={selectClip}
                      canGroup={canGroup}
                      canUngroup={!!selectedGroups.length}
                      canSeparate={canSeparate}
                      overlap={overlap}
                      transitionTemplate={
                        activeTransition?.templateId ?? activeTransition?.kind
                      }
                      onSelectOverlap={(from, to) => {
                        setSelected(from);
                        setSelection(selectionIds(viewProject, [from, to]));
                      }}
                      onGroup={group}
                      onUngroup={ungroup}
                      onSeparate={separateAudio}
                      onTransition={setTransition}
                      onTime={seek}
                      onUndo={undo}
                      onRedo={redo}
                      onSplit={split}
                      onDelete={deleteClip}
                      onProperties={(clipId, opener) => {
                        setPropertiesOpener(opener ?? null);
                        if (clipId) selectClip(clipId);
                        setDialog('properties');
                      }}
                      onText={addText}
                      onAddTrack={addTrack}
                      onReorderTrack={reorderTrack}
                      draggingAsset={draggingAsset}
                      onDropAsset={dropAsset}
                      onResizeClip={(clipId, durationUs) =>
                        void action(async () => {
                          await apply([
                            { type: 'resizeClip', clipId, durationUs },
                          ]);
                        })
                      }
                      onMoveClips={trackOperation}
                      onTrackOperation={trackOperation}
                    />
                  </Suspense>
                </EditorPanels>
              </div>
              <div
                id="project-storyboard-panel"
                role="tabpanel"
                aria-labelledby="project-storyboard-tab"
                className="project-view-panel"
                hidden={projectTab !== 'storyboard'}
                inert={projectTab !== 'storyboard'}
              >
                {storyboardLoaded && editor && viewProject && (
                  <Suspense fallback={<StoryboardSkeleton />}>
                    <Storyboard
                      key={`${viewProject.id}:${browsed?.id ?? 'current'}`}
                      editor={editor}
                      controlsRef={storyboardControls}
                      project={viewProject}
                      readOnly={!!browsed || navigation.blocked}
                      active={projectTab === 'storyboard'}
                      onSaved={refresh}
                      onError={error}
                    />
                  </Suspense>
                )}
              </div>
            </main>
          </WorkspacePanels>
        </Suspense>

        {transfer && (
          <Suspense
            fallback={<div role="status">Loading workspace transfer…</div>}
          >
            <WorkspaceTransferDialog
              {...transfer}
              getEditor={ensureEditor}
              onBusyChange={setBusy}
              onImported={async () => {
                await catalog.refresh();
              }}
              onClose={() => {
                setTransfer(null);
                document.getElementById('workspace-settings-trigger')?.focus();
              }}
            />
          </Suspense>
        )}
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
      {narrow && !projectsOpen && !composerFocused && (
        <Suspense
          fallback={<div className="mobile-navigation" aria-busy="true" />}
        >
          <MobileNavigation
            activeTab={mobileTab}
            onSelect={selectMobileTab}
            mediaTriggerRef={mediaTriggerRef}
          />
        </Suspense>
      )}
      <input
        ref={fileInput}
        tabIndex={-1}
        className="sr-only"
        type="file"
        multiple
        accept="video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/x-wav,audio/webm,image/png,image/jpeg,image/webp"
        aria-label="Import media"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length) void importMedia(files);
        }}
      />
      <input
        ref={backupInput}
        tabIndex={-1}
        className="sr-only"
        type="file"
        accept=".json"
        aria-label="Import project backup"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file)
            void action(async () => {
              if (browsing.current && !projectsOpen) return;
              const engine = await ensureEditor();
              await openProject(
                await engine.projects.importJSON(await file.text()),
              );
            });
        }}
      />
      {queueOwner && (
        <Suspense fallback={null}>
          <TaskQueueNotifications editor={queueOwner} />
        </Suspense>
      )}
      {recordingRoute === recordingRouteKey &&
        !browsed &&
        !navigation.blocked && (
          <Suspense fallback={null}>
            <ScreenRecordingDialog
              getTasks={ensureTasks}
              onClose={() => setRecordingRoute(null)}
              onAdd={async (file) => {
                setRecordingAdding(true);
                try {
                  return await importMedia([file]);
                } finally {
                  setRecordingAdding(false);
                }
              }}
            />
          </Suspense>
        )}
      {(dialog || (busy && progress)) && (
        <Suspense fallback={null}>
          <WorkspaceDialogs
            dialog={dialog}
            propertiesOpener={propertiesOpener}
            busy={busy}
            project={viewProject}
            readOnly={!!browsed || navigation.blocked}
            selectedClip={selectedClip}
            assets={browsed ? versionAssets : assets}
            format={format}
            artifact={artifact}
            exportError={exportError}
            progress={progress}
            total={total}
            timeUs={playbackPosition.getSnapshot()}
            onDialogChange={setDialog}
            onCloseExport={closeExport}
            onStartExport={startExport}
            onFormatChange={setFormat}
            onCancelWork={cancelWork}
            onCreateProject={(name, settings) =>
              void action(async () => {
                const engine = await ensureEditor();
                await openProject(await engine.projects.create(name, settings));
              })
            }
            onInsertText={insertText}
            onTrackMask={(mask) =>
              editorRef.current!.masks.track(
                viewProject!.id,
                selectedClip!.id,
                viewProject!.revision,
                mask,
              )
            }
            onSaveProperties={(operations) =>
              void action(async () => {
                await apply(operations);
                setDialog(null);
              })
            }
          />
        </Suspense>
      )}
      {importBatch && (
        <Suspense fallback={null}>
          <ImportProgressDialog
            batch={importBatch}
            onClose={dismissImportBatch}
          />
        </Suspense>
      )}
      {commandsOpen && (
        <Suspense fallback={null}>
          {paletteCommands === null ? (
            <LoadingDialog
              title="Commands"
              onClose={() => changeCommandsOpen(false)}
              finalFocus={() =>
                document.getElementById('workspace-command-trigger')
              }
              handoff={() =>
                commandCompleted.current === commandRequest.current
              }
            />
          ) : (
            <CommandPalette
              open
              onOpenChange={changeCommandsOpen}
              commands={paletteCommands}
            />
          )}
        </Suspense>
      )}
      {errorReport && (
        <Suspense fallback={null}>
          <ErrorDetailsDialog
            key={errorReport.text}
            report={errorReport}
            onClose={() => setErrorReport(null)}
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
