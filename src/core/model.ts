import { z } from 'zod';
import { averageSpeed } from './speed';
import { speedRampSchema } from './speed-schema';
import { EditorError, invariant } from './errors';
import { transitionPairs, TRANSITION_TEMPLATES } from './timeline';
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
    id,
    timeUs: time,
    value: finite,
    interpolation: z.enum(['linear', 'hold']).default('linear'),
  })
  .strict();
const keyframeInputSchema = keyframeSchema.extend({ id: id.optional() });

/** Stable IDs for implicit entities, including legacy version-one keyframes. */
export function nestedId(
  kind: 'keyframe' | 'cue' | 'transition',
  owner: string,
  identity: string,
) {
  const text = JSON.stringify([kind, owner, identity]);
  let hash = 0x6c62272e07bb014262b821756295c58dn;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = BigInt.asUintN(128, hash * 0x1000000000000000000013bn);
  }
  return `${kind}-${hash.toString(16).padStart(32, '0')}`;
}
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
const clipInputSchema = z
  .object({
    id,
    kind: z.enum(['video', 'audio', 'image', 'text', 'caption']),
    assetId: id.optional(),
    groupId: id.optional(),
    startUs: time,
    durationUs: time.positive(),
    sourceInUs: time.default(0),
    sourceOutUs: time.optional(),
    speed: finite.min(0.25).max(4).default(1),
    pitchMode: z.enum(['change', 'preserve']).optional(),
    speedRamp: speedRampSchema.optional(),
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
      .partialRecord(parameterSchema, z.array(keyframeInputSchema))
      .default({}),
  })
  .strict();
const clipPatchBase = clipInputSchema.omit({
  id: true,
  kind: true,
  groupId: true,
});
// Zod's partial() retains defaults, which would reset omitted clip fields.
// Only top-level defaults are removed: a supplied replacement text style may
// still use its own defaults when parsed as a complete style.
const clipPatchShape = Object.fromEntries(
  Object.entries(clipPatchBase.shape).map(([key, schema]) => [
    key,
    (schema instanceof z.ZodDefault
      ? schema.removeDefault()
      : schema
    ).optional(),
  ]),
) as unknown as {
  [K in keyof typeof clipPatchBase.shape]: z.ZodOptional<
    (typeof clipPatchBase.shape)[K]
  >;
};
export const clipPatchSchema = z.object(clipPatchShape).strict();
export const clipSchema = clipInputSchema.transform((clip) => {
  const keyframes: Partial<
    Record<z.infer<typeof parameterSchema>, z.infer<typeof keyframeSchema>[]>
  > = {};
  for (const name of Object.keys(clip.keyframes) as z.infer<
    typeof parameterSchema
  >[]) {
    keyframes[name] = clip.keyframes[name]!.map((key) => ({
      ...key,
      id: key.id ?? nestedId('keyframe', clip.id, `${name}:${key.timeUs}`),
    }));
  }
  return { ...clip, keyframes };
});
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
    templateId: z
      .enum(TRANSITION_TEMPLATES.map((template) => template.id))
      .optional(),
    strength: finite.min(0).max(1).optional(),
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
export const assetSchema = z
  .object({
    id,
    name: z.string(),
    kind: z.enum(['video', 'audio', 'image']),
    size: time,
    type: z.string(),
    durationUs: time,
    width: finite.nonnegative(),
    height: finite.nonnegative(),
    rotation: finite,
    frameRate: finite.positive().optional(),
    videoCodec: z.string().optional(),
    audioCodec: z.string().optional(),
    sampleRate: finite.positive().optional(),
    channels: z.number().int().positive().optional(),
    status: z.enum(['ready', 'missing']),
  })
  .strict();
export const transcriptSchema = z
  .object({
    id,
    assetId: id,
    model: z.string(),
    revision: z.string(),
    language: z.string().optional(),
    cues: z.array(cueSchema),
  })
  .strict();
export const backupSchema = z
  .object({
    backupVersion: z.literal(1),
    identityVersion: z.literal(1).optional(),
    project: projectSchema,
    assets: z.array(assetSchema),
    transcripts: z.array(transcriptSchema),
  })
  .strict();
