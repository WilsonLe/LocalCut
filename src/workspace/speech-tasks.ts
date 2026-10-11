import type {
  SpeechAudio,
  SpeechRequest,
  SpeechTiming,
  RenderedSpeech,
} from '../ai';
import type { Connection } from './Conversation';
import type { SpeechTranscript } from '../editor';
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
