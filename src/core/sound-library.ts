import { z } from 'zod';

export const SOUND_CATEGORIES = [
  'Transitions',
  'Interface',
  'Impacts',
  'Footsteps',
  'Foley',
  'Digital',
  'Sci-fi',
  'Ambience',
  'Nature',
] as const;

const id = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(120);
const text = z.string().trim().min(1).max(120);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const httpsUrl = z.url().refine((value) => value.startsWith('https://'));
export const SoundCatalogSchema = z
  .object({
    version: z.literal(1),
    license: z.literal('CC0-1.0'),
    sources: z
      .array(
        z.object({ id, name: text, creator: text, url: httpsUrl }).strict(),
      )
      .min(1)
      .max(30),
    sounds: z
      .array(
        z
          .object({
            id,
            name: text.refine((value) => !/[\\/\0]/.test(value)),
            category: z.enum(SOUND_CATEGORIES),
            tags: z
              .array(text)
              .min(1)
              .max(30)
              .refine((tags) => new Set(tags).size === tags.length),
            sourceId: id,
            sha256,
            size: z
              .number()
              .int()
              .min(46)
              .max(12 * 1024 * 1024),
            durationUs: z.number().int().positive().max(60_000_000),
            sampleRate: z.literal(48000),
            channels: z.union([z.literal(1), z.literal(2)]),
          })
          .strict(),
      )
      .min(1)
      .max(1500),
  })
  .strict()
  .superRefine((catalog, context) => {
    const sources = new Set(catalog.sources.map((source) => source.id));
    const sounds = new Set(catalog.sounds.map((sound) => sound.id));
    if (
      sources.size !== catalog.sources.length ||
      sounds.size !== catalog.sounds.length
    )
      context.addIssue({
        code: 'custom',
        message: 'Duplicate sound library ID.',
      });
    if (catalog.sounds.some((sound) => !sources.has(sound.sourceId)))
      context.addIssue({ code: 'custom', message: 'Unknown sound source.' });
  });

export type SoundCatalog = z.infer<typeof SoundCatalogSchema>;
export type LibrarySound = SoundCatalog['sounds'][number];
export type SoundCategory = (typeof SOUND_CATEGORIES)[number];

export const soundFilters = {
  category: z.enum(SOUND_CATEGORIES).optional(),
  tags: z.array(text).max(10).default([]),
  minDurationUs: z.number().int().nonnegative().optional(),
  maxDurationUs: z.number().int().nonnegative().optional(),
};

interface SoundFilters {
  tags?: string[];
  minDurationUs?: number;
  maxDurationUs?: number;
}

function words(value: string) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

export function findSounds(
  catalog: SoundCatalog,
  query: string,
  category: SoundCategory | '',
  filters: SoundFilters = {},
) {
  const terms = words(query)
    .split(/[\s-]+/)
    .filter(Boolean);
  const sources = new Map(catalog.sources.map((source) => [source.id, source]));
  return catalog.sounds.filter((sound) => {
    if (category && sound.category !== category) return false;
    if (
      filters.minDurationUs !== undefined &&
      sound.durationUs < filters.minDurationUs
    )
      return false;
    if (
      filters.maxDurationUs !== undefined &&
      sound.durationUs > filters.maxDurationUs
    )
      return false;
    if (
      filters.tags?.some(
        (tag) => !sound.tags.some((value) => words(value) === words(tag)),
      )
    )
      return false;
    const source = sources.get(sound.sourceId)!;
    const labels = words(
      [
        sound.name,
        sound.category,
        ...sound.tags,
        source.name,
        source.creator,
      ].join(' '),
    ).replaceAll('-', ' ');
    return terms.every((term) => labels.includes(term));
  });
}