export type Asset = z.infer<typeof assetSchema>;
export type Transcript = z.infer<typeof transcriptSchema>;
export type ProjectBackup = z.infer<typeof backupSchema>;
export function validateBackup(value: unknown): ProjectBackup {
  const result = backupSchema.safeParse(value);
  if (!result.success)
    throw new EditorError('INVALID_DOCUMENT', result.error.message);
  const backup = result.data;
  backup.project = validateProject(backup.project);
  const assets = new Map(backup.assets.map((a) => [a.id, a]));
  const transcripts = new Map(backup.transcripts.map((t) => [t.id, t]));
  invariant(
    assets.size === backup.assets.length &&
      transcripts.size === backup.transcripts.length,
    'INVALID_DOCUMENT',
    'Duplicate backup records',
  );
  for (const assetId of assetIds(backup.project))
    invariant(
      assets.has(assetId),
      'INVALID_DOCUMENT',
      'Backup lacks asset metadata',
    );
  for (const clip of backup.project.tracks.flatMap((t) => t.clips)) {
    if (clip.assetId) {
      const asset = assets.get(clip.assetId)!;
      invariant(
        clip.kind === 'image'
          ? asset.kind === 'image'
          : clip.kind === 'video'
            ? asset.kind === 'video'
            : clip.kind === 'audio'
              ? !!asset.audioCodec
              : true,
        'INVALID_DOCUMENT',
        'Backup clip and source types differ',
      );
      invariant(
        !clip.sourceOutUs || clip.sourceOutUs <= asset.durationUs,
        'INVALID_DOCUMENT',
        'Backup clip exceeds source duration',
      );
    }
    if (!clip.transcriptId) continue;
    const transcript = transcripts.get(clip.transcriptId);
    invariant(
      transcript && transcript.assetId === clip.assetId,
      'INVALID_DOCUMENT',
      'Backup lacks matching transcript',
    );
  }
  for (const transcript of backup.transcripts) {
    const asset = assets.get(transcript.assetId);
    invariant(asset, 'INVALID_DOCUMENT', 'Transcript lacks source metadata');
    let previous = -1;
    const cueIds = new Set<string>();
    for (const cue of transcript.cues) {
      invariant(
        !cueIds.has(cue.id),
        'INVALID_DOCUMENT',
        `Duplicate transcript cue ID: ${cue.id}`,
      );
      cueIds.add(cue.id);
      invariant(
        cue.timeUs >= previous &&
          cue.endUs > cue.timeUs &&
          cue.endUs <= asset.durationUs,
        'INVALID_DOCUMENT',
        'Invalid source transcript timing',
      );
      previous = cue.timeUs;
    }
  }
  return backup;
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
            (clip.sourceOutUs - clip.sourceInUs) / averageSpeed(clip) -
              clip.durationUs,
          ) <= (clip.speedRamp ? 2 : 1),
          'INVALID_DOCUMENT',
          'Duration must match source range and speed',
        );
      }
      invariant(
        !clip.speedRamp || ['video', 'audio'].includes(clip.kind),
        'INVALID_DOCUMENT',
        'Speed ramps require timed media',
      );
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
          unique(key.id);
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
      for (const cue of clip.cues) {
        unique(cue.id);
        invariant(
          cue.endUs > cue.timeUs && cue.endUs <= clip.durationUs,
          'INVALID_DOCUMENT',
          'Caption outside clip',
        );
      }
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
  const groups = new Map<string, number>();
  for (const clip of project.tracks.flatMap((track) => track.clips))
    if (clip.groupId)
      groups.set(clip.groupId, (groups.get(clip.groupId) ?? 0) + 1);
  for (const [groupId, count] of groups) {
    unique(groupId);
    invariant(
      count >= 2,
      'INVALID_DOCUMENT',
      'A group requires at least two clips',
    );
  }
  for (const t of project.transitions) {
    unique(t.id);
    invariant(
      transitionPairs(project).some(
        (pair) =>
          pair.trackId === t.trackId &&
          pair.fromClipId === t.fromClipId &&
          pair.toClipId === t.toClipId,
      ),
      'INVALID_DOCUMENT',
      'Transition requires adjacent ordered overlap of visual media clips on one video track without a third clip',
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
  const parsed = projectSchema
    .pick({ width: true, height: true, frameRate: true })
    .partial()
    .strict()
    .safeParse(settings);
  if (!parsed.success)
    throw new EditorError('INVALID_DOCUMENT', parsed.error.message);
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
    ...parsed.data,
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
