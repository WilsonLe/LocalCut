import { useSyncExternalStore } from 'react';

export const WORKSPACE_PREFERENCES_KEY = 'localcut.workspace-preferences.v1';
export const CHAT_MIN_WIDTH = 280;
export const CHAT_MAX_WIDTH = 560;
export interface WorkspacePreferences {
  chatWidth: number;
  chatCollapsed: boolean;
  mediaOpen: boolean;
  exportFormat: 'mp4' | 'webm';
  aiModel: string;
}
export const defaultWorkspacePreferences: WorkspacePreferences = {
  chatWidth: 320,
  chatCollapsed: false,
  mediaOpen: false,
  exportFormat: 'mp4',
  aiModel: '',
};

/** Whitelist durable choices; never hydrate credentials, consent or project state. */
export function parseWorkspacePreferences(
  raw: string | null,
): WorkspacePreferences {
  const result = { ...defaultWorkspacePreferences };
  try {
    const record = JSON.parse(raw ?? 'null') as unknown;
    if (
      !record ||
      typeof record !== 'object' ||
      !('version' in record) ||
      record.version !== 1 ||
      !('preferences' in record)
    )
      return result;
    const p = record.preferences;
    if (!p || typeof p !== 'object' || Array.isArray(p)) return result;
    if (
      'chatWidth' in p &&
      typeof p.chatWidth === 'number' &&
      Number.isFinite(p.chatWidth)
    )
      result.chatWidth = Math.round(
        Math.max(CHAT_MIN_WIDTH, Math.min(CHAT_MAX_WIDTH, p.chatWidth)),
      );
    if ('chatCollapsed' in p && typeof p.chatCollapsed === 'boolean')
      result.chatCollapsed = p.chatCollapsed;
    if ('mediaOpen' in p && typeof p.mediaOpen === 'boolean')
      result.mediaOpen = p.mediaOpen;
    if (
      'exportFormat' in p &&
      (p.exportFormat === 'mp4' || p.exportFormat === 'webm')
    )
      result.exportFormat = p.exportFormat;
    if (
      'aiModel' in p &&
      typeof p.aiModel === 'string' &&
      p.aiModel.length <= 200 &&
      (p.aiModel === '' || /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(p.aiModel)) &&
      p.aiModel !== 'openrouter/auto'
    )
      result.aiModel = p.aiModel;
  } catch {
    /* Corrupt/unsupported data leaves safe field defaults. */
  }
  return result;
}

let snapshot = { preferences: { ...defaultWorkspacePreferences }, saved: true };
const listeners = new Set<() => void>();
let initialized = false;
function publish() {
  for (const listener of listeners) listener();
}

/** localStorage only: no editor, project storage, workers or provider requests. */
export function initializeWorkspacePreferences() {
  if (initialized) return;
  initialized = true;
  try {
    snapshot = {
      preferences: parseWorkspacePreferences(
        localStorage.getItem(WORKSPACE_PREFERENCES_KEY),
      ),
      saved: true,
    };
  } catch {
    snapshot = { ...snapshot, saved: false };
  }
  window.addEventListener('storage', (event) => {
    try {
      if (
        event.storageArea !== localStorage ||
        (event.key !== WORKSPACE_PREFERENCES_KEY && event.key !== null)
      )
        return;
      // Read current data: a queued event may precede a more recent local write.
      snapshot = {
        preferences: parseWorkspacePreferences(
          localStorage.getItem(WORKSPACE_PREFERENCES_KEY),
        ),
        saved: true,
      };
    } catch {
      snapshot = { ...snapshot, saved: false };
    }
    publish();
  });
}

export function saveWorkspacePreferences(patch: Partial<WorkspacePreferences>) {
  let current = snapshot.preferences;
  if (snapshot.saved) {
    try {
      current = parseWorkspacePreferences(
        localStorage.getItem(WORKSPACE_PREFERENCES_KEY),
      );
    } catch {
      /* Continue using this session's choices when reads are denied. */
    }
  }
  const preferences = parseWorkspacePreferences(
    JSON.stringify({ version: 1, preferences: { ...current, ...patch } }),
  );
  let saved = true;
  try {
    localStorage.setItem(
      WORKSPACE_PREFERENCES_KEY,
      JSON.stringify({ version: 1, preferences }),
    );
  } catch {
    saved = false;
  }
  snapshot = { preferences, saved };
  publish();
}
export const getWorkspacePreferences = () => snapshot;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useWorkspacePreferences() {
  return useSyncExternalStore(subscribe, getWorkspacePreferences);
}
