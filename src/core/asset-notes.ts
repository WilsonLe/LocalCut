import { z } from 'zod';

export const assetNotesInputSchema = z
  .object({
    context: z.string().max(100_000),
    transcript: z.string().max(1_000_000),
  })
  .strict();
export const assetNotesSchema = assetNotesInputSchema.extend({
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export type AssetNotesInput = z.infer<typeof assetNotesInputSchema>;
