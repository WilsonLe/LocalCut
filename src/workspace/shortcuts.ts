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
  | 'group'
  | 'ungroup'
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
  | 'commands'
  | 'save'
  | 'play'
  | 'pause'
  | 'previousCut'
  | 'nextCut'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomFit'
  | 'selectAll'
  | 'clearSelection'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'nudgeLeft'
  | 'nudgeRight'
  | 'nudgeTenLeft'
  | 'nudgeTenRight'
  | 'trimStart'
  | 'trimEnd'
  | 'rippleDelete'
  | 'properties';

export const SHORTCUT_GROUPS = [
  {
    title: 'Playback and timeline',
    items: [
      { keys: 'Space', label: 'Play or pause' },
      { keys: '← / →', label: 'Previous or next frame' },
      { keys: 'Shift + ← / →', label: 'Back or forward ten frames' },
      { keys: 'K / L', label: 'Pause / play forward' },
      { keys: '↑ / ↓', label: 'Previous / next edit boundary' },
      { keys: 'Home / End', label: 'Beginning or last frame' },
    ],
  },
  {
    title: 'Editing',
    items: [
      { keys: 'S / Mod + B', label: 'Split selected clip at the playhead' },
      { keys: 'D / Mod + D', label: 'Duplicate selection' },
      {
        keys: 'Shift/Mod + click',
        label: 'Add or remove clips from selection',
      },
      {
        keys: 'Mod + G / Mod + Shift + G',
        label: 'Group or ungroup selection',
      },
      { keys: 'Delete / Backspace', label: 'Delete selected clip' },
      { keys: 'Mod + A / Escape', label: 'Select all / clear selection' },
      {
        keys: 'Mod + C / X / V',
        label: 'Copy / cut / paste clips at playhead',
      },
      { keys: 'Alt + ← / →', label: 'Nudge selection one frame' },
      { keys: 'Alt + Shift + ← / →', label: 'Nudge selection ten frames' },
      { keys: 'Q / W', label: 'Trim selected clip start / end to playhead' },
      {
        keys: 'Shift + Delete',
        label: 'Ripple delete a safe selection interval',
      },
      { keys: 'Enter / double-click clip', label: 'Clip properties' },
      { keys: 'T', label: 'Add text at the playhead' },
      { keys: 'Mod + S', label: 'Save a project version' },
      { keys: 'Mod + Z', label: 'Undo' },
      { keys: 'Mod + Shift + Z / Ctrl + Y', label: 'Redo' },
    ],
  },
  {
    title: 'View and mouse',
    items: [
      {
        keys: 'Ctrl/Mod + wheel or pinch',
        label: 'Zoom timeline or preview under pointer',
      },
      { keys: '+ / −', label: 'Zoom focused timeline or preview' },
      { keys: '\\ / 0', label: 'Fit focused timeline or preview' },
      { keys: 'Shift + wheel', label: 'Scroll timeline horizontally' },
      { keys: 'Middle-button drag', label: 'Pan timeline or zoomed preview' },
      { keys: 'Click / drag ruler', label: 'Seek / scrub playhead' },
      { keys: 'Double-click preview', label: 'Fit preview' },
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
  timelineClip?: boolean;
}

/** Single-key commands are scoped to the focused editor, never the chat. */
export function resolveShortcut(
  event: Key,
  context: ShortcutContext,
): EditorShortcut | undefined {
  if (context.editable || context.dialogOpen || event.isComposing) return;
  if (event.ctrlKey && event.metaKey) return;
  const key = event.key.toLowerCase();
  const mod = event.ctrlKey || event.metaKey;
  if (event.altKey) {
    if (mod || !context.inEditor || event.repeat) return;
    if (key === 'arrowleft')
      return event.shiftKey ? 'nudgeTenLeft' : 'nudgeLeft';
    if (key === 'arrowright')
      return event.shiftKey ? 'nudgeTenRight' : 'nudgeRight';
    return;
  }
  if (mod) {
    if (event.repeat) return;
    if (context.inEditor && !event.shiftKey) {
      const edit: Record<string, EditorShortcut> = {
        a: 'selectAll',
        c: 'copy',
        x: 'cut',
        v: 'paste',
        b: 'split',
        d: 'duplicate',
      };
      if (edit[key]) return edit[key];
    }
    if (key === 's' && !event.shiftKey) return 'save';
    if (key === 'g') return event.shiftKey ? 'ungroup' : 'group';
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
  if (key === '=' || key === '+') return 'zoomIn';
  if (key === '-' || key === '_') return 'zoomOut';
  if (key === 'arrowup' && !event.shiftKey) return 'previousCut';
  if (key === 'arrowdown' && !event.shiftKey) return 'nextCut';
  if (event.repeat) return;
  if (key === 'delete' && event.shiftKey) return 'rippleDelete';
  if (key === '?') return 'shortcuts';
  if (event.shiftKey) return;
  if (key === ' ' && !context.activationControl) return 'playPause';
  if (key === '\\' || key === '0') return 'zoomFit';
  if (key === 'escape') return 'clearSelection';
  if (key === 'enter' && (!context.activationControl || context.timelineClip))
    return 'properties';
  if (key === 'q') return 'trimStart';
  if (key === 'w') return 'trimEnd';
  if (key === 'k') return 'pause';
  if (key === 'l') return 'play';
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

export function dispatchViewCommand(command: 'zoomIn' | 'zoomOut' | 'zoomFit') {
  const surface =
    document.activeElement?.closest('[data-editor-viewport]') ??
    document.querySelector('[data-editor-viewport="timeline"]');
  surface?.dispatchEvent(new CustomEvent('editor-view', { detail: command }));
}
