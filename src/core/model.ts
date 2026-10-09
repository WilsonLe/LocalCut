import { z } from 'zod';
import { EditorError, invariant } from './errors';
const id = z.string().min(1).max(200);
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const finite = z.number().finite();
export const parameterSchema = z.enum([
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'gain',
  'brightness',
  'contrast',
  'saturation',
  'grayscale',
  'blur',
]);
export const keyframeSchema = z
  .object({
    timeUs: time,
    value: finite,
    interpolation: z.enum(['linear', 'hold']).default('linear'),
  })
  .strict();
export const textStyleSchema = z
  .object({
    text: z.string().max(100000),
    fontSize: finite.positive().default(64),
    color: z.string().default('#ffffff'),
    background: z.string().default('transparent'),
    align: z.enum(['left', 'center', 'right']).default('center'),
  })
  .strict();
export const cueSchema = z
  .object({ id, timeUs: time, endUs: time, text: z.string() })
  .strict();
export const clipSchema = z
  .object({
    id,
    kind: z.enum(['video', 'audio', 'image', 'text', 'caption']),
    assetId: id.optional(),
    startUs: time,
    durationUs: time.positive(),
    sourceInUs: time.default(0),
    sourceOutUs: time.optional(),
    speed: finite.min(0.25).max(4).default(1),
    x: finite.default(0),
    y: finite.default(0),
    width: finite.positive().default(1920),
    height: finite.positive().default(1080),
    rotation: finite.default(0),
    opacity: finite.min(0).max(1).default(1),
    gain: finite.min(0).max(16).default(1),
    muted: z.boolean().default(false),
    crop: z
      .object({
        x: finite.min(0).max(1),
        y: finite.min(0).max(1),
        width: finite.positive().max(1),
        height: finite.positive().max(1),
      })
      .strict()
      .optional(),
    brightness: finite.min(0).max(4).default(1),
    contrast: finite.min(0).max(4).default(1),
    saturation: finite.min(0).max(4).default(1),
    grayscale: finite.min(0).max(1).default(0),
    blur: finite.min(0).max(100).default(0),
    fadeInUs: time.default(0),
    fadeOutUs: time.default(0),
    fadeEnvelope: z
      .object({ offsetUs: time, durationUs: time.positive() })
      .strict()
      .optional(),
    text: textStyleSchema.optional(),
    cues: z.array(cueSchema).default([]),
    transcriptId: id.optional(),
    keyframes: z
      .partialRecord(parameterSchema, z.array(keyframeSchema))
      .default({}),
  })
  .strict();
export const trackSchema = z
  .object({
    id,
    kind: z.enum(['video', 'audio', 'overlay']),
    muted: z.boolean().default(false),
    clips: z.array(clipSchema).default([]),
  })
  .strict();
export const transitionSchema = z
  .object({
    id,
    trackId: id,
    fromClipId: id,
    toClipId: id,
    kind: z.enum(['crossfade', 'black']),
  })
  .strict();
export const projectSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    name: z.string().max(1000),
    revision: time,
    width: z.number().int().positive().max(3840),
    height: z.number().int().positive().max(2160),
    frameRate: z
      .object({
        num: z.number().int().positive().max(60000),
        den: z.number().int().positive().max(1001),
      })
      .strict(),
    audio: z
      .object({ sampleRate: z.literal(48000), channels: z.literal(2) })
      .strict(),
    tracks: z.array(trackSchema),
    transitions: z.array(transitionSchema).default([]),
  })
  .strict();
