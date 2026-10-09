import { z } from 'zod';
import {
  clipSchema,
  clipPatchSchema,
  nestedId,
  trackSchema,
  transitionSchema,
  validateProject,
} from './model';
import type {
  Clip,
  ClipInput,
  Project,
  TrackInput,
  Transition,
  Parameter,
} from './model';
import { invariant, EditorError } from './errors';
import { evaluateKeys } from './timing';
export type EditOperation =
  | { type: 'addTrack'; track: TrackInput }
  | { type: 'removeTrack'; trackId: string }
  | { type: 'reorderTrack'; trackId: string; index: number }
  | { type: 'insertClip'; trackId: string; clip: ClipInput }
  | { type: 'removeClip'; clipId: string }
  | {
      type: 'updateClip';
      clipId: string;
      patch: z.input<typeof clipPatchSchema>;
    }
  | {
      type: 'trimClip';
      clipId: string;
      sourceInUs: number;
      sourceOutUs: number;
    }
  | { type: 'splitClip'; clipId: string; atUs: number; rightClipId: string }
  | { type: 'moveClip'; clipId: string; trackId: string; startUs: number }
  | {
      type: 'duplicateClip';
      clipId: string;
      newClipId: string;
      trackId: string;
      startUs: number;
    }
  | { type: 'setSpeed'; clipId: string; speed: number }
  | { type: 'ripple'; trackId: string; fromUs: number; deltaUs: number }
  | { type: 'addTransition'; transition: Transition }
  | { type: 'removeTransition'; transitionId: string };
export interface CommandBatch {
  projectId: string;
  requestId: string;
  expectedRevision: number;
  operations: EditOperation[];
}
export interface EditReceipt {
  requestId: string;
  projectId: string;
  appliedRevision: number;
  affectedIds: string[];
  warnings: string[];
}
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
      patch: clipPatchSchema,
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
export const batchSchema = z
  .object({
    projectId: z.string().min(1),
    requestId: z.string().min(1),
    expectedRevision: z.number().int().nonnegative(),
    operations: z.array(operationSchema).min(1).max(1000),
  })
  .strict();
