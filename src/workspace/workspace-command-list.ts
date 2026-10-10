import type { EditorShortcut } from './shortcuts';
import type {
  Asset,
  Project,
  ProjectVersion,
  ProjectVersionInfo,
} from '../editor';
import type { DialogName } from './WorkspaceDialogs';
import type { TransitionTemplate } from '../core/timeline';
import { TRANSITION_TEMPLATES } from '../core/timeline';
import { clipName, formatTime } from './helpers';
import { frameStep } from './shortcuts';
import { saveWorkspacePreferences } from './preferences';
import type { WorkspaceCommand } from './commands';

interface CommandContext {
  project: Project | null;
  browsed: ProjectVersion | null;
  viewProject: Project | null;
  versionAssets: Asset[];
  assets: Asset[];
  versions: ProjectVersionInfo[];
  timeUs: number;
  total: number;
  format: 'mp4' | 'webm';
  projectsOpen: boolean;
  busy: boolean;
  selectedClip: boolean;
  canUngroup: boolean;
  overlap: boolean;
  activeTransition: boolean;
  canSplit: boolean;
  canSeparate: boolean;
  canGroup: boolean;
  versionsOpen: boolean;
  chatCollapsed: boolean;
  drawer: boolean;
  appearanceOpen: boolean;
  showProjects: () => void;
  returnToEditor: () => void;
  importBackup: () => void;
  backupProject: () => void;
  importMedia: () => void;
  undo: () => void;
  redo: () => void;
  split: () => void;
  deleteClip: () => void;
  duplicate: () => void;
  separateAudio: () => void;
  group: () => void;
  ungroup: () => void;
  addText: () => void;
  togglePlayback: () => void;
  showVersions: () => void;
  leaveVersion: () => void;
  restoreVersion: () => void;
  showExport: () => void;
  toggleChat: () => void;
  toggleMedia: () => void;
  closeAppearance: () => void;
  openSettings: () => void;
  setDialog: (value: DialogName) => void;
  setTransfer: (value: {
    mode: 'export' | 'import';
    projectOnly?: boolean;
    projectId?: string;
  }) => void;
  setAppearanceOpen: (value: boolean) => void;
  setVersionsOpen: (value: boolean) => void;
  seek: (value: number) => void;
  relinkMedia: (id: string) => void;
  setTransition: (template?: TransitionTemplate) => void;
  selectClip: (id: string) => void;
  browseVersion: (id: string) => void;
  setFormat: (format: 'mp4' | 'webm') => void;
  assistantCommands: () => WorkspaceCommand[];
}

