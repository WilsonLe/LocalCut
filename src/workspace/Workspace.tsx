import { LoadingDialog, onDemandDialog } from './on-demand-dialog';
import type { StoryboardControls } from './Storyboard';
import { ProjectTabs } from './ProjectTabs';
import type { ProjectTab } from './ProjectTabs';
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
  X,
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
import { UpdateControl } from './UpdateControl';
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
import type { MobileTab } from './MobileNavigation';
const Tooltip = lazy(() =>
  import('../components/ui/tooltip').then(({ Tooltip }) => ({
    default: Tooltip,
  })),
);
import {
  copySelection,
  pasteSelection,
  nudgeSelection,
  trimAtPlayhead,
  rippleDeleteSelection,
  editBoundary,
} from './editing-actions';
import type { ClipClipboard } from './editing-actions';
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
import { selectionIds, transitionPairs } from '../core/timeline';
import type { TransitionTemplate } from '../core/timeline';
import { interfaceScale, useAppearance } from './appearance';
import { usePageZoomGuard } from './usePageZoomGuard';
import { useChatViewport } from './useChatViewport';
import { hasBlockingOverlay } from './overlays';
import { useFileDrop } from './useFileDrop';
import type { ImportBatch, ImportProgress } from './ImportProgressDialog';
const ImportProgressDialog = onDemandDialog(
  () => import('./ImportProgressDialog'),
  ({ onClose }) => ({ title: 'Import media', onClose }),
);
import {
  saveWorkspacePreferences,
  useWorkspacePreferences,
} from './preferences';
import {
  appendAsset,
  assetClip,
  downloadFile,
  projectDuration,
} from './helpers';

