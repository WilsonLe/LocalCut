import { z } from 'zod';

/** Local source and authored placement; never file bytes or remote URLs. */
export const storyboardImageOptionsSchema = z
  .object({
    assetId: z.string().min(1).max(200),
    elementId: z.string().min(1).max(200),
    timeUs: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .default(0),
    x: z.number().finite().min(-1e7).max(1e7).default(0),
    y: z.number().finite().min(-1e7).max(1e7).default(0),
    width: z.number().finite().positive().max(4096).default(640),
    height: z.number().finite().positive().max(1e7).optional(),
    frameId: z.string().min(1).max(200).nullable().default(null),
  })
  .strict();
export type StoryboardImageOptions = z.input<
  typeof storyboardImageOptionsSchema
>;
