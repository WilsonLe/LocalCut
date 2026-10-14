import { useEffect, useSyncExternalStore } from 'react';
import {
  initializeVoicePresets,
  subscribeVoicePresets,
  voicePresetsSnapshot,
} from '../ai/voice-presets';
export * from '../ai/voice-presets';
export function useVoicePresets() {
  useEffect(initializeVoicePresets, []);
  return useSyncExternalStore(subscribeVoicePresets, voicePresetsSnapshot);
}
