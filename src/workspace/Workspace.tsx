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
  ChevronDown,
  Files,
  Settings2,
  X,
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
import { selectionIds, transitionPairs } from '../core/timeline';
import type { TransitionTemplate } from '../core/timeline';
import { interfaceScale, useAppearance } from './appearance';
import { usePageZoomGuard } from './usePageZoomGuard';
import { hasBlockingOverlay } from './overlays';
import {
  saveWorkspacePreferences,
  useWorkspacePreferences,
} from './preferences';
import { appendAsset, downloadFile, projectDuration } from './helpers';

import type { TextStyleInput } from '../core/text-library';
import type { DialogName, Progress } from './WorkspaceDialogs';
const MediaLibrary = lazy(() => import('./MediaLibrary'));
const ScreenRecordingDialog = lazy(() => import('./ScreenRecordingDialog'));
const MobileNavigation = lazy(() => import('./MobileNavigation'));
const WorkspaceDialogs = lazy(() => import('./WorkspaceDialogs'));
const Preview = lazy(() =>
  import('./Preview').then(({ Preview }) => ({ default: Preview })),
);
const Timeline = lazy(() =>
  import('./Timeline').then(({ Timeline }) => ({ default: Timeline })),
);
const CommandPalette = lazy(() => import('./CommandPalette'));
const WorkspaceMenu = lazy(() => import('./WorkspaceMenu'));
const WorkspaceTransferDialog = lazy(() => import('./WorkspaceTransferDialog'));
const AppearancePanel = lazy(() => import('./AppearancePanel'));
import ProjectBrowser from './ProjectBrowser';
import {
  WorkspaceSkeleton,
  PreviewSkeleton,
  TimelineSkeleton,
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
  useEffect(() => {
    if (!header.current) return;
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
  }, []);
  const [narrow, setNarrow] = useState(
    () => window.matchMedia(narrowQuery).matches,
  );
  const [mobileTab, setMobileTab] = useState<MobileTab>('edit');
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
      toast.error(
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
  const {
    project,
    assets,
    getProjectId,
    activate,
    clear: clearProject,
    refresh: refreshProject,
  } = useWorkspaceProject(editorRef);
  const { route, routeKey, go } = useWorkspaceRoute();
  const projectsOpen = route.screen === 'projects';
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<ProjectVersionInfo[]>([]);
  const [browsed, setBrowsed] = useState<ProjectVersion | null>(null);
  const [versionAssets, setVersionAssets] = useState<Asset[]>([]);
  const browsing = useRef(false);
  const viewProject = browsed?.project ?? project;
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
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [paletteCommands, setPaletteCommands] = useState<WorkspaceCommand[]>(
    [],
  );
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
  const catalog = useProjectCatalog(projectsOpen, editor, ensureEditor, error);
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
      setDialog(null);
      setTransfer(null);
      setCommandsOpen(false);
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
      setCommandsOpen,
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
  const apply = async (operations: EditOperation[]) => {
    if (browsing.current)
      throw new Error('Return to the current version to edit.');
    if (!project) throw new Error('Create or open a project first.');
    const engine = await ensureEditor();
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
  const importMedia = (files: File[]) =>
    action(async () => {
      if (browsing.current) return;
      const engine = await ensureEditor();
      if (!getProjectId())
        await openProject(await engine.projects.create('Untitled project'));
      for (const file of files) {
        checkCancelled();
        const asset = await awaitJob(
          engine.assets.import(file),
          `Importing ${file.name}`,
        );
        checkCancelled();
        const snapshot = await engine.projects.snapshot(getProjectId()!);
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
        if (insert?.type === 'insertClip') {
          setSelected(insert.clip.id);
          setSelection([]);
        }
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
  const showProjects = () => {
    if (lock.current) return;
    previewControls.current?.pause();
    setDialog(null);
    setAppearanceOpen(false);
    go('projects', getProjectId() ?? undefined);
    if (projectsOpen) void catalog.refresh();
  };
  const returnToEditor = () => {
    go('editor', getProjectId() ?? undefined);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('[data-editor-shortcuts]')?.focus(),
    );
  };
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
      await apply(
        selectedIds.map((clipId) => ({ type: 'removeClip', clipId })),
      );
      setSelection([]);
      toast.success('Clip removed');
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
      toast.success(
        kind === 'video' ? 'Video track added' : 'Audio track added',
      );
    });
  };
  const reorderTrack = (trackId: string, index: number) => {
    if (!project || busy || browsing.current) return;
    void action(async () => {
      await apply([{ type: 'reorderTrack', trackId, index }]);
      toast.success('Track reordered');
    });
  };
  const insertText = (style: TextStyleInput) => {
    if (!project || browsed) return;
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
      toast.success('Selection duplicated');
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
      toast.success('Clips grouped');
    });
  const ungroup = () =>
    void action(async () => {
      await apply(
        selectedGroups.map((groupId) => ({ type: 'ungroupClips', groupId })),
      );
      toast.success('Clips ungrouped');
    });
  const canSeparate =
    selectedIds.length === 1 &&
    selectedClip?.kind === 'video' &&
    !selectedClip.muted &&
    !!assets.find((asset) => asset.id === selectedClip.assetId)?.audioCodec;
  const separateAudio = () =>
    void action(async () => {
      if (!project || !selectedClip) return;
      const track = project.tracks.find(
        (track) => track.kind === 'audio' && !track.muted,
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
      toast.success('Audio separated');
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
      toast.success(
        template ? 'Transition template applied' : 'Transition blend removed',
      );
    });
  const canSplit =
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
    cut: selectedIds.length && !browsed ? cut : undefined,
    paste:
      project && clipboard?.projectId === project.id && !browsed
        ? paste
        : undefined,
    nudgeLeft:
      selectedIds.length && !browsed
        ? () => editSelection(nudgeSelection(project!, selectedIds, -1))
        : undefined,
    nudgeRight:
      selectedIds.length && !browsed
        ? () => editSelection(nudgeSelection(project!, selectedIds, 1))
        : undefined,
    nudgeTenLeft:
      selectedIds.length && !browsed
        ? () => editSelection(nudgeSelection(project!, selectedIds, -10))
        : undefined,
    nudgeTenRight:
      selectedIds.length && !browsed
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
      rippleOperations.length && !browsed
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
    delete: selectedClip && !browsed ? deleteClip : undefined,
    duplicate: selectedClip && !browsed ? duplicate : undefined,
    group: canGroup && !browsed ? group : undefined,
    ungroup: selectedGroups.length && !browsed ? ungroup : undefined,
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
    void import('./workspace-command-list')
      .then(({ workspaceCommands }) => {
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
              setTransfer,
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
        setCommandsOpen(true);
      })
      .catch(error);
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
              onRecord={() => {
                previewControls.current?.pause();
                setRecordingRoute(recordingRouteKey);
              }}
              onRelink={relinkMedia}
            />
          </Suspense>
        )}
      </div>
    </aside>
  );
  return (
    <div
      className="workspace"
      data-chat-collapsed={visibleChatCollapsed}
      data-media-open={drawer}
    >
      <header ref={header} className="workspace-header">
        {busy ? (
          <span className="brand">
            <Scissors aria-hidden="true" />
            LocalCut
          </span>
        ) : (
          <button
            className="brand"
            type="button"
            aria-label="LocalCut home"
            onClick={showProjects}
          >
            <Scissors aria-hidden="true" />
            LocalCut
          </button>
        )}
        {!busy && !projectsOpen && (
          <Button
            variant="ghost"
            className="project-picker"
            aria-label="Open project"
            onClick={showProjects}
          >
            <span className="project-picker-name">
              {viewProject?.name ?? 'Untitled project'}
            </span>
            <span className="sr-only">Projects</span>
            <ChevronDown />
          </Button>
        )}
        <div className="header-actions">
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
                  setTransfer({
                    mode: 'export',
                    projectOnly: true,
                    projectId: project?.id,
                  })
                }
                onProjectImport={() =>
                  setTransfer({ mode: 'import', projectOnly: true })
                }
                onWorkspaceExport={() => setTransfer({ mode: 'export' })}
                onWorkspaceImport={() => setTransfer({ mode: 'import' })}
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
      </header>
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
        {projectsOpen && !navigation.error && (
          <ProjectBrowser
            projects={catalog.projects}
            currentProjectId={project?.id}
            busy={busy}
            navigationBusy={operationBusy}
            refreshing={catalog.pending}
            loaded={catalog.loaded}
            failed={catalog.failed}
            onOpen={(id) =>
              id === getProjectId() ? returnToEditor() : go('editor', id)
            }
            onBack={returnToEditor}
            onRefresh={showProjects}
            onNew={() => setDialog('new')}
            onImport={() => backupInput.current?.click()}
          />
        )}
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
                controlsRef={registerConversationControls}
                onIndexConnection={setIndexConnection}
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
                onToggle={toggleChat}
              />
            </Suspense>
            <main
              id="workspace-editor"
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
                  />
                </Suspense>
              </EditorPanels>
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
      {narrow && !projectsOpen && (
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
      {recordingRoute === recordingRouteKey &&
        !browsed &&
        !navigation.blocked && (
          <Suspense fallback={null}>
            <ScreenRecordingDialog
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
            onDialogChange={setDialog}
            onCloseExport={closeExport}
            onStartExport={startExport}
            onFormatChange={setFormat}
            onCancelWork={cancelWork}
            onCreateProject={(name) =>
              void action(async () => {
                const engine = await ensureEditor();
                await openProject(await engine.projects.create(name));
                toast.success('Project created');
              })
            }
            onInsertText={insertText}
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
