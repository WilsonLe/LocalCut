import { useEffect } from 'react';
import { resolveShortcut } from './shortcuts';
import type { EditorShortcut } from './shortcuts';

export interface EditorShortcutOptions {
  enabled: boolean;
  actions: Partial<Record<EditorShortcut, (event: KeyboardEvent) => void>>;
}

export function useEditorShortcuts({
  enabled,
  actions,
}: EditorShortcutOptions) {
  useEffect(() => {
    if (!enabled) return;
    const handle = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      const action = resolveShortcut(event, {
        inEditor: !!target?.closest('[data-editor-shortcuts]'),
        editable: !!target?.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
        ),
        dialogOpen: !!document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
        ),
        timelineClip: !!target?.closest('.timeline-clip'),
        activationControl: !!target?.closest(
          'button, a[href], summary, [role="button"]',
        ),
      });
      if (!action || !actions[action]) return;
      event.preventDefault();
      actions[action](event);
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [enabled, actions]);
}