export function parseBatch(input: unknown): CommandBatch {
  const r = batchSchema.safeParse(input);
  if (!r.success) throw new EditorError('INVALID_COMMAND', r.error.message);
  return r.data;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
function splitKeys(
  clip: Clip,
  offset: number,
  rightClipId: string,
): [Clip['keyframes'], Clip['keyframes']] {
  const left: Clip['keyframes'] = {},
    right: Clip['keyframes'] = {};
  for (const name of Object.keys(clip.keyframes) as Parameter[]) {
    const keys = clip.keyframes[name]!;
    if (!keys.length) {
      left[name] = [];
      right[name] = [];
      continue;
    }
    const v = evaluateKeys(keys, offset, clip[name]);
    const interpolation =
      keys.filter((k) => k.timeUs <= offset).at(-1)?.interpolation ?? 'linear';
    left[name] = [
      ...keys.filter((k) => k.timeUs < offset),
      {
        id:
          keys.find((k) => k.timeUs === offset)?.id ??
          nestedId('keyframe', clip.id, `split:${name}:${offset}`),
        timeUs: offset,
        value: v,
        interpolation,
      },
    ];
    right[name] = [
      {
        id: nestedId('keyframe', rightClipId, `split:${name}:${offset}`),
        timeUs: 0,
        value: v,
        interpolation,
      },
      ...keys
        .filter((k) => k.timeUs > offset)
        .map((k) => ({ ...k, timeUs: k.timeUs - offset })),
    ];
  }
  return [left, right];
}
export function applyOperations(
  original: Project,
  operations: EditOperation[],
): { project: Project; affectedIds: string[] } {
  const p = validateProject(original),
    affected = new Set<string>();
  const track = (id: string) => {
    const t = p.tracks.find((t) => t.id === id);
    invariant(t, 'NOT_FOUND', `Track ${id} missing`);
    affected.add(id);
    return t;
  };
  const locate = (id: string) => {
    for (const t of p.tracks) {
      const c = t.clips.find((c) => c.id === id);
      if (c) {
        affected.add(id);
        return { t, c };
      }
    }
    throw new EditorError('NOT_FOUND', `Clip ${id} missing`);
  };
  const unlink = (id: string) => {
    p.transitions = p.transitions.filter(
      (t) => t.fromClipId !== id && t.toClipId !== id,
    );
  };
  for (const op of operations) {
    switch (op.type) {
      case 'addTrack':
        p.tracks.push(trackSchema.parse(op.track));
        affected.add(op.track.id);
        break;
      case 'removeTrack':
        track(op.trackId);
        p.tracks = p.tracks.filter((t) => t.id !== op.trackId);
        p.transitions = p.transitions.filter((t) => t.trackId !== op.trackId);
        break;
      case 'reorderTrack': {
        const t = track(op.trackId);
        invariant(
          op.index < p.tracks.length,
          'INVALID_COMMAND',
          'Track index outside project',
        );
        p.tracks = p.tracks.filter((x) => x.id !== t.id);
        p.tracks.splice(op.index, 0, t);
        break;
      }
      case 'insertClip':
        track(op.trackId).clips.push(clipSchema.parse(op.clip));
        affected.add(op.clip.id);
        break;
      case 'removeClip': {
        const { t } = locate(op.clipId);
        t.clips = t.clips.filter((c) => c.id !== op.clipId);
        unlink(op.clipId);
        break;
      }
      case 'updateClip': {
        const { t, c } = locate(op.clipId);
        t.clips[t.clips.indexOf(c)] = clipSchema.parse({ ...c, ...op.patch });
        break;
      }
      case 'trimClip': {
        const { c } = locate(op.clipId);
        c.sourceInUs = op.sourceInUs;
        c.sourceOutUs = op.sourceOutUs;
        c.durationUs = Math.round((op.sourceOutUs - op.sourceInUs) / c.speed);
        break;
      }
      case 'splitClip': {
        const { t, c } = locate(op.clipId);
        const offset = op.atUs - c.startUs;
        invariant(
          offset > 0 && offset < c.durationUs,
          'INVALID_COMMAND',
          'Split must be inside clip',
        );
        const envelope = c.fadeEnvelope ?? {
          offsetUs: 0,
          durationUs: c.durationUs,
        };
        const right = structuredClone(c);
        right.id = op.rightClipId;
        right.startUs = op.atUs;
        right.durationUs = c.durationUs - offset;
        const [leftKeys, rightKeys] = splitKeys(c, offset, right.id);
        c.keyframes = leftKeys;
        right.keyframes = rightKeys;
        c.durationUs = offset;
        if (c.kind === 'video' || c.kind === 'audio') {
          const source = c.sourceInUs + Math.round(offset * c.speed);
          right.sourceInUs = source;
          c.sourceOutUs = source;
        }
        c.fadeEnvelope = envelope;
        right.fadeEnvelope = {
          ...envelope,
          offsetUs: envelope.offsetUs + offset,
        };
        right.cues = c.cues
          .filter((q) => q.endUs > offset)
          .map((q) => ({
            ...q,
            id:
              q.timeUs >= offset
                ? q.id
                : nestedId('cue', right.id, `split:${q.id}:${offset}`),
            timeUs: Math.max(0, q.timeUs - offset),
            endUs: q.endUs - offset,
          }));
        c.cues = c.cues
          .filter((q) => q.timeUs < offset)
          .map((q) => ({ ...q, endUs: Math.min(offset, q.endUs) }));
        t.clips.splice(t.clips.indexOf(c) + 1, 0, right);
        affected.add(right.id);
        unlink(c.id);
        break;
      }
      case 'moveClip': {
        const { t, c } = locate(op.clipId);
        t.clips = t.clips.filter((x) => x.id !== c.id);
        c.startUs = op.startUs;
        track(op.trackId).clips.push(c);
        break;
      }
      case 'duplicateClip': {
        const { c } = locate(op.clipId);
        const duplicate = {
          ...structuredClone(c),
          id: op.newClipId,
          startUs: op.startUs,
        };
        for (const keys of Object.values(duplicate.keyframes))
          for (const key of keys)
            key.id = nestedId('keyframe', duplicate.id, `duplicate:${key.id}`);
        for (const cue of duplicate.cues)
          cue.id = nestedId('cue', duplicate.id, `duplicate:${cue.id}`);
        track(op.trackId).clips.push(duplicate);
        affected.add(op.newClipId);
        break;
      }
      case 'setSpeed': {
        const { c } = locate(op.clipId);
        invariant(
          c.kind === 'audio' || c.kind === 'video',
          'INVALID_COMMAND',
          'Speed requires timed media',
        );
        c.speed = op.speed;
        c.durationUs = Math.round((c.sourceOutUs! - c.sourceInUs) / op.speed);
        break;
      }
      case 'ripple': {
        for (const c of track(op.trackId).clips) {
          if (c.startUs >= op.fromUs) {
            c.startUs += op.deltaUs;
            affected.add(c.id);
          }
        }
        break;
      }
      case 'addTransition':
        p.transitions.push(op.transition);
        affected.add(op.transition.id);
        break;
      case 'removeTransition':
        invariant(
          p.transitions.some((t) => t.id === op.transitionId),
          'NOT_FOUND',
          'Transition missing',
        );
        p.transitions = p.transitions.filter((t) => t.id !== op.transitionId);
        affected.add(op.transitionId);
        break;
    }
  }
  return { project: validateProject(p), affectedIds: [...affected] };
}
