import type { Project } from '../editor';

export type ProjectFormat = Pick<Project, 'width' | 'height' | 'frameRate'>;

export const ASPECT_RATIOS = [
  { value: '16:9', label: '16:9 — Landscape', width: 16, height: 9 },
  { value: '9:16', label: '9:16 — Portrait', width: 9, height: 16 },
  { value: '1:1', label: '1:1 — Square', width: 1, height: 1 },
  { value: '4:3', label: '4:3', width: 4, height: 3 },
  { value: '3:4', label: '3:4', width: 3, height: 4 },
  { value: '21:9', label: '21:9 — Ultrawide', width: 21, height: 9 },
];

export const FRAME_RATES = [
  { value: '24000/1001', label: '23.976 fps', num: 24000, den: 1001 },
  { value: '24/1', label: '24 fps', num: 24, den: 1 },
  { value: '25/1', label: '25 fps', num: 25, den: 1 },
  { value: '30000/1001', label: '29.97 fps', num: 30000, den: 1001 },
  { value: '30/1', label: '30 fps', num: 30, den: 1 },
  { value: '50/1', label: '50 fps', num: 50, den: 1 },
  { value: '60000/1001', label: '59.94 fps', num: 60000, den: 1001 },
  { value: '60/1', label: '60 fps', num: 60, den: 1 },
];

export function resolutionPresets(aspectRatio: string) {
  const ratio = ASPECT_RATIOS.find((item) => item.value === aspectRatio);
  if (!ratio) return [];
  return [720, 1080, 1440, 2160]
    .map((size) => {
      const shortSide = Math.min(ratio.width, ratio.height);
      const width = Math.round((size * ratio.width) / shortSide / 2) * 2;
      const height = Math.round((size * ratio.height) / shortSide / 2) * 2;
      return {
        value: String(size),
        label: `${size}p (${width} × ${height})`,
        width,
        height,
      };
    })
    .filter(({ width, height }) => width <= 3840 && height <= 2160);
}

export function aspectRatioFor(width: number, height: number) {
  return (
    ASPECT_RATIOS.find(
      (ratio) =>
        width > 0 &&
        height > 0 &&
        width * ratio.height === height * ratio.width,
    )?.value ?? 'custom'
  );
}
