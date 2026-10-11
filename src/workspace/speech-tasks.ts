import type {
  SpeechAudio,
  SpeechRequest,
  SpeechTiming,
  RenderedSpeech,
} from '../ai';
import type { Connection } from './Conversation';
export interface SpeechTaskInput {
  request: SpeechRequest;
  timing: SpeechTiming;
  projectId: string;
  route: string;
}
export interface SpeechTaskResult {
  audio: SpeechAudio;
  rendered: RenderedSpeech;
}
export const speechRoute = (connection: Connection) =>
  connection.speechRoute ?? connection.provider.selectedProvider('tts') ?? '';
export function speechTaskKind(connection: Connection) {
  let hash = 2166136261;
  for (const char of speechRoute(connection))
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `speech.generate:${hash >>> 0}`;
}
