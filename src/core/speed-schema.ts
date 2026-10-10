import { z } from 'zod';

export const speedPointSchema = z
  .object({
    position: z.number().finite().min(0).max(1),
    speed: z.number().finite().min(0.25).max(4),
    interpolation: z.enum(['linear', 'smooth', 'hold']).default('linear'),
    // Retain the exact easing interval when a smooth segment is split.
    curveStart: z.number().finite().min(0).max(1).optional(),
    curveEnd: z.number().finite().min(0).max(1).optional(),
  })
  .strict();
export const speedRampSchema = z
  .array(speedPointSchema)
  .min(2)
  .max(64)
  .superRefine((points, ctx) => {
    if (
      points[0]?.position !== 0 ||
      points.at(-1)?.position !== 1 ||
      points.some(
        (point, i) =>
          (i > 0 && point.position <= points[i - 1]!.position) ||
          (point.curveStart ?? 0) >= (point.curveEnd ?? 1),
      )
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Ramp points must run from 0 to 1 in strictly increasing order with valid curve intervals.',
      });
  });
export type SpeedPoint = z.infer<typeof speedPointSchema>;
export type SpeedRamp = z.infer<typeof speedRampSchema>;
