import { z } from 'zod';

const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = z.string().max(2000);
export const indexLabelSchema = z
  .object({
    summary: text.min(1),
    subjects: z.array(z.string().max(100)).max(32),
    scene: z.string().max(300),
    style: z.string().max(300),
    tags: z.array(z.string().max(100)).max(32),
    sound: z.string().max(500),
  })
  .strict();
export type IndexLabel = z.infer<typeof indexLabelSchema>;
export interface FrameMetrics {
  timeUs: number;
  sharpness: number;
  clipped: number;
  motion: number;
  histogram: number[];
  hash: string;
  colors: string[];
}
export interface IndexArtifact {
  id: string;
  kind: 'image' | 'video' | 'audio';
  type: 'image/jpeg' | 'video/mp4' | 'audio/wav';
  size: number;
}
export interface IndexScene {
  id: string;
  startUs: number;
  endUs: number;
  representativeUs: number;
  actionUs: number;
  excerptStartUs: number;
  excerptEndUs: number;
  representative?: FrameMetrics;
  audio?: AudioMetrics;
  artifacts: IndexArtifact[];
  label?: IndexLabel;
}
export interface AssetAnalysis {
  version: 1;
  settings: {
    sampleRate: 4;
    analysisWidth: 160;
    cutThreshold: 0.45;
    excerptUs: 4000000;
    audio?: {
      windowUs: 250000;
      silenceRms: 0.005;
      minSilenceUs: 500000;
      maxSegmentUs: 30000000;
    };
  };
  frames: FrameMetrics[];
  audio?: AudioMetrics[];
  scenes: IndexScene[];
  scanMs: number;
  generationMs: number;
}
export interface IndexRequestManifest {
  id: string;
  sceneId?: string;
  prompt: string;
  model: string;
  artifactIds: string[];
  createdAt: number;
  purpose?: 'summary-part';
  label?: IndexLabel;
  response?: string;
  actualModel?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;
  };
}
export interface AssetIndexRun {
  version: 1;
  id: string;
  assetId: string;
  createdAt: number;
  source: {
    size: number;
    lastModified: number;
    kind: 'image' | 'video' | 'audio';
    width: number;
    height: number;
    durationUs: number;
    hasAudio: boolean;
  };
  status:
    'analyzing' | 'analyzed' | 'labeling' | 'complete' | 'failed' | 'cancelled';
  invalidated: boolean;
  deleting?: boolean;
  analysis: AssetAnalysis;
  label?: IndexLabel;
  requests: IndexRequestManifest[];
  error?: string;
}

