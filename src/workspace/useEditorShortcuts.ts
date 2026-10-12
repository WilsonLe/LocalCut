import { hasBlockingOverlay } from './overlays';
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
      if (target?.closest('[data-storyboard]')) return;
      const command = resolveShortcut(event, {
        inEditor: !!target?.closest('[data-editor-shortcuts]'),
        editable: !!target?.closest(
          'input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox]',
        ),
        dialogOpen: hasBlockingOverlay(),
        timelineClip: !!target?.closest('.timeline-clip'),
        activationControl: !!target?.closest(
          'button,a[href],summary,[role=button]',
        ),
      });
      const action = command && actions[command];
      if (!action) return;
      event.preventDefault();
      action(event);
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [enabled, actions]);
}
