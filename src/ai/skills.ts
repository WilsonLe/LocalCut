import type { AssistantCapabilities } from './actions';

/** Only catalog metadata is eager. Guidance lives in separately imported modules. */
export const skillCatalog = [
  {
    id: 'editing',
    description:
      'Timeline edits, clips, audio, text, captions, effects, groups and transitions.',
  },
  {
    id: 'export',
    description:
      'Check browser encoding support and propose a local MP4/WebM export.',
  },
  {
    id: 'transcription',
    description:
      'Inspect local speech readiness, prepare models, transcribe or read shared transcripts.',
  },
  {
    id: 'history',
    description: 'Propose Undo or Redo of committed project edits.',
  },
] as const;
export type SkillId = (typeof skillCatalog)[number]['id'];

export function availableSkills(
  capabilities: AssistantCapabilities,
  includeTranscripts: boolean,
) {
  return skillCatalog.filter(
    ({ id }) =>
      id === 'editing' ||
      (id === 'export' && capabilities.export) ||
      (id === 'history' && (capabilities.undo || capabilities.redo)) ||
      (id === 'transcription' &&
        (includeTranscripts ||
          capabilities.transcriptionStatus ||
          capabilities.transcription ||
          capabilities.transcriptionPreparation)),
  );
}

export async function loadSkill(id: SkillId): Promise<string> {
  switch (id) {
    case 'editing':
      return (await import('./skills/editing')).instructions;
    case 'export':
      return (await import('./skills/export')).instructions;
    case 'transcription':
      return (await import('./skills/transcription')).instructions;
    case 'history':
      return (await import('./skills/history')).instructions;
  }
}