export type Project = z.infer<typeof projectSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type Track = z.infer<typeof trackSchema>;
export type Cue = z.infer<typeof cueSchema>;
export type Transition = z.infer<typeof transitionSchema>;
export type Parameter = z.infer<typeof parameterSchema>;
export type Keyframe = z.infer<typeof keyframeSchema>;
export type ClipInput = z.input<typeof clipSchema>;
export type TrackInput = z.input<typeof trackSchema>;
export interface Asset {
  id: string;
  name: string;
  kind: 'video' | 'audio' | 'image';
  size: number;
  type: string;
  durationUs: number;
  width: number;
  height: number;
  rotation: number;
  frameRate?: number;
  videoCodec?: string;
  audioCodec?: string;
  sampleRate?: number;
  channels?: number;
  status: 'ready';
}
export interface Transcript {
  id: string;
  assetId: string;
  model: string;
  revision: string;
  language?: string;
  cues: Cue[];
}
export function validateProject(value: unknown): Project {
  const result = projectSchema.safeParse(value);
  if (!result.success)
    throw new EditorError('INVALID_DOCUMENT', result.error.message);
  const project = result.data,
    ids = new Set<string>();
  const unique = (key: string) => {
    invariant(!ids.has(key), 'INVALID_DOCUMENT', `Duplicate ID: ${key}`);
    ids.add(key);
  };
  unique(project.id);
  for (const track of project.tracks) {
    unique(track.id);
    for (const clip of track.clips) {
      unique(clip.id);
      invariant(
        Number.isSafeInteger(clip.startUs + clip.durationUs),
        'INVALID_DOCUMENT',
        'Clip end exceeds safe time',
      );
      if (['video', 'audio', 'image'].includes(clip.kind))
        invariant(
          clip.assetId,
          'INVALID_DOCUMENT',
          'Media clip requires asset ID',
        );
      if (['video', 'audio'].includes(clip.kind)) {
        invariant(
          clip.sourceOutUs !== undefined && clip.sourceOutUs > clip.sourceInUs,
          'INVALID_DOCUMENT',
          'Media source range required',
        );
        invariant(
          Math.abs(
            (clip.sourceOutUs - clip.sourceInUs) / clip.speed - clip.durationUs,
          ) <= 1,
          'INVALID_DOCUMENT',
          'Duration must match source range and speed',
        );
      }
      if (clip.kind === 'text')
        invariant(clip.text, 'INVALID_DOCUMENT', 'Text style required');
      invariant(
        !clip.crop ||
          (clip.crop.x + clip.crop.width <= 1 &&
            clip.crop.y + clip.crop.height <= 1),
        'INVALID_DOCUMENT',
        'Crop outside source',
      );
      invariant(
        clip.fadeInUs + clip.fadeOutUs <=
          (clip.fadeEnvelope?.durationUs ?? clip.durationUs) &&
          (!clip.fadeEnvelope ||
            clip.fadeEnvelope.offsetUs + clip.durationUs <=
              clip.fadeEnvelope.durationUs),
        'INVALID_DOCUMENT',
        'Fades exceed duration',
      );
      for (const [parameter, keys] of Object.entries(clip.keyframes)) {
        let previous = -1;
        for (const key of keys) {
          invariant(
            key.timeUs > previous && key.timeUs <= clip.durationUs,
            'INVALID_DOCUMENT',
            'Keyframes must be ordered and within clip',
          );
          previous = key.timeUs;
          const trial = clipSchema.safeParse({
            ...clip,
            [parameter]: key.value,
          });
          invariant(
            trial.success,
            'INVALID_DOCUMENT',
            `Invalid ${parameter} keyframe`,
          );
        }
      }
      for (const cue of clip.cues)
        invariant(
          cue.endUs > cue.timeUs && cue.endUs <= clip.durationUs,
          'INVALID_DOCUMENT',
          'Caption outside clip',
        );
      if (track.kind === 'audio')
        invariant(
          clip.kind === 'audio',
          'INVALID_DOCUMENT',
          'Audio track accepts audio clips',
        );
      if (track.kind === 'overlay')
        invariant(
          ['text', 'caption', 'image'].includes(clip.kind),
          'INVALID_DOCUMENT',
          'Overlay track accepts overlays',
        );
    }
  }
  for (const t of project.transitions) {
    unique(t.id);
    const track = project.tracks.find((x) => x.id === t.trackId);
    const a = track?.clips.find((x) => x.id === t.fromClipId),
      b = track?.clips.find((x) => x.id === t.toClipId);
    invariant(
      track?.kind === 'video' && a?.kind === 'video' && b?.kind === 'video',
      'INVALID_DOCUMENT',
      'Transition requires two video clips on same track',
    );
    invariant(
      a.startUs < b.startUs &&
        b.startUs < a.startUs + a.durationUs &&
        b.startUs + b.durationUs >= a.startUs + a.durationUs,
      'INVALID_DOCUMENT',
      'Transition requires ordered overlap',
    );
    const ordered = [...track.clips].sort((x, y) => x.startUs - y.startUs);
    invariant(
      ordered.indexOf(b) === ordered.indexOf(a) + 1,
      'INVALID_DOCUMENT',
      'Transition clips must be adjacent',
    );
    const start = b.startUs,
      end = a.startUs + a.durationUs;
    invariant(
      !track.clips.some(
        (c) =>
          c.id !== a.id &&
          c.id !== b.id &&
          c.startUs < end &&
          c.startUs + c.durationUs > start,
      ),
      'INVALID_DOCUMENT',
      'Transition intersects third clip',
    );
    invariant(
      !project.transitions.some(
        (o) =>
          o.id !== t.id &&
          o.trackId === t.trackId &&
          o.fromClipId === t.fromClipId &&
          o.toClipId === t.toClipId,
      ),
      'INVALID_DOCUMENT',
      'Duplicate transition',
    );
  }
  return project;
}
export function newProject(
  name: string,
  settings: Partial<Pick<Project, 'width' | 'height' | 'frameRate'>> = {},
): Project {
  return validateProject({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name,
    revision: 0,
    width: 1920,
    height: 1080,
    frameRate: { num: 30, den: 1 },
    audio: { sampleRate: 48000, channels: 2 },
    tracks: [],
    transitions: [],
    ...settings,
  });
}
export function durationUs(project: Project): number {
  return Math.max(
    0,
    ...project.tracks.flatMap((t) =>
      t.clips.map((c) => c.startUs + c.durationUs),
    ),
  );
}
export function assetIds(project: Project): string[] {
  return [
    ...new Set(
      project.tracks.flatMap((t) =>
        t.clips.flatMap((c) => (c.assetId ? [c.assetId] : [])),
      ),
    ),
  ];
}
