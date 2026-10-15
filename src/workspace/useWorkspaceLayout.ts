import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { interfaceScale } from './appearance';
import { useChatViewport } from './useChatViewport';
import { hasBlockingOverlay } from './overlays';
import {
  saveWorkspacePreferences,
  useWorkspacePreferences,
} from './preferences';
import { showErrorToast } from './error-toast';
import type { MobileTab } from './MobileNavigation';

/** Responsive panel state and focus recovery; persisted layout remains in preferences. */
export function useWorkspaceLayout() {
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
  const [narrow, setNarrow] = useState(
    () => window.matchMedia(narrowQuery).matches,
  );
  const [mobileTab, setMobileTab] = useState<MobileTab>('edit');
  const composerFocused = useChatViewport(
    narrow && mobileTab === 'chat',
    scale,
  );
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
              tab === 'chat' ? '.chat-session-trigger' : '#workspace-media',
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
            active?.closest('[inert], #workspace-media') ||
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
      showErrorToast(
        undefined,
        'Workspace preferences could not be saved. Allow browser storage to keep them after reload.',
      );
  }, [preferencesSaved]);
  const onMediaFocus = () => {
    mediaHasFocus.current = true;
  };
  const onMediaBlur = (event: {
    currentTarget: HTMLElement;
    relatedTarget: EventTarget | null;
  }) => {
    if (
      window.matchMedia(narrowQuery).matches === narrow &&
      event.relatedTarget !== null &&
      !event.currentTarget.contains(event.relatedTarget as Node)
    )
      mediaHasFocus.current = false;
  };
  return {
    narrow,
    mobileTab,
    setMobileTab,
    selectMobileTab,
    composerFocused,
    onMediaFocus,
    onMediaBlur,
    mediaTriggerRef,
    mediaLoaded,
    drawer,
    setMediaOverride,
    toggleMedia,
    toggleChat,
    visibleChatCollapsed,
    chatCollapsed,
    format,
    setFormat,
  };
}
