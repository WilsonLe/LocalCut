import { useSyncExternalStore } from 'react';
import { parseProviderConfiguration } from './provider-preferences';

export const WORKSPACE_PREFERENCES_KEY = 'localcut.workspace-preferences.v1';
export const CHAT_MIN_WIDTH = 280;
export const CHAT_MAX_WIDTH = 560;
export interface WorkspacePreferences {
  chatWidth: number;
  mediaWidth: number;
  timelineHeight: number;
  chatCollapsed: boolean;
  mediaOpen: boolean;
  timelineSnapping: boolean;
  exportFormat: 'mp4' | 'webm';
  aiModel: string;
  aiProviders: string;
}
export const defaultWorkspacePreferences: WorkspacePreferences = {
  chatWidth: 320,
  mediaWidth: 300,
  timelineHeight: 260,
  chatCollapsed: false,
  mediaOpen: false,
  timelineSnapping: true,
  exportFormat: 'mp4',
  aiModel: '',
  aiProviders: '',
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
    for (const [field, min, max] of [
      ['mediaWidth', 250, 560],
      ['timelineHeight', 210, 700],
    ] as const) {
      const value =
        field in p ? (p as Record<string, unknown>)[field] : undefined;
      if (typeof value === 'number' && Number.isFinite(value))
        result[field] = Math.round(Math.max(min, Math.min(max, value)));
    }
    if ('chatCollapsed' in p && typeof p.chatCollapsed === 'boolean')
      result.chatCollapsed = p.chatCollapsed;
    if ('mediaOpen' in p && typeof p.mediaOpen === 'boolean')
      result.mediaOpen = p.mediaOpen;
    if ('timelineSnapping' in p && typeof p.timelineSnapping === 'boolean')
      result.timelineSnapping = p.timelineSnapping;
    if (
      'exportFormat' in p &&
      (p.exportFormat === 'mp4' || p.exportFormat === 'webm')
    )
      result.exportFormat = p.exportFormat;
    if (
      'aiProviders' in p &&
      typeof p.aiProviders === 'string' &&
      p.aiProviders
    )
      result.aiProviders = JSON.stringify(
        parseProviderConfiguration(p.aiProviders),
      );
    if (
      'aiModel' in p &&
      typeof p.aiModel === 'string' &&
      // Match the provider catalog's bounded IDs, including supported aliases.
      !p.aiModel.includes('://') &&
      (p.aiModel === '' ||
        /^~?[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(p.aiModel)) &&
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
  return saved;
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
