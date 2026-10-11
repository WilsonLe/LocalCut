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
import { evaluateKeys, sourceTimeUs } from './timing';
import {
  sourceDurationUs,
  splitRampSourceRange,
  sliceRamp,
  loopDurationUs,
  loopLocalUs,
} from './speed';
import { speedRampSchema } from './speed-schema';
import { TRANSITION_TEMPLATES } from './timeline';
import type { TransitionTemplate } from './timeline';
import { transitionTemplateOperations } from './transition-templates';
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
  | { type: 'resizeClip'; clipId: string; durationUs: number }
  | { type: 'splitClip'; clipId: string; atUs: number; rightClipId: string }
  | { type: 'moveClip'; clipId: string; trackId: string; startUs: number }
  | {
      type: 'duplicateClip';
      clipId: string;
      newClipId: string;
      trackId: string;
      startUs: number;
    }
  | {
      type: 'setSpeed';
      clipId: string;
      speed: number;
      pitchMode?: 'change' | 'preserve';
    }
  | {
      type: 'setSpeedRamp';
      clipId: string;
      points: z.input<typeof speedRampSchema> | null;
      pitchMode?: 'change' | 'preserve';
    }
  | { type: 'ripple'; trackId: string; fromUs: number; deltaUs: number }
  | {
      type: 'applyTransitionTemplate';
      transitionId: string;
      trackId: string;
      fromClipId: string;
      toClipId: string;
      template: TransitionTemplate;
      strength?: number;
    }
  | {
      type: 'separateAudio';
      clipId: string;
      audioClipId: string;
      trackId: string;
    }
  | { type: 'groupClips'; groupId: string; clipIds: string[] }
  | { type: 'ungroupClips'; groupId: string }
  | { type: 'moveGroup'; groupId: string; deltaUs: number }
  | {
      type: 'duplicateGroup';
      groupId: string;
      newGroupId: string;
      newClipIds: Record<string, string>;
      deltaUs: number;
    }
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
const entityId = z.string().min(1).max(200);
const delta = z
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
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
      type: z.literal('resizeClip'),
      clipId: z.string(),
      durationUs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
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
      pitchMode: z.enum(['change', 'preserve']).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('setSpeedRamp'),
      clipId: z.string(),
      points: speedRampSchema.nullable(),
      pitchMode: z.enum(['change', 'preserve']).optional(),
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
    .object({
      type: z.literal('applyTransitionTemplate'),
      transitionId: entityId,
      trackId: entityId,
      fromClipId: entityId,
      toClipId: entityId,
      template: z.enum(TRANSITION_TEMPLATES.map((template) => template.id)),
      strength: z.number().finite().min(0).max(1).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('separateAudio'),
      clipId: entityId,
      audioClipId: entityId,
      trackId: entityId,
    })
    .strict(),
  z
    .object({
      type: z.literal('groupClips'),
      groupId: entityId,
      clipIds: z.array(entityId).min(2).max(1000),
    })
    .strict(),
  z.object({ type: z.literal('ungroupClips'), groupId: entityId }).strict(),
  z
    .object({ type: z.literal('moveGroup'), groupId: entityId, deltaUs: delta })
    .strict(),
  z
    .object({
      type: z.literal('duplicateGroup'),
      groupId: entityId,
      newGroupId: entityId,
      newClipIds: z.record(entityId, entityId),
      deltaUs: delta,
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
function retimeClip(clip: Clip, duration: number) {
  const ratio = duration / clip.durationUs;
  for (const [name, keys] of Object.entries(clip.keyframes)) {
    const scaled = keys.map((key) => ({
      ...key,
      timeUs: Math.min(duration, Math.round(key.timeUs * ratio)),
    }));
    clip.keyframes[name as Parameter] = scaled.filter(
      (key, i) => key.timeUs !== scaled[i + 1]?.timeUs,
    );
  }
  clip.cues = clip.cues
    .map((cue) => ({
      ...cue,
      timeUs: Math.round(cue.timeUs * ratio),
      endUs: Math.min(duration, Math.round(cue.endUs * ratio)),
    }))
    .filter((cue) => cue.endUs > cue.timeUs);
  clip.fadeInUs = Math.round(clip.fadeInUs * ratio);
  clip.fadeOutUs = Math.round(clip.fadeOutUs * ratio);
  if (clip.fadeEnvelope) {
    const offsetUs = Math.round(clip.fadeEnvelope.offsetUs * ratio);
    clip.fadeEnvelope = {
      offsetUs,
      durationUs: Math.max(
        offsetUs + duration,
        Math.round(clip.fadeEnvelope.durationUs * ratio),
      ),
    };
  }
  const envelopeDuration = clip.fadeEnvelope?.durationUs ?? duration;
  clip.fadeOutUs = Math.min(clip.fadeOutUs, envelopeDuration - clip.fadeInUs);
  clip.durationUs = duration;
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
  const members = (groupId: string) => {
    const clips = p.tracks
      .flatMap((t) => t.clips)
      .filter((c) => c.groupId === groupId);
    invariant(clips.length >= 2, 'NOT_FOUND', `Group ${groupId} missing`);
    affected.add(groupId);
    for (const c of clips) affected.add(c.id);
    return clips;
  };
  const duplicateClip = (c: Clip, id: string, startUs: number) => {
    const copy = { ...structuredClone(c), id, startUs };
    delete copy.groupId;
    for (const keys of Object.values(copy.keyframes))
      for (const key of keys)
        key.id = nestedId('keyframe', id, `duplicate:${key.id}`);
    for (const cue of copy.cues)
      cue.id = nestedId('cue', id, `duplicate:${cue.id}`);
    affected.add(id);
    return copy;
  };
  const pending = [...operations];
  for (let index = 0; index < pending.length; index++) {
    const op = pending[index]!;
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
        const updated = { ...c, ...op.patch };
        if (
          (!c.loop &&
            op.patch.durationUs !== undefined &&
            op.patch.durationUs !== c.durationUs) ||
          (op.patch.sourceInUs !== undefined &&
            op.patch.sourceInUs !== c.sourceInUs) ||
          (op.patch.sourceOutUs !== undefined &&
            op.patch.sourceOutUs !== c.sourceOutUs) ||
          (op.patch.speedRamp !== undefined &&
            JSON.stringify(op.patch.speedRamp) !== JSON.stringify(c.speedRamp))
        )
          delete updated.speedRampSourceRange;
        t.clips[t.clips.indexOf(c)] = clipSchema.parse(updated);
        break;
      }
      case 'resizeClip': {
        const { c } = locate(op.clipId);
        if (c.kind === 'audio' || c.kind === 'video')
          c.loop ??= { offsetUs: 0 };
        // Retain interpolation through the cut, including its evaluated boundary.
        if (op.durationUs < c.durationUs)
          [c.keyframes] = splitKeys(c, op.durationUs, c.id);
        // Duration edits retain the selected source and clip-local authored timing.
        c.durationUs = op.durationUs;
        c.cues = c.cues
          .filter((cue) => cue.timeUs < op.durationUs)
          .map((cue) => ({
            ...cue,
            endUs: Math.min(cue.endUs, op.durationUs),
          }));
        const envelopeDuration = c.fadeEnvelope?.durationUs ?? c.durationUs;
        c.fadeInUs = Math.min(c.fadeInUs, envelopeDuration);
        c.fadeOutUs = Math.min(c.fadeOutUs, envelopeDuration - c.fadeInUs);
        if (c.fadeEnvelope)
          c.fadeEnvelope.durationUs = Math.max(
            c.fadeEnvelope.durationUs,
            c.fadeEnvelope.offsetUs + c.durationUs,
          );
        break;
      }
      case 'trimClip': {
        const { c } = locate(op.clipId);
        delete c.speedRampSourceRange;
        delete c.loop;
        c.sourceInUs = op.sourceInUs;
        c.sourceOutUs = op.sourceOutUs;
        c.durationUs = sourceDurationUs(c, op.sourceOutUs - op.sourceInUs);
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
        let source = sourceTimeUs(c, op.atUs);
        if (c.loop) right.loop = { offsetUs: loopLocalUs(c, offset) };
        if (c.speedRamp && !c.loop) {
          const bounds = splitRampSourceRange(c, offset);
          source = bounds.sourceUs;
          // Retain integer reference bounds and unitless fractions for repeated splits.
          right.speedRampSourceRange = bounds.right;
          c.speedRampSourceRange = bounds.left;
          const split = offset / c.durationUs;
          right.speedRamp = sliceRamp(c.speedRamp, split, 1);
          c.speedRamp = sliceRamp(c.speedRamp, 0, split);
        }
        c.durationUs = offset;
        if (!c.loop && (c.kind === 'video' || c.kind === 'audio')) {
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
        track(op.trackId).clips.push(
          duplicateClip(c, op.newClipId, op.startUs),
        );
        break;
      }
      case 'setSpeed': {
        const { c } = locate(op.clipId);
        invariant(
          c.kind === 'audio' || c.kind === 'video',
          'INVALID_COMMAND',
          'Speed requires timed media',
        );
        const oldCycle = c.loop ? loopDurationUs(c) : 0;
        const oldDuration = c.durationUs;
        const oldOffset = c.loop?.offsetUs ?? 0;
        const hadRamp = !!c.speedRamp;
        c.speed = op.speed;
        delete c.speedRamp;
        delete c.speedRampSourceRange;
        if (op.pitchMode) c.pitchMode = op.pitchMode;
        const duration = Math.round((c.sourceOutUs! - c.sourceInUs) / op.speed);
        if (c.loop) {
          c.loop.offsetUs = Math.min(
            duration - 1,
            Math.round((oldOffset * duration) / oldCycle),
          );
          retimeClip(
            c,
            Math.max(1, Math.round((oldDuration * duration) / oldCycle)),
          );
        } else if (hadRamp) retimeClip(c, duration);
        else c.durationUs = duration;
        break;
      }
      case 'setSpeedRamp': {
        const { c } = locate(op.clipId);
        const oldCycle = c.loop ? loopDurationUs(c) : 0;
        const oldDuration = c.durationUs;
        const oldOffset = c.loop?.offsetUs ?? 0;
        invariant(
          c.kind === 'audio' || c.kind === 'video',
          'INVALID_COMMAND',
          'Speed requires timed media',
        );
        delete c.speedRampSourceRange;
        if (op.points) c.speedRamp = speedRampSchema.parse(op.points);
        else delete c.speedRamp;
        if (op.pitchMode) c.pitchMode = op.pitchMode;
        const cycle = sourceDurationUs(c, c.sourceOutUs! - c.sourceInUs);
        if (c.loop) {
          c.loop.offsetUs = Math.min(
            cycle - 1,
            Math.round((oldOffset * cycle) / oldCycle),
          );
          retimeClip(
            c,
            Math.max(1, Math.round((oldDuration * cycle) / oldCycle)),
          );
        } else retimeClip(c, cycle);
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
      case 'applyTransitionTemplate':
        // Recipes expand inside the same atomic batch. Validate and clean group
        // membership only after all authored and generated operations finish.
        pending.splice(index + 1, 0, ...transitionTemplateOperations(p, op));
        break;
      case 'separateAudio': {
        const { t, c } = locate(op.clipId);
        invariant(
          c.kind === 'video',
          'INVALID_COMMAND',
          'Audio separation requires a video clip',
        );
        const target = track(op.trackId);
        invariant(
          target.kind === 'audio',
          'INVALID_COMMAND',
          'Separated audio requires an audio track',
        );
        const audio = clipSchema.parse({
          id: op.audioClipId,
          kind: 'audio',
          assetId: c.assetId,
          startUs: c.startUs,
          durationUs: c.durationUs,
          sourceInUs: c.sourceInUs,
          sourceOutUs: c.sourceOutUs,
          speed: c.speed,
          speedRamp: c.speedRamp,
          speedRampSourceRange: c.speedRampSourceRange,
          pitchMode: c.pitchMode,
          loop: c.loop,
          gain: c.gain,
          muted: c.muted || t.muted,
          fadeInUs: c.fadeInUs,
          fadeOutUs: c.fadeOutUs,
          fadeEnvelope: c.fadeEnvelope,
          transcriptId: c.transcriptId,
          keyframes: c.keyframes.gain
            ? {
                gain: c.keyframes.gain.map((k) => ({
                  ...k,
                  id: nestedId('keyframe', op.audioClipId, `separate:${k.id}`),
                })),
              }
            : {},
        });
        target.clips.push(audio);
        c.muted = true;
        affected.add(audio.id);
        break;
      }
      case 'groupClips': {
        invariant(
          new Set(op.clipIds).size === op.clipIds.length,
          'INVALID_COMMAND',
          'Group contains duplicate clips',
        );
        invariant(
          !p.tracks.some((t) => t.clips.some((c) => c.groupId === op.groupId)),
          'INVALID_COMMAND',
          'Group ID already exists',
        );
        const clips = op.clipIds.map((id) => locate(id).c);
        for (const c of clips)
          if (c.groupId)
            invariant(
              members(c.groupId).every((member) =>
                op.clipIds.includes(member.id),
              ),
              'INVALID_COMMAND',
              'Select every member before regrouping',
            );
        for (const c of clips) c.groupId = op.groupId;
        affected.add(op.groupId);
        break;
      }
      case 'ungroupClips':
        for (const c of members(op.groupId)) delete c.groupId;
        break;
      case 'moveGroup':
        for (const c of members(op.groupId)) c.startUs += op.deltaUs;
        break;
      case 'duplicateGroup': {
        const clips = members(op.groupId);
        invariant(
          Object.keys(op.newClipIds).length === clips.length &&
            clips.every((c) => op.newClipIds[c.id]),
          'INVALID_COMMAND',
          'Provide a new ID for every group member',
        );
        invariant(
          !p.tracks.some((t) =>
            t.clips.some((c) => c.groupId === op.newGroupId),
          ),
          'INVALID_COMMAND',
          'Group ID already exists',
        );
        for (const c of clips) {
          const copy = duplicateClip(
            c,
            op.newClipIds[c.id]!,
            c.startUs + op.deltaUs,
          );
          copy.groupId = op.newGroupId;
          locate(c.id).t.clips.push(copy);
        }
        // Preserve transitions wholly inside the duplicated group.
        for (const transition of [...p.transitions])
          if (
            op.newClipIds[transition.fromClipId] &&
            op.newClipIds[transition.toClipId]
          ) {
            const id = nestedId('transition', op.newGroupId, transition.id);
            p.transitions.push({
              ...transition,
              id,
              fromClipId: op.newClipIds[transition.fromClipId]!,
              toClipId: op.newClipIds[transition.toClipId]!,
            });
            affected.add(id);
          }
        affected.add(op.newGroupId);
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
  const groups = new Map<string, Clip[]>();
  for (const c of p.tracks.flatMap((t) => t.clips))
    if (c.groupId) groups.set(c.groupId, [...(groups.get(c.groupId) ?? []), c]);
  for (const [groupId, clips] of groups)
    if (clips.length < 2) {
      delete clips[0]!.groupId;
      affected.add(groupId);
      affected.add(clips[0]!.id);
    }
  return { project: validateProject(p), affectedIds: [...affected] };
}