import type { TextStyleInput } from '../core/text-library';
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
  const scale = interfaceScale();
  const narrowQuery = `(max-width: ${750 * scale}px), (max-width: ${1000 * scale}px) and (max-height: ${500 * scale}px)`;
  const { preferences, saved: preferencesSaved } = useWorkspacePreferences();
  const { chatCollapsed, exportFormat: format } = preferences;
  // Imports can reveal media for this session without changing the user's layout.
  const [mediaOverride, setMediaOverride] = useState<boolean | null>(null);
  const [mediaPreference, setMediaPreference] = useState(preferences.mediaOpen);
  if (mediaPreference !== preferences.mediaOpen) {
    setMediaPreference(preferences.mediaOpen);
    setMediaOverride(null);
  }
  const header = useRef<HTMLElement>(null);
  const [narrow, setNarrow] = useState(
    () => window.matchMedia(narrowQuery).matches,
  );
  const [mobileTab, setMobileTab] = useState<MobileTab>('edit');
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
  const composerFocused = useChatViewport(
    narrow && mobileTab === 'chat',
    scale,
  );
  const previousMobileTab = useRef<MobileTab>('edit');
  const selectMobileTab = (tab: MobileTab) => {
    if (tab === mobileTab) return;
    if (tab === 'media') previousMobileTab.current = mobileTab;
    setMobileTab(tab);
    requestAnimationFrame(() => {
      if (
        !window.matchMedia(narrowQuery).matches ||
        document
          .querySelector('.workspace-columns')
          ?.getAttribute('data-mobile-tab') !== tab
      )
        return;
      document
        .querySelector('.workspace-body')
        ?.scrollTo({ top: 0, behavior: 'instant' });
      const target =
        tab === 'edit'
          ? document.getElementById('workspace-editor')
          : document.querySelector<HTMLElement>(
              tab === 'chat' ? '.conversation-toggle' : '.media-toggle',
            );
      target?.focus({ preventScroll: true });
    });
  };
  const closeMobileMedia = () => {
    selectMobileTab(previousMobileTab.current);
    requestAnimationFrame(() =>
      document.getElementById('mobile-media-trigger')?.focus(),
    );
  };
  const mediaHasFocus = useRef(false);
  const restoreMediaFocus = useRef(false);
  const mediaTriggerRef = useCallback((trigger: HTMLButtonElement | null) => {
    if (trigger && restoreMediaFocus.current) {
      requestAnimationFrame(() => {
        if (trigger.isConnected && restoreMediaFocus.current) {
          restoreMediaFocus.current = false;
          const active = document.activeElement;
          if (
            active === document.body ||
            active?.closest('[inert]') ||
            !active?.getClientRects().length
          )
            trigger.focus();
        }
      });
    }
    // React's ref cleanup runs before the focused fallback trigger is removed.
    // Reuse the responsive-focus owner when the lazy tooltip replaces it.
    return () => {
      if (trigger && document.activeElement === trigger)
        restoreMediaFocus.current = true;
    };
  }, []);
  useLayoutEffect(() => {
    const query = window.matchMedia(narrowQuery);
    const update = () => {
      // CSS may hide and blur the rail before this change event is delivered.
      restoreMediaFocus.current =
        mediaHasFocus.current ||
        !!document.activeElement?.closest('#workspace-media');
      mediaHasFocus.current = false;
      setNarrow(query.matches);
      document.documentElement.dataset.workspaceNarrow = String(query.matches);
      setMobileTab('edit');
    };
    update();
    query.addEventListener('change', update);
    return () => {
      query.removeEventListener('change', update);
      delete document.documentElement.dataset.workspaceNarrow;
    };
  }, [narrowQuery]);
  useLayoutEffect(() => {
    if (!restoreMediaFocus.current) return;
    const frame = requestAnimationFrame(() => {
      const trigger = document.getElementById(
        narrow ? 'mobile-media-trigger' : 'desktop-media-trigger',
      );
      if (trigger && restoreMediaFocus.current) {
        restoreMediaFocus.current = false;
        trigger.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [narrow]);
  const [mediaLoaded, setMediaLoaded] = useState(false);
  const drawer = narrow
    ? mobileTab === 'media'
    : (mediaOverride ?? preferences.mediaOpen);
  if (drawer && !mediaLoaded) setMediaLoaded(true);
  useEffect(() => {
    if (!narrow || mobileTab !== 'media') return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || hasBlockingOverlay()) return;
      event.preventDefault();
      event.stopPropagation();
      setMobileTab(previousMobileTab.current);
      requestAnimationFrame(() =>
        document.getElementById('mobile-media-trigger')?.focus(),
      );
    };
    document.addEventListener('keydown', escape, true);
    return () => document.removeEventListener('keydown', escape, true);
  }, [narrow, mobileTab]);
  const toggleMedia = () => {
    if (narrow) {
      if (mobileTab === 'media') closeMobileMedia();
      else selectMobileTab('media');
      return;
    }
    saveWorkspacePreferences({ mediaOpen: !drawer });
    setMediaOverride(null);
  };
  const toggleChat = () => {
    if (narrow) selectMobileTab(mobileTab === 'chat' ? 'edit' : 'chat');
    else saveWorkspacePreferences({ chatCollapsed: !chatCollapsed });
  };
  const visibleChatCollapsed = !narrow && chatCollapsed;
  const setFormat = (exportFormat: 'mp4' | 'webm') =>
    saveWorkspacePreferences({ exportFormat });
  useEffect(() => {
    if (!preferencesSaved)
      showErrorToast(
        undefined,
        'Workspace preferences could not be saved. Allow browser storage to keep them after reload.',
      );
  }, [preferencesSaved]);
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
  const [clipboard, setClipboard] = useState<ClipClipboard | null>(null);
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
  const [timeUs, setTimeUs] = useState(0);
  const [seekRevision, setSeekRevision] = useState(0);
  const [dialog, setDialog] = useState<DialogName>(null);
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
  const [importBatch, setImportBatch] = useState<ImportBatch | null>(null);
  const visibleImportBatch = useRef<string | null>(null);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [exportError, setExportError] = useState('');
  const previewControls = useRef<PreviewControls>(null);
  const storyboardControls = useRef<StoryboardControls>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const instance = useRef<Promise<Editor> | null>(null);
  const importPlacement = useRef<Promise<void>>(Promise.resolve());
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
      playheadUs: timeUs,
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
  const importMedia = async (files: File[]) => {
    if (!files.length || browsing.current || busy || lock.current) return false;
    const batchId = crypto.randomUUID();
    let added = 0;
    let engine: Editor | undefined;
    let targetProjectId: string | undefined;
    const jobs: {
      stop: () => void;
      result: Promise<{ asset: Asset } | { failure: unknown }>;
    }[] = [];
    const updateBatch = (update: (batch: ImportBatch) => ImportBatch) => {
      if (alive.current)
        setImportBatch((batch) =>
          batch?.id === batchId ? update(batch) : batch,
        );
    };
    const updateFile = (index: number, patch: Partial<ImportProgress>) => {
      updateBatch((batch) => ({
        ...batch,
        files: batch.files.map((file, position) =>
          position === index ? { ...file, ...patch } : file,
        ),
      }));
    };
    const started = await action(async () => {
      visibleImportBatch.current = batchId;
      setImportBatch({
        id: batchId,
        running: true,
        files: files.map((file) => ({ name: file.name, status: 'queued' })),
      });
      engine = await ensureEditor();
      if (!getProjectId())
        await openProject(await engine.projects.create('Untitled project'));
      targetProjectId = getProjectId() ?? undefined;
      if (!targetProjectId) throw new Error('Open a project to import media.');
      // Enqueue the entire selection before waiting. The engine owns scheduling,
      // persistence and cancellation; closing this dialog changes only view state.
      for (const [index, file] of files.entries()) {
        const job = engine.assets.import(file);
        const stop = job.subscribe((event) => {
          if (event.state === 'running')
            updateFile(index, {
              status: event.stage === 'Queued' ? 'queued' : 'importing',
              fraction: event.progress,
            });
        });
        const result = job.completion.then(
          (asset) => ({ asset }),
          (failure: unknown) => {
            const cancelled =
              (failure as { code?: string })?.code === 'CANCELLED';
            updateFile(index, {
              status: cancelled ? 'cancelled' : 'failed',
              error: cancelled
                ? undefined
                : failure instanceof Error
                  ? failure.message
                  : 'Could not import this file.',
            });
            return { failure };
          },
        );
        jobs.push({ stop, result });
      }
    });
    if (!started) {
      updateBatch((batch) => ({
        ...batch,
        running: false,
        files: batch.files.map((file) => ({
          ...file,
          status: 'failed',
          error: 'Import could not start.',
        })),
      }));
      for (const job of jobs) job.stop();
      return false;
    }
    try {
      for (const [index, job] of jobs.entries()) {
        const result = await job.result;
        if ('failure' in result) {
          if (
            alive.current &&
            (result.failure as { code?: string })?.code !== 'CANCELLED'
          )
            error(result.failure);
          continue;
        }
        // Serialize placements across batches, using the initiating project even
        // if the user edits or navigates while media jobs run in the background.
        let committed = false;
        const placement = importPlacement.current.then(async () => {
          if (!alive.current) return;
          const snapshot = await engine!.projects.snapshot(targetProjectId!);
          const operations = appendAsset(snapshot, result.asset);
          if (!alive.current) return;
          await engine!.commands.apply({
            projectId: snapshot.id,
            expectedRevision: snapshot.revision,
            requestId: crypto.randomUUID(),
            operations,
          });
          added++;
          committed = true;
          updateFile(index, { status: 'completed', fraction: 1 });
          if (getProjectId() !== targetProjectId || browsing.current) return;
          await refresh();
          if (getProjectId() !== targetProjectId || browsing.current) return;
          if (visibleImportBatch.current !== batchId) return;
          setMediaOverride(true);
          const insert = operations.find(
            (operation) => operation.type === 'insertClip',
          );
          if (insert?.type === 'insertClip') {
            setSelected(insert.clip.id);
            setSelection([]);
          }
        });
        importPlacement.current = placement.catch(() => {});
        try {
          await placement;
        } catch (failure) {
          if (!committed)
            updateFile(index, {
              status: 'failed',
              error:
                failure instanceof Error
                  ? failure.message
                  : 'Could not add this asset.',
            });
          if (alive.current) error(failure);
        }
      }
    } finally {
      for (const job of jobs) job.stop();
      updateBatch((batch) => ({ ...batch, running: false }));
    }
    return added === files.length;
  };
  const fileHovering = useFileDrop(!busy && !browsed, (files) => {
    if (narrow) selectMobileTab('media');
    void importMedia(files);
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
    });
  };
  const deleteClip = () => {
    if (!project || !selectedClip) return;
    void action(async () => {
      await apply(
        selectedIds.map((clipId) => ({ type: 'removeClip', clipId })),
      );
      setSelection([]);
    });
  };
  const addText = () => {
    if (project && !browsed) setDialog('text');
  };
  const addTrack = (kind: 'video' | 'audio') => {
    if (!project || busy || browsing.current) return;
    void action(async () => {
      await apply([
        { type: 'addTrack', track: { id: crypto.randomUUID(), kind } },
      ]);
    });
  };
  const reorderTrack = (trackId: string, index: number) => {
    if (!project || busy || browsing.current) return;
    void action(async () => {
      await apply([{ type: 'reorderTrack', trackId, index }]);
    });
  };
  const trackOperation = (
    operations: EditOperation[],
    scope: { projectId: string; revision: number },
  ) => {
    if (!project || busy || browsing.current) return;
    void action(async () => {
      await apply(operations, scope);
    });
  };
  const insertText = (style: TextStyleInput) => {
    if (!project || browsed) return;
    void action(async () => {
      const track = project!.tracks.find(
        (track) => track.kind === 'overlay' && !track.locked,
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
            height: project!.height * 0.5,
            y: project!.height * 0.3,
            text: {
              ...style,
              fontSize: ((style.fontSize ?? 64) * project!.width) / 1920,
              ...(style.letterSpacing !== undefined
                ? {
                    letterSpacing:
                      (style.letterSpacing * project!.width) / 1920,
                  }
                : {}),
              ...(style.outlineWidth !== undefined
                ? { outlineWidth: (style.outlineWidth * project!.width) / 1920 }
                : {}),
              ...(style.shadow
                ? {
                    shadow: {
                      color: style.shadow.color,
                      blur: (style.shadow.blur * project!.width) / 1920,
                      offsetX: (style.shadow.offsetX * project!.width) / 1920,
                      offsetY: (style.shadow.offsetY * project!.width) / 1920,
                    },
                  }
                : {}),
            },
          },
        },
      ]);
      setSelected(id);
      setSelection([]);
      setDialog('properties');
    });
  };
  const duplicate = () => {
    if (!project || !selectedClip) return;
    const clips = project.tracks
      .flatMap((track) => track.clips)
      .filter((clip) => selectedIds.includes(clip.id));
    const deltaUs =
      Math.max(...clips.map((clip) => clip.startUs + clip.durationUs)) -
      Math.min(...clips.map((clip) => clip.startUs));
    const newClipIds = Object.fromEntries(
      clips.map((clip) => [clip.id, crypto.randomUUID()]),
    );
    const operations: EditOperation[] = [];
    const groups = new Set<string>();
    for (const clip of clips) {
      if (clip.groupId) {
        if (!groups.has(clip.groupId)) {
          groups.add(clip.groupId);
          const members = clips.filter((c) => c.groupId === clip.groupId);
          operations.push({
            type: 'duplicateGroup',
            groupId: clip.groupId,
            newGroupId: crypto.randomUUID(),
            newClipIds: Object.fromEntries(
              members.map((c) => [c.id, newClipIds[c.id]!]),
            ),
            deltaUs,
          });
        }
      } else {
        const track = project.tracks.find((track) =>
          track.clips.some((c) => c.id === clip.id),
        )!;
        operations.push({
          type: 'duplicateClip',
          clipId: clip.id,
          newClipId: newClipIds[clip.id]!,
          trackId: track.id,
          startUs: clip.startUs + deltaUs,
        });
      }
    }
    void action(async () => {
      await apply(operations);
      setSelected(newClipIds[selectedClip.id]);
      setSelection(Object.values(newClipIds));
    });
  };
  const selectedGroups = [
    ...new Set(
      viewProject?.tracks.flatMap((t) =>
        t.clips
          .filter((c) => selectedIds.includes(c.id))
          .flatMap((c) => (c.groupId ? [c.groupId] : [])),
      ) ?? [],
    ),
  ];
  const canGroup =
    !selectionLocked &&
    selectedIds.length >= 2 &&
    !(
      selectedGroups.length === 1 &&
      viewProject?.tracks
        .flatMap((t) => t.clips)
        .filter((c) => c.groupId === selectedGroups[0]).length ===
        selectedIds.length
    );
  const group = () =>
    void action(async () => {
      await apply([
        {
          type: 'groupClips',
          groupId: crypto.randomUUID(),
          clipIds: selectedIds,
        },
      ]);
    });
  const ungroup = () =>
    void action(async () => {
      await apply(
        selectedGroups.map((groupId) => ({ type: 'ungroupClips', groupId })),
      );
    });
  const canSeparate =
    !selectionLocked &&
    selectedIds.length === 1 &&
    selectedClip?.kind === 'video' &&
    !selectedClip.muted &&
    !!assets.find((asset) => asset.id === selectedClip.assetId)?.audioCodec;
  const separateAudio = () =>
    void action(async () => {
      if (!project || !selectedClip) return;
      const track = project.tracks.find(
        (track) => track.kind === 'audio' && !track.muted && !track.locked,
      );
      const trackId = track?.id ?? crypto.randomUUID();
      const audioClipId = crypto.randomUUID();
      await apply([
        ...(!track
          ? [
              {
                type: 'addTrack' as const,
                track: { id: trackId, kind: 'audio' as const },
              },
            ]
          : []),
        {
          type: 'separateAudio',
          clipId: selectedClip.id,
          audioClipId,
          trackId,
        },
      ]);
      setSelected(audioClipId);
      setSelection([]);
    });
  const pairs = viewProject ? transitionPairs(viewProject) : [];
  const selectedPairs = pairs.filter(
    (pair) =>
      selectedIds.includes(pair.fromClipId) &&
      selectedIds.includes(pair.toClipId),
  );
  const overlap =
    selectedPairs.length === 1
      ? selectedPairs[0]
      : selectedIds.length === 1
        ? pairs.find(
            (pair) =>
              pair.fromClipId === selected || pair.toClipId === selected,
          )
        : undefined;
  const activeTransition = viewProject?.transitions.find(
    (t) =>
      t.fromClipId === overlap?.fromClipId &&
      t.toClipId === overlap?.toClipId &&
      t.trackId === overlap?.trackId,
  );
  const setTransition = (template?: TransitionTemplate) =>
    void action(async () => {
      if (!overlap) return;
      await apply(
        template
          ? [
              {
                type: 'applyTransitionTemplate',
                transitionId: activeTransition?.id ?? crypto.randomUUID(),
                trackId: overlap.trackId,
                fromClipId: overlap.fromClipId,
                toClipId: overlap.toClipId,
                template,
              },
            ]
          : [{ type: 'removeTransition', transitionId: activeTransition!.id }],
      );
    });
  const canSplit =
    !selectionLocked &&
    selectedIds.length === 1 &&
    !!selectedClip &&
    timeUs > selectedClip.startUs &&
    timeUs < selectedClip.startUs + selectedClip.durationUs;
  const clearSelection = () => {
    setSelected(undefined);
    setSelection([]);
  };
  const selectAll = () => {
    const ids =
      viewProject?.tracks.flatMap((t) => t.clips.map((c) => c.id)) ?? [];
    setSelected(ids[0]);
    setSelection(ids);
  };
  const copy = () => {
    if (viewProject) setClipboard(copySelection(viewProject, selectedIds));
  };
  const cut = () => {
    if (!project) return;
    const saved = copySelection(project, selectedIds);
    void action(async () => {
      await apply(
        selectedIds.map((clipId) => ({ type: 'removeClip', clipId })),
      );
      setClipboard(saved);
      clearSelection();
    });
  };
  const paste = () =>
    void action(async () => {
      if (!project || !clipboard) return;
      const { operations, ids } = pasteSelection(project, clipboard, timeUs);
      if (!operations.length) return;
      await apply(operations);
      setSelected(ids[0]);
      setSelection(ids);
    });
  const editSelection = (operations: EditOperation[], clear = false) =>
    void action(async () => {
      if (!operations.length) return;
      await apply(operations);
      if (clear) clearSelection();
    });
  const trimStartOperations =
    canSplit && selectedClip
      ? trimAtPlayhead(selectedClip, timeUs, 'start')
      : [];
  const trimEndOperations =
    canSplit && selectedClip ? trimAtPlayhead(selectedClip, timeUs, 'end') : [];
  const rippleOperations = project
    ? rippleDeleteSelection(project, selectedIds)
    : [];
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
                editBoundary(viewProject, timeUs, -1),
                frameStep(total, 0, viewProject.frameRate, total),
              ),
            )
        : undefined,
    nextCut:
      viewProject && total
        ? () =>
            seek(
              Math.min(
                editBoundary(viewProject, timeUs, 1),
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
        ? () => editSelection(trimStartOperations, true)
        : undefined,
    trimEnd:
      trimEndOperations.length && !browsed
        ? () => editSelection(trimEndOperations, true)
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
              timeUs,
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
      id={narrow ? undefined : 'desktop-media-trigger'}
      ref={narrow ? undefined : mediaTriggerRef}
      variant="ghost"
      size="icon-sm"
      aria-label={
        drawer ? (narrow ? 'Close media' : 'Collapse media') : 'Expand media'
      }
      aria-expanded={drawer}
      aria-controls="workspace-media-content"
      onClick={toggleMedia}
    >
      {drawer ? narrow ? <X /> : <PanelLeftClose /> : <Files />}
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
      <UpdateControl busy={busy} />
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
      aria-label="Media library"
      data-collapsed={!drawer}
      onFocusCapture={() => {
        mediaHasFocus.current = true;
      }}
      onBlurCapture={(event) => {
        if (
          window.matchMedia(narrowQuery).matches === narrow &&
          event.relatedTarget !== null &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          mediaHasFocus.current = false;
      }}
    >
      <Suspense fallback={mediaToggle}>
        <Tooltip
          content={
            drawer ? (narrow ? 'Close media' : 'Collapse media') : 'Open media'
          }
        >
          {mediaToggle}
        </Tooltip>
      </Suspense>
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
              editor={editor}
              indexConnection={indexConnection}
              readOnly={!!browsed || navigation.blocked}
              assets={browsed ? versionAssets : assets}
              canEdit={!busy && !browsed}
              onImport={() => fileInput.current?.click()}
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
                <header className="mobile-edit-heading">
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
                  {mobileTab === 'edit' ? headerActions : null}
                  {project && (
                    <ProjectTabs
                      value={projectTab}
                      onChange={chooseProjectTab}
                    />
                  )}
                </header>
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
                      timeUs={timeUs}
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
                      onProperties={() => setDialog('properties')}
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
            timeUs={timeUs}
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
            onClose={() => {
              visibleImportBatch.current = null;
              setImportBatch(null);
            }}
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
