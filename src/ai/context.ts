import type { Asset, Project, Transcript } from '../core/model';
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
