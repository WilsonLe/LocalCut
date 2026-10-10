import type { Project } from '../core/model';
import { frameTimeUs } from '../core/timing';

export type EditorShortcut =
  | 'playPause'
  | 'previousFrame'
  | 'nextFrame'
  | 'previousTenFrames'
  | 'nextTenFrames'
  | 'start'
  | 'end'
  | 'split'
  | 'delete'
  | 'duplicate'
  | 'addText'
  | 'undo'
  | 'redo'
  | 'newProject'
  | 'openProject'
  | 'import'
  | 'export'
  | 'toggleChat'
  | 'toggleMedia'
  | 'shortcuts'
  | 'commands';

export const SHORTCUT_GROUPS = [
  {
    title: 'Playback and timeline',
    items: [
      { keys: 'Space', label: 'Play or pause' },
      { keys: '← / →', label: 'Previous or next frame' },
      { keys: 'Shift + ← / →', label: 'Back or forward ten frames' },
      { keys: 'Home / End', label: 'Beginning or last frame' },
    ],
  },
  {
    title: 'Editing',
    items: [
      { keys: 'S', label: 'Split selected clip at the playhead' },
      { keys: 'D', label: 'Duplicate selected clip' },
      { keys: 'Delete / Backspace', label: 'Delete selected clip' },
      { keys: 'T', label: 'Add text at the playhead' },
      { keys: 'Mod + Z', label: 'Undo' },
      { keys: 'Mod + Shift + Z / Ctrl + Y', label: 'Redo' },
    ],
  },
  {
    title: 'Workspace',
    items: [
      { keys: 'N', label: 'New project' },
      { keys: 'Mod + O', label: 'Open project' },
      { keys: 'Mod + I', label: 'Import media' },
      { keys: 'Mod + E', label: 'Export video' },
      { keys: 'C / M', label: 'Toggle chat or media panel' },
      { keys: '?', label: 'Keyboard shortcuts' },
      { keys: 'Mod + K', label: 'Commands' },
    ],
  },
] as const;

type Key = Pick<
  KeyboardEvent,
  | 'key'
  | 'ctrlKey'
  | 'metaKey'
  | 'altKey'
  | 'shiftKey'
  | 'repeat'
  | 'isComposing'
>;
export interface ShortcutContext {
  inEditor: boolean;
  editable: boolean;
  dialogOpen: boolean;
  activationControl?: boolean;
}

/** Single-key commands are scoped to the focused editor, never the chat. */
export function resolveShortcut(
  event: Key,
  context: ShortcutContext,
): EditorShortcut | undefined {
  if (
    context.editable ||
    context.dialogOpen ||
    event.isComposing ||
    event.altKey
  )
    return;
  if (event.ctrlKey && event.metaKey) return;
  const key = event.key.toLowerCase();
  const mod = event.ctrlKey || event.metaKey;
  if (mod) {
    if (event.repeat) return;
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
    if (event.shiftKey) return;
    if (key === 'y' && event.ctrlKey) return 'redo';
    if (key === 'k') return 'commands';
    if (key === 'o') return 'openProject';
    if (key === 'i') return 'import';
    if (key === 'e') return 'export';
    return;
  }
  if (!context.inEditor) return;
  if (key === 'arrowleft')
    return event.shiftKey ? 'previousTenFrames' : 'previousFrame';
  if (key === 'arrowright')
    return event.shiftKey ? 'nextTenFrames' : 'nextFrame';
  if (event.repeat) return;
  if (key === '?') return 'shortcuts';
  if (event.shiftKey) return;
  if (key === ' ' && !context.activationControl) return 'playPause';
  if (key === 'home') return 'start';
  if (key === 'end') return 'end';
  if (key === 's') return 'split';
  if (key === 'delete' || key === 'backspace') return 'delete';
  if (key === 'd') return 'duplicate';
  if (key === 't') return 'addText';
  if (key === 'n') return 'newProject';
  if (key === 'c') return 'toggleChat';
  if (key === 'm') return 'toggleMedia';
}

/** Seek to scheduled frame timestamps instead of accumulating rounded steps. */
export function frameStep(
  timeUs: number,
  frames: number,
  rate: Project['frameRate'],
  durationUs: number,
): number {
  if (durationUs <= 0) return 0;
  const lastIndex = Math.max(
    0,
    Math.ceil((durationUs * rate.num) / (1_000_000 * rate.den)) - 1,
  );
  const current = Math.round((timeUs * rate.num) / (1_000_000 * rate.den));
  return frameTimeUs(
    Math.min(lastIndex, Math.max(0, current + Math.trunc(frames))),
    rate,
  );
}
