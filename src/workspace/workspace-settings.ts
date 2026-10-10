import {
  appearanceOptions,
  defaultAppearance,
  getAppearance,
  saveAppearance,
} from './appearance';
import type { Appearance } from './appearance';
import {
  defaultWorkspacePreferences,
  getWorkspacePreferences,
  parseWorkspacePreferences,
  saveWorkspacePreferences,
} from './preferences';
import type { WorkspacePreferences } from './preferences';
import type { WorkspaceSettings } from '../editor';

export function workspaceSettings(): WorkspaceSettings {
  return {
    appearance: { ...getAppearance().preferences },
    workspace: { ...getWorkspacePreferences().preferences },
  };
}
/** Backups must contain complete, whitelisted groups, not arbitrary origin storage. */
export function validateWorkspaceSettings(
  settings: WorkspaceSettings | undefined,
) {
  if (!settings) return;
  if (settings.appearance) {
    const p: Record<string, unknown> = {
      interfaceSize: defaultAppearance.interfaceSize,
      ...settings.appearance,
    };
    if (
      Object.keys(p).length !== Object.keys(appearanceOptions).length ||
      Object.entries(appearanceOptions).some(
        ([key, options]) =>
          typeof p[key] !== 'string' ||
          !(options as readonly string[]).includes(p[key] as string),
      )
    )
      throw new Error('Invalid appearance settings in backup');
  }
  if (settings.workspace) {
    const p = { ...settings.workspace };
    if (!('aiProviders' in p)) p.aiProviders = '';
    const parsed = parseWorkspacePreferences(
      JSON.stringify({ version: 1, preferences: p }),
    );
    if (
      Object.keys(p).length !==
        Object.keys(defaultWorkspacePreferences).length ||
      Object.entries(parsed).some(([key, value]) => value !== p[key])
    )
      throw new Error('Invalid workspace settings in backup');
  }
}
export function importWorkspaceSettings(
  settings: WorkspaceSettings,
  appearance: boolean,
  workspace: boolean,
) {
  validateWorkspaceSettings(settings);
  const failures: string[] = [];
  if (
    appearance &&
    settings.appearance &&
    !saveAppearance({
      interfaceSize: defaultAppearance.interfaceSize,
      ...settings.appearance,
    } as Appearance)
  )
    failures.push('appearance');
  if (
    workspace &&
    settings.workspace &&
    !saveWorkspacePreferences(
      settings.workspace as unknown as WorkspacePreferences,
    )
  )
    failures.push('workspace settings');
  return failures;
}
