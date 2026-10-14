import { REFERENCE_SPEECH_MODEL } from './speech';
import {
  validElevenLabsSettings,
  elevenLabsSchema,
  elevenLabsCapabilities,
} from './elevenlabs';
import type { ElevenLabsSettings } from './elevenlabs';

export const VOICE_PRESETS_KEY = 'localcut.voice-presets.v1';
export type VoiceTiming =
  | { mode: 'speed'; speed: number }
  | { mode: 'duration'; durationSeconds: number };
export interface VoiceSettings {
  model: string;
  voice: string;
  languages: string[];
  instructions: string;
  timing?: VoiceTiming;
  elevenlabs?: ElevenLabsSettings;
}
export interface VoicePreset extends VoiceSettings {
  id: string;
  name: string;
  archived: boolean;
  referenceId?: string;
  source?: {
    projectId: string;
    assetId: string;
    transcriptId: string;
    generationId: string;
    createdAt: number;
  };
}
const validSource = (source: NonNullable<VoicePreset['source']>) =>
  source &&
  ['projectId', 'assetId', 'transcriptId', 'generationId'].every((key) => {
    const value = source[key as 'projectId'];
    return typeof value === 'string' && value.length > 0 && value.length <= 200;
  }) &&
  Number.isSafeInteger(source.createdAt) &&
  source.createdAt >= 0;
const bounded = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;
export function validVoiceTiming(value: unknown): value is VoiceTiming {
  if (!value || typeof value !== 'object') return false;
  const timing = value as VoiceTiming;
  return timing.mode === 'speed'
    ? Number.isFinite(timing.speed) && timing.speed >= 0.5 && timing.speed <= 2
    : timing.mode === 'duration' &&
        Number.isFinite(timing.durationSeconds) &&
        timing.durationSeconds > 0;
}
export function voiceTimingLabel(timing?: VoiceTiming) {
  if (!timing) return 'Timing not saved';
  return timing.mode === 'speed'
    ? `${timing.speed}× speed`
    : `${timing.durationSeconds}s total length`;
}
export function validVoiceSettings(value: VoiceSettings): boolean {
  return (
    bounded(value.model, 256) &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value.model) &&
    bounded(value.voice, 80) &&
    /^[A-Za-z0-9_-]+$/.test(value.voice) &&
    Array.isArray(value.languages) &&
    (elevenLabsCapabilities(value.model) ||
      value.model === REFERENCE_SPEECH_MODEL ||
      value.languages.length >= 1) &&
    value.languages.length <= 8 &&
    value.languages.every(
      (language) => bounded(language, 80) && !!language.trim(),
    ) &&
    bounded(value.instructions, 1500) &&
    (value.timing === undefined || validVoiceTiming(value.timing)) &&
    (value.elevenlabs === undefined ||
      validElevenLabsSettings(value.model, value.elevenlabs))
  );
}
export function parseVoicePresets(raw: string | null): VoicePreset[] {
  try {
    const record = JSON.parse(raw ?? 'null');
    if (record?.version !== 1 || !Array.isArray(record.presets)) return [];
    const ids = new Set<string>();
    const result: VoicePreset[] = [];
    for (const p of record.presets.slice(0, 100)) {
      if (
        !p ||
        !bounded(p.id, 80) ||
        !/^[A-Za-z0-9_-]+$/.test(p.id) ||
        ids.has(p.id) ||
        !bounded(p.name, 100) ||
        !p.name.trim() ||
        typeof p.archived !== 'boolean' ||
        (p.referenceId !== undefined &&
          (!bounded(p.referenceId, 80) ||
            !/^[A-Za-z0-9_-]+$/.test(p.referenceId))) ||
        (p.source !== undefined && !validSource(p.source)) ||
        !validVoiceSettings(p)
      )
        continue;
      ids.add(p.id);
      result.push({
        id: p.id,
        name: p.name.trim(),
        archived: p.archived,
        model: p.model,
        voice: p.voice,
        languages: [...new Set(p.languages)] as string[],
        instructions: p.instructions,
        ...(p.elevenlabs
          ? { elevenlabs: elevenLabsSchema.parse(p.elevenlabs) }
          : {}),
        ...(p.timing
          ? {
              timing:
                p.timing.mode === 'speed'
                  ? { mode: 'speed' as const, speed: p.timing.speed }
                  : {
                      mode: 'duration' as const,
                      durationSeconds: p.timing.durationSeconds,
                    },
            }
          : {}),
        ...(p.referenceId ? { referenceId: p.referenceId } : {}),
        ...(p.source
          ? {
              source: {
                projectId: p.source.projectId,
                assetId: p.source.assetId,
                transcriptId: p.source.transcriptId,
                generationId: p.source.generationId,
                createdAt: p.source.createdAt,
              },
            }
          : {}),
      });
    }
    return result;
  } catch {
    return [];
  }
}
let presets: VoicePreset[] = [];
const listeners = new Set<() => void>();
let initialized = false;
const notify = () => {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* A consumer cannot turn a persisted voice into a failed save. */
    }
  }
};
export function initializeVoicePresets() {
  if (initialized) return;
  initialized = true;
  try {
    presets = parseVoicePresets(localStorage.getItem(VOICE_PRESETS_KEY));
  } catch {
    presets = [];
  }
  window.addEventListener('storage', (event) => {
    if (event.key !== VOICE_PRESETS_KEY && event.key !== null) return;
    try {
      presets = parseVoicePresets(localStorage.getItem(VOICE_PRESETS_KEY));
      notify();
    } catch {
      /* Preserve the last readable list; mutations still report denied storage. */
    }
  });
  notify();
}
/** Patch the latest stored list; publish only after a successful local write. */
export function changeVoicePresets(
  change: (current: VoicePreset[]) => VoicePreset[],
) {
  try {
    const current = parseVoicePresets(localStorage.getItem(VOICE_PRESETS_KEY));
    const next = change(current);
    const serialized = JSON.stringify({ version: 1, presets: next });
    const validated = parseVoicePresets(serialized);
    if (next.length > 100 || validated.length !== next.length)
      throw new Error('Use valid voice settings and keep at most 100 presets.');
    localStorage.setItem(
      VOICE_PRESETS_KEY,
      JSON.stringify({ version: 1, presets: validated }),
    );
    presets = validated;
    notify();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Use valid'))
      throw error;
    throw new Error(
      'Voice preset could not be saved. Allow browser storage and try again.',
      { cause: error },
    );
  }
}
export const subscribeVoicePresets = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const voicePresetsSnapshot = () => presets;
/** Explicit discovery reads current storage, including saved records from another tab. */
export function readVoicePresets() {
  return parseVoicePresets(localStorage.getItem(VOICE_PRESETS_KEY));
}
