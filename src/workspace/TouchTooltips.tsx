import { useEffect, useState, type ReactNode } from 'react';
import { TouchTooltip, getTouchTooltipContent } from '../components/ui/tooltip';

interface Help {
  anchor: HTMLElement;
  content: ReactNode;
}

/** One touch gesture owner, including tools rendered in dialog/menu portals. */
export default function TouchTooltips() {
  const [help, setHelp] = useState<Help | null>(null);
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    let dismissal: ReturnType<typeof setTimeout> | undefined;
    let press:
      | { id: number; x: number; y: number; anchor: HTMLElement; held: boolean }
      | undefined;
    let suppress: HTMLElement | undefined;
    const pointers = new Set<number>();
    const clearPending = () => {
      clearTimeout(pending);
      pending = undefined;
    };
    const dismiss = () => {
      clearPending();
      clearTimeout(dismissal);
      setHelp(null);
    };
    const down = (event: PointerEvent) => {
      dismiss();
      if (pointers.size === 0) suppress = undefined;
      press = undefined;
      if (event.pointerType !== 'touch' || event.button !== 0) return;
      pointers.add(event.pointerId);
      if (pointers.size !== 1) return;
      const anchor = (event.target as Element).closest<HTMLElement>(
        'button, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], label[title], label[aria-label]',
      );
      if (
        !anchor ||
        anchor.closest(
          '[inert], [contenteditable="true"], .timeline-clip, .timeline-overlap, .timeline-resize-handle, .media-asset-preview',
        ) ||
        anchor.matches(':disabled, [aria-disabled="true"]')
      )
        return;
      const content =
        anchor.getAttribute('aria-label') ||
        anchor.getAttribute('title') ||
        anchor
          .getAttribute('aria-labelledby')
          ?.split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent)
          .join(' ') ||
        anchor.textContent?.trim();
      if (!content) return;
      const current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        anchor,
        held: false,
      };
      press = current;
      pending = setTimeout(() => {
        if (!anchor.isConnected || anchor.getClientRects().length === 0) return;
        current.held = true;
        suppress = anchor;
        setHelp({ anchor, content: getTouchTooltipContent(anchor) ?? content });
      }, 500);
    };
    const move = (event: PointerEvent) => {
      if (
        press?.id === event.pointerId &&
        Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10
      ) {
        dismiss();
        press = undefined;
      }
    };
    const up = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (press?.id !== event.pointerId) return;
      clearPending();
      if (press.held) {
        event.preventDefault();
        event.stopImmediatePropagation();
        dismissal = setTimeout(dismiss, 1800);
      }
      press = undefined;
    };
    const cancel = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      dismiss();
      press = undefined;
      suppress = undefined;
    };
    const click = (event: MouseEvent) => {
      if (
        suppress &&
        event.detail !== 0 &&
        suppress.contains(event.target as Node)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      suppress = undefined;
    };
    const contextMenu = (event: MouseEvent) => {
      if (press || suppress) event.preventDefault();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    const reset = () => {
      dismiss();
      press = undefined;
      pointers.clear();
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', cancel, true);
    document.addEventListener('click', click, true);
    document.addEventListener('contextmenu', contextMenu, true);
    document.addEventListener('scroll', reset, true);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('blur', reset);
    window.addEventListener('resize', reset);
    window.addEventListener('hashchange', reset);
    return () => {
      clearPending();
      clearTimeout(dismissal);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', cancel, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('contextmenu', contextMenu, true);
      document.removeEventListener('scroll', reset, true);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('blur', reset);
      window.removeEventListener('resize', reset);
      window.removeEventListener('hashchange', reset);
    };
  }, []);
  return help ? <TouchTooltip {...help} /> : null;
}
