import { z } from 'zod';
import { invariant } from './errors';

const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const assetClipSchema = z
  .object({
    id: z.string().min(1).max(200),
    name: z.string().trim().min(1).max(240),
    startUs: time,
    endUs: time,
    context: z.string().max(100_000),
    transcript: z.string().max(1_000_000),
  })
  .strict();
export const assetClipsSchema = z.array(assetClipSchema).min(1).max(1000);
export type AssetClip = z.infer<typeof assetClipSchema>;
interface Source {
  durationUs: number;
}
interface Owner extends Source {
  clips?: AssetClip[];
  clipsRevision?: number;
  notes?: { revision: number; context: string; transcript: string };
}

export function assetClipsIssue(
  clips: AssetClip[],
  source: Source,
): string | undefined {
  const ids = new Set<string>();
  for (const clip of clips) {
    if (ids.has(clip.id)) return 'Clip IDs must be unique within the asset.';
    ids.add(clip.id);
    if (
      clip.endUs > source.durationUs ||
      clip.startUs > clip.endUs ||
      (source.durationUs > 0 && clip.startUs === clip.endUs)
    )
      return 'Choose a clip range within the source duration.';
  }
  if (
    clips.reduce(
      (size, clip) => size + clip.context.length + clip.transcript.length,
      0,
    ) > 2_000_000
  )
    return 'Clip text exceeds the asset limit.';
}

export function validateAssetClips(
  input: unknown,
  source: Source,
): AssetClip[] {
  const parsed = assetClipsSchema.safeParse(input);
  invariant(
    parsed.success,
    'INVALID_COMMAND',
    'Check clip names, ranges and text.',
  );
  const issue = assetClipsIssue(parsed.data, source);
  invariant(!issue, 'INVALID_COMMAND', issue ?? 'Invalid clips.');
  return parsed.data;
}

/** Legacy asset text becomes one whole-source clip without writing on read. */
export function assetClipState(asset: Owner) {
  return {
    revision: asset.clipsRevision ?? asset.notes?.revision ?? 0,
    clips: asset.clips ?? [
      {
        id: 'full-source',
        name: 'Clip 1',
        startUs: 0,
        endUs: asset.durationUs,
        context: asset.notes?.context ?? '',
        transcript: asset.notes?.transcript ?? '',
      },
    ],
  };
}