/** Build palette presentation only after Commands is opened; callbacks retain their shared owners. */
export function workspaceCommands(
  [
    projectsOpen,
    busy,
    project,
    browsed,
    viewProject,
    versionAssets,
    assets,
    selectedClip,
    canUngroup,
    overlap,
    activeTransition,
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
    importBackup,
    setTransfer,
    setAppearanceOpen,
    seek,
    backupProject,
    importMedia,
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
    togglePlayback,
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
    assistantCommands,
  ]: [
    projectsOpen: CommandContext['projectsOpen'],
    busy: CommandContext['busy'],
    project: CommandContext['project'],
    browsed: CommandContext['browsed'],
    viewProject: CommandContext['viewProject'],
    versionAssets: CommandContext['versionAssets'],
    assets: CommandContext['assets'],
    selectedClip: CommandContext['selectedClip'],
    canUngroup: CommandContext['canUngroup'],
    overlap: CommandContext['overlap'],
    activeTransition: CommandContext['activeTransition'],
    total: CommandContext['total'],
    canSplit: CommandContext['canSplit'],
    canSeparate: CommandContext['canSeparate'],
    canGroup: CommandContext['canGroup'],
    timeUs: CommandContext['timeUs'],
    versions: CommandContext['versions'],
    versionsOpen: CommandContext['versionsOpen'],
    format: CommandContext['format'],
    chatCollapsed: CommandContext['chatCollapsed'],
    drawer: CommandContext['drawer'],
    appearanceOpen: CommandContext['appearanceOpen'],
    setDialog: CommandContext['setDialog'],
    showProjects: CommandContext['showProjects'],
    returnToEditor: CommandContext['returnToEditor'],
    importBackup: CommandContext['importBackup'],
    setTransfer: CommandContext['setTransfer'],
    setAppearanceOpen: CommandContext['setAppearanceOpen'],
    seek: CommandContext['seek'],
    backupProject: CommandContext['backupProject'],
    importMedia: CommandContext['importMedia'],
    relinkMedia: CommandContext['relinkMedia'],
    undo: CommandContext['undo'],
    redo: CommandContext['redo'],
    split: CommandContext['split'],
    deleteClip: CommandContext['deleteClip'],
    duplicate: CommandContext['duplicate'],
    separateAudio: CommandContext['separateAudio'],
    group: CommandContext['group'],
    ungroup: CommandContext['ungroup'],
    setTransition: CommandContext['setTransition'],
    addText: CommandContext['addText'],
    selectClip: CommandContext['selectClip'],
    togglePlayback: CommandContext['togglePlayback'],
    showVersions: CommandContext['showVersions'],
    browseVersion: CommandContext['browseVersion'],
    leaveVersion: CommandContext['leaveVersion'],
    restoreVersion: CommandContext['restoreVersion'],
    setVersionsOpen: CommandContext['setVersionsOpen'],
    showExport: CommandContext['showExport'],
    setFormat: CommandContext['setFormat'],
    toggleChat: CommandContext['toggleChat'],
    toggleMedia: CommandContext['toggleMedia'],
    closeAppearance: CommandContext['closeAppearance'],
    openSettings: CommandContext['openSettings'],
    assistantCommands: CommandContext['assistantCommands'],
  ],
  shortcutActions: Partial<Record<EditorShortcut, () => void>> = {},
): WorkspaceCommand[] {
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
  if (projectsOpen) {
    command('new', 'New project', 'Project', !busy, () => setDialog('new'));
    command(
      'open',
      'Refresh projects',
      'Project',
      !busy,
      showProjects,
      'Mod+O',
    );
    command('back', 'Back to editor', 'Project', !busy, returnToEditor);
    command('import-backup', 'Import project backup', 'Project', !busy, () =>
      importBackup(),
    );
    command('import-project', 'Import project', 'Project', !busy, () =>
      setTransfer({ mode: 'import', projectOnly: true }),
    );
    command('export-workspace', 'Export workspace', 'Workspace', !busy, () =>
      setTransfer({ mode: 'export' }),
    );
    command('import-workspace', 'Import workspace', 'Workspace', !busy, () =>
      setTransfer({ mode: 'import' }),
    );
    command('appearance', 'Appearance', 'Settings', !busy, () =>
      setAppearanceOpen(true),
    );
    return commands;
  }
  const editable = !!project && !browsed && !busy;
  const focusEditor = () =>
    document.querySelector<HTMLElement>('[data-editor-shortcuts]')?.focus();
  const navigate = (value: number) => {
    seek(value);
    focusEditor();
  };
  command('new', 'New project', 'Project', !busy, () => setDialog('new'), 'N');
  command('open', 'Open project', 'Project', !busy, showProjects, 'Mod+O');
  command('export-project', 'Export project', 'Project', editable, () =>
    setTransfer({
      mode: 'export',
      projectOnly: true,
      projectId: project?.id,
    }),
  );
  command(
    'import-project',
    'Import project',
    'Project',
    !busy && !browsed,
    () => setTransfer({ mode: 'import', projectOnly: true }),
  );
  command(
    'export-workspace',
    'Export workspace',
    'Workspace',
    !busy && !browsed,
    () => setTransfer({ mode: 'export' }),
  );
  command(
    'import-workspace',
    'Import workspace',
    'Workspace',
    !busy && !browsed,
    () => setTransfer({ mode: 'import' }),
  );
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
    () => importBackup(),
  );
  command(
    'import',
    'Import media',
    'Media',
    !busy && !browsed,
    () => importMedia(),
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
  command(
    'separate-audio',
    'Separate audio',
    'Editing',
    editable && canSeparate,
    separateAudio,
  );
  command(
    'group',
    'Group clips',
    'Editing',
    editable && canGroup,
    group,
    'Mod+G',
  );
  command(
    'ungroup',
    'Ungroup clips',
    'Editing',
    editable && !!canUngroup,
    ungroup,
    'Mod+Shift+G',
  );
  for (const template of TRANSITION_TEMPLATES)
    command(
      `transition-${template.id}`,
      `${template.label} transition template`,
      'Transitions',
      editable && !!overlap,
      () => setTransition(template.id),
    );
  command(
    'remove-transition',
    'Remove transition blend',
    'Transitions',
    editable && !!activeTransition,
    () => setTransition(),
  );
  command('text', 'Add text', 'Editing', editable, addText, 'T');
  for (const [id, label, shortcut] of [
    ['save', 'Save project version', 'Mod+S'],
    ['copy', 'Copy selected clips', 'Mod+C'],
    ['cut', 'Cut selected clips', 'Mod+X'],
    ['paste', 'Paste clips at playhead', 'Mod+V'],
    ['selectAll', 'Select all clips', 'Mod+A'],
    ['clearSelection', 'Clear clip selection', 'Escape'],
    ['nudgeLeft', 'Nudge selection left one frame', 'Alt+←'],
    ['nudgeRight', 'Nudge selection right one frame', 'Alt+→'],
    ['nudgeTenLeft', 'Nudge selection left ten frames', 'Alt+Shift+←'],
    ['nudgeTenRight', 'Nudge selection right ten frames', 'Alt+Shift+→'],
    ['trimStart', 'Trim start to playhead', 'Q'],
    ['trimEnd', 'Trim end to playhead', 'W'],
    ['rippleDelete', 'Ripple delete selection', 'Shift+Delete'],
    ['previousCut', 'Previous edit boundary', '↑'],
    ['nextCut', 'Next edit boundary', '↓'],
    ['zoomIn', 'Zoom timeline in', '+'],
    ['zoomOut', 'Zoom timeline out', '−'],
    ['zoomFit', 'Fit timeline', '\\'],
  ] as const) {
    const run = shortcutActions[id];
    command(
      id,
      label,
      id.startsWith('zoom') ? 'View' : 'Editing',
      !busy && !!run,
      run ?? (() => {}),
      shortcut,
    );
  }
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
          selectClip(clip.id);
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
      togglePlayback();
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
      () => navigate(frameStep(timeUs, frames, viewProject!.frameRate, total)),
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
  for (const item of assistantCommands())
    commands.push({ ...item, run: revealChat(item.run) });
  return commands;
}
