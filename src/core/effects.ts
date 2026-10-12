import { z } from 'zod';
import { EditorError } from './errors';

export const COLOR_PRESETS = [
  { id: 'none', label: 'None' },
  { id: 'warm', label: 'Warm' },
  { id: 'cool', label: 'Cool' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'mono', label: 'Monochrome' },
] as const;
export const BLEND_MODES = [
  { id: 'source-over', label: 'Normal' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'screen', label: 'Screen' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'darken', label: 'Darken' },
  { id: 'lighten', label: 'Lighten' },
  { id: 'difference', label: 'Difference' },
  { id: 'soft-light', label: 'Soft light' },
  { id: 'hard-light', label: 'Hard light' },
  { id: 'exclusion', label: 'Exclusion' },
] as const;
const finite = z.number().finite();
const unit = finite.min(0).max(1);
const triple = z.tuple([finite, finite, finite]);
export const colorLutSchema = z
  .object({
    size: z.number().int().min(2).max(65),
    domainMin: triple,
    domainMax: triple,
    values: z.array(finite).max(65 ** 3 * 3),
  })
  .strict()
  .superRefine((lut, ctx) => {
    if (lut.values.length !== lut.size ** 3 * 3)
      ctx.addIssue({
        code: 'custom',
        message: 'LUT table length must equal size cubed times three',
      });
    if (lut.domainMin.some((v, i) => v >= lut.domainMax[i]!))
      ctx.addIssue({
        code: 'custom',
        message: 'LUT domain maximum must exceed minimum on every axis',
      });
  });
const position = z.object({ x: unit, y: unit }).strict();
export const maskSchema = z
  .object({
    shape: z.enum(['rectangle', 'ellipse']),
    x: unit,
    y: unit,
    width: unit.positive(),
    height: unit.positive(),
    invert: z.boolean(),
    feather: finite.min(0).max(100),
    points: z
      .array(
        position.extend({ timeUs: z.number().int().nonnegative() }).strict(),
      )
      .optional(),
  })
  .strict()
  .superRefine((mask, ctx) => {
    if (
      mask.x + mask.width > 1 ||
      mask.y + mask.height > 1 ||
      mask.points?.some((p) => p.x + mask.width > 1 || p.y + mask.height > 1)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Mask must fit within the clip',
      });
    if (mask.points?.some((p, i, a) => i > 0 && p.timeUs <= a[i - 1]!.timeUs))
      ctx.addIssue({
        code: 'custom',
        message: 'Mask motion points must be strictly ordered',
      });
  });
export const eqSchema = z
  .object({
    lowDb: finite.min(-12).max(12),
    midDb: finite.min(-12).max(12),
    highDb: finite.min(-12).max(12),
  })
  .strict();
export const chromaKeySchema = z
  .object({
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    tolerance: unit,
    softness: unit,
    spill: unit,
  })
  .strict();
export type ColorLut = z.infer<typeof colorLutSchema>;
export type Mask = z.infer<typeof maskSchema>;
export type Equalizer = z.infer<typeof eqSchema>;
export type ChromaKey = z.infer<typeof chromaKeySchema>;

/** Adobe Cube 3D tables: red changes fastest. Titles are deliberately not retained. */
export function parseCube(text: string): ColorLut {
  const fail = (message: string): never => {
    throw new EditorError('INVALID_DOCUMENT', message);
  };
  if (text.length > 16 * 1024 * 1024) fail('LUT file exceeds 16 MiB');
  let size = 0,
    data = false;
  let domainMin: [number, number, number] = [0, 0, 0],
    domainMax: [number, number, number] = [1, 1, 1];
  const values: number[] = [],
    headers = new Set<string>();
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = /^\s*TITLE\s/.test(raw)
      ? raw.replace(/("[^"]*")\s*#.*$/, '$1').trim()
      : raw.split('#')[0]!.trim();
    if (!line) continue;
    const [head, ...rest] = line.split(/\s+/);
    if (
      head === 'TITLE' ||
      head === 'LUT_3D_SIZE' ||
      head === 'DOMAIN_MIN' ||
      head === 'DOMAIN_MAX'
    ) {
      if (data || headers.has(head))
        fail('LUT headers must be unique and precede table data');
      headers.add(head);
      if (head === 'TITLE') {
        if (!/^TITLE\s+".*"$/.test(line)) fail('Invalid LUT title');
        continue;
      }
      if (head === 'LUT_3D_SIZE') {
        size = Number(rest[0]);
        if (
          rest.length !== 1 ||
          !Number.isInteger(size) ||
          size < 2 ||
          size > 65
        )
          fail('Supported 3D LUT sizes are 2 through 65');
      } else {
        const numbers = rest.map(Number);
        if (numbers.length !== 3 || numbers.some((v) => !Number.isFinite(v)))
          fail('Invalid LUT domain');
        if (head === 'DOMAIN_MIN') domainMin = numbers as typeof domainMin;
        else domainMax = numbers as typeof domainMax;
      }
    } else {
      if (!size || !/^[+\-.\d]/.test(head!))
        fail('Only standalone LUT_3D_SIZE .cube files are supported');
      const numbers = [head, ...rest].map(Number);
      if (numbers.length !== 3 || numbers.some((v) => !Number.isFinite(v)))
        fail('Invalid LUT table row');
      data = true;
      values.push(...numbers);
      if (values.length > size ** 3 * 3) fail('Too many LUT rows');
    }
  }
  const result = colorLutSchema.safeParse({
    size,
    domainMin,
    domainMax,
    values,
  });
  if (!result.success)
    fail(result.error.issues.map((i) => i.message).join('; '));
  return result.data!;
}

export function lutColor(lut: ColorLut, rgb: number[]): number[] {
  const p = rgb.map(
    (v, i) =>
      Math.max(
        0,
        Math.min(
          1,
          (v - lut.domainMin[i]!) / (lut.domainMax[i]! - lut.domainMin[i]!),
        ),
      ) *
      (lut.size - 1),
  );
  const lo = p.map(Math.floor),
    hi = lo.map((v) => Math.min(lut.size - 1, v + 1)),
    f = p.map((v, i) => v - lo[i]!);
  const out = [0, 0, 0];
  for (let b = 0; b < 2; b++)
    for (let g = 0; g < 2; g++)
      for (let r = 0; r < 2; r++) {
        const index =
          ((b ? hi[2]! : lo[2]!) * lut.size ** 2 +
            (g ? hi[1]! : lo[1]!) * lut.size +
            (r ? hi[0]! : lo[0]!)) *
          3;
        const weight =
          (r ? f[0]! : 1 - f[0]!) *
          (g ? f[1]! : 1 - f[1]!) *
          (b ? f[2]! : 1 - f[2]!);
        for (let c = 0; c < 3; c++)
          out[c] = out[c]! + lut.values[index + c]! * weight;
      }
  return out;
}
export function maskPosition(mask: Mask, localUs: number) {
  const points = mask.points;
  if (!points?.length) return { x: mask.x, y: mask.y };
  const right = points.findIndex((p) => p.timeUs > localUs);
  if (right === 0) return points[0]!;
  if (right === -1) return points.at(-1)!;
  const a = points[right - 1]!,
    b = points[right]!,
    f = (localUs - a.timeUs) / (b.timeUs - a.timeUs);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}
