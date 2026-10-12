import { z } from 'zod';

/** ISO wall time; an absent offset deliberately means the timezone is unknown. */
export function captureTime(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 64) return;
  const normalized = value
    .trim()
    .replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T')
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?)?$/.exec(
      normalized,
    );
  if (!match) return;
  const [, y, m, d, h, min, sec, fraction, offset] = match;
  const date = new Date(`${y}-${m}-${d}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() !== +y! ||
    date.getUTCMonth() + 1 !== +m! ||
    date.getUTCDate() !== +d!
  )
    return;
  if (h !== undefined && (+h > 23 || +min! > 59 || +sec! > 59)) return;
  if (
    offset &&
    offset !== 'Z' &&
    (+offset.slice(1, 3) > 23 || +offset.slice(4) > 59)
  )
    return;
  return `${y}-${m}-${d}${h === undefined ? '' : `T${h}:${min}:${sec}${fraction ?? ''}${offset ?? ''}`}`;
}
export const captureMetadataSchema = z
  .object({
    time: z
      .object({
        value: z
          .string()
          .refine((s) => captureTime(s) === s, 'Invalid capture time'),
        source: z.enum([
          'exif-original',
          'exif-digitized',
          'quicktime-creationdate',
          'container-date',
        ]),
      })
      .strict()
      .optional(),
    location: z
      .object({
        latitude: z.number().finite().min(-90).max(90),
        longitude: z.number().finite().min(-180).max(180),
        altitudeMeters: z.number().finite().optional(),
        source: z.enum(['exif-gps', 'quicktime-location']),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CaptureMetadata = z.infer<typeof captureMetadataSchema>;
