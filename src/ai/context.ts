import type { Asset, Project, Transcript } from '../core/model';
import { durationUs, parameterSchema } from '../core/model';
import { frameTimeUs, gainAt, sourceTimeUs, valueAt } from '../core/timing';
import { AiError } from './errors';

/** Each option independently opts the corresponding local text into remote context. */
export interface ContextPolicy {
  includeText?: boolean;
  includeAssetNames?: boolean;
  includeTranscripts?: boolean;
}

export function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function boundedContext<T>(value: T, maxBytes: number): T {
  if (byteLength(value) > maxBytes)
    throw new AiError(
      'CONTEXT_LIMIT',
      'Selected context exceeds the configured limit.',
    );
  return value;
}

export function projectContext(project: Project, policy: ContextPolicy = {}) {
  const { name, tracks, ...settings } = project;
  return {
    ...settings,
    ...(policy.includeAssetNames ? { name } : {}),
    tracks: tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => {
        const { text, cues, ...properties } = clip;
        return {
          ...properties,
          ...(policy.includeText
            ? { ...(text ? { text } : {}), cues }
            : { hasText: !!text, cueCount: cues.length }),
        };
      }),
    })),
  };
}

export function assetContext(asset: Asset, policy: ContextPolicy = {}) {
  const { name, ...metadata } = asset;
  return {
    ...metadata,
    ...(policy.includeAssetNames ? { name } : {}),
  };
}

export function transcriptContext(
  transcript: Transcript,
  policy: ContextPolicy,
) {
  if (!policy.includeTranscripts)
    throw new AiError(
      'TOOL_NOT_ALLOWED',
      'Transcript sharing has not been enabled.',
    );
  return structuredClone(transcript);
}

/** Structural evaluation shares timing/keyframe helpers with the compositor. */
export function timelineContext(
  project: Project,
  timeUs: number,
  policy: ContextPolicy = {},
) {
  const rate = project.frameRate;
  const frameIndex = Math.floor((timeUs * rate.num) / (1_000_000 * rate.den));
  const redacted = projectContext(project, policy);
  return {
    projectId: project.id,
    revision: project.revision,
    timeUs,
    frameIndex,
    frameTimeUs: frameTimeUs(frameIndex, rate),
    durationUs: durationUs(project),
    tracks: redacted.tracks.map((track, index) => ({
      id: track.id,
      kind: track.kind,
      muted: track.muted,
      clips: track.clips
        .filter(
          (clip) =>
            clip.startUs <= timeUs && timeUs < clip.startUs + clip.durationUs,
        )
        .map((clip) => {
          const original = project.tracks[index]!.clips.find(
            (item) => item.id === clip.id,
          )!;
          return {
            ...clip,
            localTimeUs: timeUs - clip.startUs,
            ...(clip.kind === 'video' || clip.kind === 'audio'
              ? { sourceTimeUs: sourceTimeUs(original, timeUs) }
              : {}),
            values: Object.fromEntries(
              parameterSchema.options.map((name) => [
                name,
                valueAt(original, name, timeUs),
              ]),
            ),
            audibleGain:
              track.muted || !['video', 'audio'].includes(clip.kind)
                ? 0
                : gainAt(original, timeUs),
          };
        }),
    })),
    transitions: project.transitions.flatMap((transition) => {
      const clips = project.tracks.find(
        (track) => track.id === transition.trackId,
      )!.clips;
      const from = clips.find((clip) => clip.id === transition.fromClipId)!;
      const to = clips.find((clip) => clip.id === transition.toClipId)!;
      const startUs = to.startUs,
        endUs = from.startUs + from.durationUs;
      if (timeUs < startUs || timeUs >= endUs) return [];
      const progress = (timeUs - startUs) / (endUs - startUs);
      return [
        {
          ...transition,
          startUs,
          endUs,
          progress,
          fromWeight:
            transition.kind === 'crossfade'
              ? 1 - progress
              : Math.max(0, 1 - 2 * progress),
          toWeight:
            transition.kind === 'crossfade'
              ? progress
              : Math.max(0, 2 * progress - 1),
          blackBackground: transition.kind === 'black',
        },
      ];
    }),
  };
}