/** Pixel metrics are pure and repeatable for identical decoded pixels. */
export function measureFrame(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  timeUs: number,
  previous?: Uint8Array,
): { metrics: FrameMetrics; luma: Uint8Array } {
  const count = width * height,
    luma = new Uint8Array(count),
    histogram = new Array<number>(48).fill(0);
  const colorCounts = new Map<number, number>();
  let clipped = 0,
    motion = 0,
    sum = 0,
    squared = 0,
    edges = 0;
  for (let i = 0; i < count; i++) {
    const r = pixels[i * 4]!,
      g = pixels[i * 4 + 1]!,
      b = pixels[i * 4 + 2]!;
    const color = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
    luma[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    histogram[r >> 4]!++;
    histogram[16 + (g >> 4)]!++;
    histogram[32 + (b >> 4)]!++;
    if (luma[i]! < 8 || luma[i]! > 247) clipped++;
    if (previous) motion += Math.abs(luma[i]! - previous[i]!);
  }
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const value =
        4 * luma[i]! -
        luma[i - 1]! -
        luma[i + 1]! -
        luma[i - width]! -
        luma[i + width]!;
      sum += value;
      squared += value * value;
      edges++;
    }
  let hash = '';
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const row = Math.min(height - 1, Math.floor(((y + 0.5) * height) / 8));
      const left = Math.min(width - 1, Math.floor((x * width) / 9));
      const right = Math.min(width - 1, Math.floor(((x + 1) * width) / 9));
      hash +=
        luma[row * width + left]! > luma[row * width + right]! ? '1' : '0';
    }
  const colors = [...colorCounts]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 3)
    .map(
      ([color]) =>
        `#${[(color >> 8) & 15, (color >> 4) & 15, color & 15].map((n) => (n * 16 + 8).toString(16).padStart(2, '0')).join('')}`,
    );
  return {
    luma,
    metrics: {
      timeUs,
      sharpness: edges ? squared / edges - (sum / edges) ** 2 : 0,
      clipped: clipped / count,
      motion: motion / count / 255,
      histogram: histogram.map((n) => n / count),
      hash,
      colors,
    },
  };
}
export function histogramDistance(a: FrameMetrics, b: FrameMetrics) {
  return (
    a.histogram.reduce((n, v, i) => n + Math.abs(v - b.histogram[i]!), 0) / 6
  );
}
export function hashDistance(a: string, b: string) {
  return [...a].reduce((n, v, i) => n + Number(v !== b[i]), 0);
}
export function selectScenes(
  frames: FrameMetrics[],
  durationUs: number,
  image = false,
): IndexScene[] {
  if (!frames.length) return [];
  const groups: FrameMetrics[][] = [[frames[0]!]];
  for (let i = 1; i < frames.length; i++) {
    if (histogramDistance(frames[i - 1]!, frames[i]!) >= 0.45) groups.push([]);
    groups[groups.length - 1]!.push(frames[i]!);
  }
  return groups.map((group, i) => {
    const startUs = i === 0 ? 0 : group[0]!.timeUs;
    const endUs = groups[i + 1]?.[0]?.timeUs ?? durationUs;
    const representative = [...group].sort(
      (a, b) =>
        b.sharpness * (1 - b.clipped) - a.sharpness * (1 - a.clipped) ||
        a.clipped - b.clipped ||
        a.timeUs - b.timeUs,
    )[0]!;
    const peak = group
      .slice(1)
      .sort((a, b) => b.motion - a.motion || a.timeUs - b.timeUs)[0];
    const actionUs =
      peak && peak.motion > 0 ? peak.timeUs : Math.floor((startUs + endUs) / 2);
    const excerptStartUs = image
      ? 0
      : Math.max(startUs, Math.min(actionUs - 2000000, endUs - 4000000));
    return {
      id: `scene-${i + 1}`,
      startUs,
      endUs,
      representativeUs: representative.timeUs,
      actionUs,
      excerptStartUs,
      excerptEndUs: image ? 0 : Math.min(endUs, excerptStartUs + 4000000),
      representative,
      artifacts: [],
    };
  });
}
export function parseIndexLabel(response: string): IndexLabel {
  const body = response
    .trim()
    .replace(/^```(?:json)?\s*/, '')
    .replace(/\s*```$/, '');
  return indexLabelSchema.parse(JSON.parse(body));
}
export function indexText(run: AssetIndexRun) {
  return {
    runId: run.id,
    assetId: run.assetId,
    label: run.label,
    scenes: run.analysis.scenes.map(
      ({ id, startUs, endUs, representativeUs, actionUs, label }) => ({
        id,
        startUs,
        endUs,
        representativeUs,
        actionUs,
        label,
      }),
    ),
  };
}
// Host-owned timestamps are never parsed from model output.
export const indexSceneResponseSchema = z
  .object({ sceneId: z.string().max(100), label: indexLabelSchema })
  .strict();
export const indexTimeSchema = time;

export interface AudioMetrics {
  timeUs: number;
  rms: number;
  peak: number;
}
/** Silence edges and bounded continuous regions; no speech or semantic model. */
export function selectAudioSegments(
  windows: AudioMetrics[],
  durationUs: number,
): IndexScene[] {
  if (!windows.length || durationUs <= 0) return [];
  const cuts = new Set<number>([0]);
  let quietStart: number | undefined;
  for (const window of windows) {
    if (window.rms < 0.005) quietStart ??= window.timeUs;
    else if (quietStart !== undefined) {
      if (window.timeUs - quietStart >= 500000) {
        cuts.add(quietStart);
        cuts.add(window.timeUs);
      }
      quietStart = undefined;
    }
  }
  if (quietStart !== undefined && durationUs - quietStart >= 500000)
    cuts.add(quietStart);
  const edges = [...cuts, durationUs]
    .filter((t) => t >= 0 && t <= durationUs)
    .sort((a, b) => a - b);
  const ranges: [number, number][] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    for (let start = edges[i]!; start < edges[i + 1]!; start += 30000000)
      ranges.push([start, Math.min(edges[i + 1]!, start + 30000000)]);
  }
  let cursor = 0;
  return ranges.map(([startUs, endUs], i) => {
    const from = cursor;
    while (cursor < windows.length && windows[cursor]!.timeUs < endUs) cursor++;
    const group = windows.slice(from, cursor);
    const peak = [...group].sort(
      (a, b) => b.rms - a.rms || b.peak - a.peak || a.timeUs - b.timeUs,
    )[0];
    const actionUs =
      peak && peak.rms >= 0.005
        ? peak.timeUs
        : Math.floor((startUs + endUs) / 2);
    const excerptStartUs = Math.max(
      startUs,
      Math.min(actionUs - 2000000, endUs - 4000000),
    );
    return {
      id: `scene-${i + 1}`,
      startUs,
      endUs,
      representativeUs: Math.floor((startUs + endUs) / 2),
      actionUs,
      excerptStartUs,
      excerptEndUs: Math.min(endUs, excerptStartUs + 4000000),
      audio: peak,
      artifacts: [],
    };
  });
}
