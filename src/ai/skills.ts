/** Only catalog metadata is eager. Guidance lives in separately imported modules. */
export const skillCatalog = [
  {
    id: 'speech',
    description:
      'Generate narration or clone a user voice from saved composer dictation recordings with configured OpenRouter text-to-speech, inspect models/voices and phrase-timing readiness, save measured audio and transcripts in Media, then place and mix through editing tools.',
  },
  {
    id: 'coding',
    description:
      'Read, write, edit, glob, grep, browser Bash and arbitrary isolated JavaScript in the persistent project coding directory; compose, score or improve original music and sound effects with approachable creative questions, layered arrangement and code synthesis; render WAV, retain sources, and import generated files into Media.',
  },
  {
    id: 'storyboard',
    description:
      'Author and inspect whiteboards, shot plans and diagrams; layout, style, group and layer Excalidraw shapes/text/arrows/frames/freehand and actual images/video stills; export PNG/SVG/editable scenes, store renders in Media and combine with timeline/evidence/document workflows.',
  },
  {
    id: 'editing',
    description:
      'Editorial curation, aesthetic/reference-led storytelling, pacing, sound choices and honest quality review; Media folders, file organization, project naming, tracks, timeline edits, object keyframes, audio, searchable fonts/text templates, animated text, captions, LUT/color presets, audio EQ/noise reduction, blending, masks/tracking, chroma key, groups and transitions.',
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
      'Resolve named folders or all project Media to asset IDs, inspect/reuse saved evidence and index or reindex eligible assets; explain scope, consent and import blockers.',
  },
  {
    id: 'history',
    description: 'Propose Undo or Redo of committed project edits.',
  },
] as const;
export type SkillId = (typeof skillCatalog)[number]['id'];

export async function loadSkill(id: SkillId): Promise<string> {
  switch (id) {
    case 'speech':
      return (await import('./skills/speech')).instructions;
    case 'coding':
      return (await import('./skills/coding')).instructions;
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
