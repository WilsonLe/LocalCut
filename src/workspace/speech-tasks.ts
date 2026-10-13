import type {
  SpeechAudio,
  SpeechRequest,
  SpeechTiming,
  RenderedSpeech,
} from '../ai';
import type { Connection } from './Conversation';
import type { SpeechTranscript, TaskRecord } from '../editor';

export const SPEECH_TIMING_FAILURE =
  'Speech audio is saved, but phrase timing failed. Retry timing to reuse this take without generating speech again.';

export function speechTaskError(error: NonNullable<TaskRecord['error']>) {
  // Only expose this exact locally authored diagnosis, never arbitrary provider
  // diagnostics (which may contain transcript text or credentials).
  return error.diagnostic?.message === SPEECH_TIMING_FAILURE
    ? SPEECH_TIMING_FAILURE
    : error.message + ' ' + error.action;
}

export interface SpeechTaskInput {
  request: SpeechRequest;
  timing: SpeechTiming;
  projectId: string;
  route: string;
  timingProvider?: 'local' | 'configured';
  timingRoute?: string;
}
export interface SpeechTaskResult {
  audio: SpeechAudio;
  rendered: RenderedSpeech;
  transcript?: SpeechTranscript;
}
export interface SpeechCheckpoint extends SpeechAudio {
  transcript?: SpeechTranscript;
}
export const speechTimingRoute = (connection: Connection) =>
  connection.transcriptionRoute ?? connection.provider.transcriptionDisclosure;
export const speechRoute = (connection: Connection) =>
  connection.speechRoute ?? connection.provider.selectedProvider('tts') ?? '';
export function speechTaskKind(connection: Connection) {
  let hash = 2166136261;
  for (const char of speechRoute(connection))
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `speech.generate:${hash >>> 0}`;
}
