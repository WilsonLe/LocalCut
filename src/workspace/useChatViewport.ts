import { useLayoutEffect, useState } from 'react';

/** Keep the active heading at the visible top and fit only chat content above the keyboard. */
export function useChatViewport(active: boolean, scale: number) {
  const [focused, setFocused] = useState(false);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const update = () => {
      const input = document.activeElement;
      const composing =
        active &&
        input instanceof HTMLElement &&
        !!input.closest('.conversation-session:not([hidden]) .chat-composer');
      setFocused(composing);
      root.style.setProperty(
        '--chat-viewport-height',
        `${(viewport?.height ?? window.innerHeight) / scale}px`,
      );
      root.style.setProperty(
        '--chat-viewport-top',
        `${composing ? (viewport?.offsetTop ?? 0) / scale : 0}px`,
      );
    };
    update();
    document.addEventListener('focusin', update);
    const blur = () => queueMicrotask(update);
    document.addEventListener('focusout', blur);
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', blur);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      root.style.removeProperty('--chat-viewport-height');
      root.style.removeProperty('--chat-viewport-top');
    };
  }, [active, scale]);
  return active && focused;
}
