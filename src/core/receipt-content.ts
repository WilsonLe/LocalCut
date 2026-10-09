import { z } from 'zod';
import { canonical } from './commands';

// Frozen receipt normalization from 984107dbf63dc95cc72f980b65bfaae6e86bc727.
// Unversioned receipts contain canonical(parseBatch(input)) from that release.
// Keep these schemas independent of current model/command validation: even its
// accidental updateClip defaults are part of the persisted receipt fingerprint.
const id = z.string().min(1).max(200);
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const finite = z.number().finite();
const parameterSchema = z.enum([
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
const keyframeSchema = z
  .object({
    timeUs: time,
    value: finite,
    interpolation: z.enum(['linear', 'hold']).default('linear'),
  })
  .strict();
const textStyleSchema = z
  .object({
    text: z.string().max(100000),
    fontSize: finite.positive().default(64),
    color: z.string().default('#ffffff'),
    background: z.string().default('transparent'),
    align: z.enum(['left', 'center', 'right']).default('center'),
  })
  .strict();
const cueSchema = z
  .object({ id, timeUs: time, endUs: time, text: z.string() })
  .strict();
const clipSchema = z
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
const trackSchema = z
  .object({
    id,
    kind: z.enum(['video', 'audio', 'overlay']),
    muted: z.boolean().default(false),
    clips: z.array(clipSchema).default([]),
  })
  .strict();
const transitionSchema = z
  .object({
    id,
    trackId: id,
    fromClipId: id,
    toClipId: id,
    kind: z.enum(['crossfade', 'black']),
  })
  .strict();
const operationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('addTrack'), track: trackSchema }).strict(),
  z.object({ type: z.literal('removeTrack'), trackId: z.string() }).strict(),
  z
    .object({
      type: z.literal('reorderTrack'),
      trackId: z.string(),
      index: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal('insertClip'),
      trackId: z.string(),
      clip: clipSchema,
    })
    .strict(),
  z.object({ type: z.literal('removeClip'), clipId: z.string() }).strict(),
  z
    .object({
      type: z.literal('updateClip'),
      clipId: z.string(),
      patch: clipSchema.omit({ id: true, kind: true }).partial(),
    })
    .strict(),
  z
    .object({
      type: z.literal('trimClip'),
      clipId: z.string(),
      sourceInUs: z.number().int().nonnegative(),
      sourceOutUs: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal('splitClip'),
      clipId: z.string(),
      atUs: z.number().int().nonnegative(),
      rightClipId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('moveClip'),
      clipId: z.string(),
      trackId: z.string(),
      startUs: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal('duplicateClip'),
      clipId: z.string(),
      newClipId: z.string(),
      trackId: z.string(),
      startUs: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal('setSpeed'),
      clipId: z.string(),
      speed: z.number().min(0.25).max(4),
    })
    .strict(),
  z
    .object({
      type: z.literal('ripple'),
      trackId: z.string(),
      fromUs: z.number().int().nonnegative(),
      deltaUs: z.number().int(),
    })
    .strict(),
  z
    .object({ type: z.literal('addTransition'), transition: transitionSchema })
    .strict(),
  z
    .object({ type: z.literal('removeTransition'), transitionId: z.string() })
    .strict(),
]);
const batchSchema = z
  .object({
    projectId: z.string().min(1),
    requestId: z.string().min(1),
    expectedRevision: z.number().int().nonnegative(),
    operations: z.array(operationSchema).min(1).max(1000),
  })
  .strict();

/** Match a request only against the unversioned receipt format from the base release. */
export function legacyCommandReceiptContent(
  input: unknown,
): string | undefined {
  const result = batchSchema.safeParse(input);
  return result.success ? canonical(result.data) : undefined;
}
