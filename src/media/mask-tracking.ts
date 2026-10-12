import type { Mask } from '../core/effects';
import type { Project } from '../core/model';
import { invariant } from '../core/errors';
import { checkAbort } from '../services/jobs';
import type { Progress } from '../services/jobs';
import type { Store } from '../storage/store';
import { Renderer } from './composition';

export interface MaskTrackingResult {
  mask: Mask;
  confidence: number;
  revision: number;
}
/** Translation-only template tracker on local, bounded 192-pixel frames. */
export async function trackMask(
  store: Store,
  project: Project,
  clipId: string,
  signal: AbortSignal,
  progress: (p: Progress) => void,
): Promise<MaskTrackingResult> {
  const clip = project.tracks
    .flatMap((t) => t.clips)
    .find((c) => c.id === clipId);
  invariant(
    clip?.kind === 'video' && clip.mask,
    'INVALID_DOCUMENT',
    'Tracking requires a video clip with a mask',
  );
  invariant(
    !clip.crop,
    'INVALID_DOCUMENT',
    'Remove source crop before tracking',
  );
  const asset = await store.getAsset(clip.assetId!);
  const width = 192,
    height = Math.max(2, Math.round((192 * asset.height) / asset.width));
  invariant(
    height <= 384,
    'INVALID_DOCUMENT',
    'Tracking supports source aspect ratios up to 2:1 portrait',
  );
  const mask = structuredClone(clip.mask);
  delete mask.points;
  const isolated: Project = {
    ...project,
    width,
    height,
    transitions: [],
    tracks: [
      {
        id: 'track',
        kind: 'video',
        muted: true,
        clips: [
          {
            ...clip,
            x: 0,
            y: 0,
            width,
            height,
            rotation: 0,
            opacity: 1,
            brightness: 1,
            contrast: 1,
            saturation: 1,
            grayscale: 0,
            blur: 0,
            colorPreset: 'none',
            colorLut: null,
            mask: null,
            chromaKey: null,
            blendMode: 'source-over',
            transcriptId: undefined,
            keyframes: {},
          },
        ],
      },
    ],
  };
  const renderer = new Renderer(store, isolated, width, height),
    points: NonNullable<Mask['points']> = [];
  let previous: Uint8ClampedArray | undefined,
    x = Math.round(mask.x * width),
    y = Math.round(mask.y * height),
    confidence = 1;
  const w = Math.max(2, Math.round(mask.width * width)),
    h = Math.max(2, Math.round(mask.height * height));
  const step = Math.max(100000, Math.ceil(clip.durationUs / 600));
  try {
    for (let local = 0; local < clip.durationUs; local += step) {
      checkAbort(signal);
      const canvas = await renderer.frame(clip.startUs + local, signal);
      const pixels = canvas
        .getContext('2d')!
        .getImageData(0, 0, width, height).data;
      if (previous) {
        const match = matchRegion(previous, pixels, width, height, x, y, w, h);
        x = match.x;
        y = match.y;
        confidence = Math.min(confidence, match.confidence);
        invariant(
          match.confidence >= 0.2,
          'INVALID_DOCUMENT',
          'Mask tracking lost the subject. Shorten the clip or choose a more distinctive region',
        );
      }
      points.push({
        timeUs: local,
        x: Math.min(1 - mask.width, x / width),
        y: Math.min(1 - mask.height, y / height),
      });
      previous = pixels;
      progress({ stage: 'tracking mask', progress: local / clip.durationUs });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    mask.points = points;
    return { mask, confidence, revision: project.revision };
  } finally {
    renderer.dispose();
  }
}
/** Mean-centered SSD rejects featureless regions and tolerates uniform lighting shifts. */
export function matchRegion(
  previous: Uint8ClampedArray,
  current: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const samples: { x: number; y: number; v: number }[] = [];
  const luminance = (data: Uint8ClampedArray, px: number, py: number) => {
    const i = (py * width + px) * 4;
    return 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
  };
  for (let py = 1; py < h - 1; py += Math.max(1, Math.floor(h / 16)))
    for (let px = 1; px < w - 1; px += Math.max(1, Math.floor(w / 16)))
      if (x + px < width && y + py < height)
        samples.push({ x: px, y: py, v: luminance(previous, x + px, y + py) });
  invariant(
    samples.length >= 4,
    'INVALID_DOCUMENT',
    'Mask region is too small to track',
  );
  const mean = samples.reduce((s, p) => s + p.v, 0) / samples.length;
  const variance =
    samples.reduce((s, p) => s + (p.v - mean) ** 2, 0) / samples.length;
  invariant(
    variance >= 16,
    'INVALID_DOCUMENT',
    'Mask region needs visible texture for tracking',
  );
  let best = Infinity,
    bx = x,
    by = y;
  for (let dy = -16; dy <= 16; dy++)
    for (let dx = -16; dx <= 16; dx++) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx + w > width || ny + h > height) continue;
      const values = samples.map((p) => luminance(current, nx + p.x, ny + p.y));
      const m = values.reduce((s, v) => s + v, 0) / values.length;
      const error =
        values.reduce(
          (s, v, i) => s + (v - m - (samples[i]!.v - mean)) ** 2,
          0,
        ) / values.length;
      if (
        error < best ||
        (error === best && dx * dx + dy * dy < (bx - x) ** 2 + (by - y) ** 2)
      ) {
        best = error;
        bx = nx;
        by = ny;
      }
    }
  return { x: bx, y: by, confidence: Math.max(0, 1 - best / (variance * 2)) };
}
