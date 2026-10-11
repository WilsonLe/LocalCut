import { openDB } from 'idb';
import type { DBSchema } from 'idb';
import type { SpeechTranscript } from '../core/model';

export interface VoiceReference {
  file: Blob;
  transcript: string;
  timing?: SpeechTranscript;
}
interface VoiceReferenceDatabase extends DBSchema {
  references: { key: string; value: VoiceReference };
}
/** Only explicitly saved generated takes; independent of projects/task eviction. */
async function database() {
  return openDB<VoiceReferenceDatabase>('localcut-voice-references-v1', 1, {
    upgrade(db) {
      db.createObjectStore('references');
    },
  });
}
export async function saveVoiceReference(
  id: string,
  reference: VoiceReference,
) {
  const db = await database();
  try {
    await db.put('references', reference, id);
  } finally {
    db.close();
  }
}
export async function readVoiceReference(id: string) {
  const db = await database();
  try {
    return await db.get('references', id);
  } finally {
    db.close();
  }
}
export async function removeVoiceReference(id: string) {
  const db = await database();
  try {
    await db.delete('references', id);
  } finally {
    db.close();
  }
}
