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
  LoaderCircle,
  Search,
  PanelRightClose,
  ChevronDown,
  Download,
  Files,
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
import type { IndexConnection } from './Conversation';
import { KlipMark } from './KlipMark';
const AssetIndexControls = lazy(() => import('./AssetIndexControls'));
import type { PreviewControls } from './Preview';
import { Tooltip } from '../components/ui/tooltip';
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
import { selectionIds, transitionPairs } from '../core/timeline';
import type { TransitionTemplate } from '../core/timeline';
import { useAppearance } from './appearance';
import {
  saveWorkspacePreferences,
  useWorkspacePreferences,
} from './preferences';
import {
  appendAsset,
  downloadFile,
  formatTime,
  projectDuration,
} from './helpers';

import type { DialogName, Progress } from './WorkspaceDialogs';
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
const ProjectBrowser = lazy(() => import('./ProjectBrowser'));
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
  const [project, setProject] = useState<Project | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<ProjectVersionInfo[]>([]);
  const [browsed, setBrowsed] = useState<ProjectVersion | null>(null);
  const [versionAssets, setVersionAssets] = useState<Asset[]>([]);
  const browsing = useRef(false);
  const viewProject = browsed?.project ?? project;
  const [assets, setAssets] = useState<Asset[]>([]);
  const [indexConnection, setIndexConnection] =
    useState<IndexConnection | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
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
  const projectsToken = useRef(0);
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
  }, [refresh, error]);
  useEffect(() => {
    if (!editor || !projectsOpen) return;
    let stale = false;
    const stop = editor.events.projects(() => {
      const request = ++projectsToken.current;
      void editor.projects
        .list()
        .then((value) => {
          if (!stale && request === projectsToken.current) {
            setProjects(value);
            setProjectsLoaded(true);
          }
        })
        .catch((failure) => {
          if (!stale) error(failure);
        });
    });
    return () => {
      stale = true;
      projectsToken.current++;
      stop();
    };
  }, [editor, projectsOpen, error]);
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
    setSelection([]);
    setTimeUs(0);
    setDialog(null);
    await refresh();
    await artifactRef.current?.dispose();
    artifactRef.current = null;
    setArtifact(null);
    setExportError('');
    setProjectsOpen(false);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('[data-editor-shortcuts]')?.focus(),
    );
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
    setProjectsOpen(true);
    setDialog(null);
    setAppearanceOpen(false);
    const request = ++projectsToken.current;
    void action(async () => {
      const engine = await ensureEditor();
      const value = await engine.projects.list();
      if (alive.current && request === projectsToken.current) {
        setProjects(value);
        setProjectsLoaded(true);
      }
    });
  };
  const returnToEditor = () => {
    setProjectsOpen(false);
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
              chatCollapsed,
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
  return (
    <div
      className="workspace"
      data-chat-collapsed={chatCollapsed}
      data-media-open={drawer}
      style={{ '--chat-preferred-width': `${chatWidth}px` } as CSSProperties}
    >
      <header className="workspace-header">
        {busy ? (
          <span className="brand">
            <KlipMark className="size-6" />
            LocalCut
          </span>
        ) : (
          <button
            className="brand"
            type="button"
            aria-label="LocalCut home"
            onClick={showProjects}
          >
            <KlipMark className="size-6" />
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
            {viewProject?.name ?? 'Untitled project'}
            <span className="sr-only">Projects</span>
            <ChevronDown />
          </Button>
        )}
        <div className="header-actions">
          {project && !busy && !projectsOpen && (
            <Button
              variant="outline"
              size="sm"
              aria-expanded={versionsOpen}
              onClick={showVersions}
            >
              <History /> Versions
            </Button>
          )}
          {!!total && !busy && !browsed && !projectsOpen && (
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
                hasProject={!!project && !projectsOpen}
                canExport={!!total && !projectsOpen}
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
        data-projects-open={projectsOpen}
      >
        {projectsOpen && (
          <Suspense
            fallback={
              <div
                className="project-browser"
                role="status"
                aria-label="Loading projects"
              >
                <LoaderCircle className="animate-spin size-5" />
              </div>
            }
          >
            <ProjectBrowser
              projects={projects}
              currentProjectId={project?.id}
              busy={busy}
              loaded={projectsLoaded}
              onOpen={(snapshot) =>
                snapshot.id === projectId.current
                  ? returnToEditor()
                  : void action(() => openProject(snapshot))
              }
              onBack={returnToEditor}
              onRefresh={showProjects}
              onNew={() => setDialog('new')}
              onImport={() => backupInput.current?.click()}
            />
          </Suspense>
        )}
        <div className="workspace-columns" inert={projectsOpen}>
          <Conversation
            controlsRef={conversationControls}
            onIndexConnection={setIndexConnection}
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
              <Suspense
                fallback={
                  <section
                    className="preview"
                    aria-label="Project preview"
                    role="status"
                  >
                    Loading preview…
                  </section>
                }
              >
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
              <Suspense
                fallback={
                  <section className="timeline" aria-label="Video timeline">
                    <span role="status">Loading timeline…</span>
                  </section>
                }
              >
                <Timeline
                  project={viewProject}
                  assets={browsed ? versionAssets : assets}
                  versionId={browsed?.id}
                  readOnly={!!browsed}
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
                />
              </Suspense>
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
                        {editor && (
                          <Suspense fallback={null}>
                            <AssetIndexControls
                              editor={editor}
                              asset={asset}
                              connection={indexConnection}
                              readOnly={!!browsed}
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
            </div>
          </aside>
        </div>
        {transfer && (
          <Suspense
            fallback={<div role="status">Loading workspace transfer…</div>}
          >
            <WorkspaceTransferDialog
              {...transfer}
              getEditor={ensureEditor}
              onBusyChange={setBusy}
              onImported={async () => {
                const engine = await ensureEditor();
                setProjects(await engine.projects.list());
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
              if (browsing.current && !projectsOpen) return;
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
