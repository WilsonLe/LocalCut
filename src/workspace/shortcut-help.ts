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
      {
        keys: 'Drag playhead / click or drag ruler',
        label: 'Seek / scrub playhead',
      },
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
