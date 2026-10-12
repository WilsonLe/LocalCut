/** Only catalog metadata is eager. Guidance lives in separately imported modules. */
export const skillCatalog = [
  {
    id: 'storyboard',
    description:
      'Inspect and edit the project Storyboard: Excalidraw shapes, shot panels, text, arrows, frames and freehand drawings.',
  },
  {
    id: 'editing',
    description:
      'Project naming, tracks, timeline edits, object keyframes, audio, searchable fonts/text templates, animated text, captions, effects, groups and transitions.',
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
    id: 'indexing',
    description:
      'Index or reindex assets: inspect permitted media, explain consent blockers, and propose derived-evidence indexing for explicit approval.',
  },
  {
    id: 'history',
    description: 'Propose Undo or Redo of committed project edits.',
  },
] as const;
export type SkillId = (typeof skillCatalog)[number]['id'];

export async function loadSkill(id: SkillId): Promise<string> {
  switch (id) {
    case 'storyboard':
      return (await import('./skills/storyboard')).instructions;
    case 'editing':
      return (await import('./skills/editing')).instructions;
    case 'export':
      return (await import('./skills/export')).instructions;
    case 'transcription':
      return (await import('./skills/transcription')).instructions;
    case 'indexing':
      return (await import('./skills/indexing')).instructions;
    case 'history':
      return (await import('./skills/history')).instructions;
  }
}
