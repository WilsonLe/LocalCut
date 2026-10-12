import { lutColor } from '../core/effects';
import type { Clip } from '../core/model';

/** Mutates only a borrowed scratch pixel buffer. Alpha survives color grading. */
export function colorPixels(data: Uint8ClampedArray, clip: Clip) {
  const strength = clip.colorStrength ?? 1;
  if (!strength) return;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const original = [data[i]! / 255, data[i + 1]! / 255, data[i + 2]! / 255];
    let rgb = [...original];
    switch (clip.colorPreset) {
      case 'warm':
        rgb = [rgb[0]! * 1.08 + 0.02, rgb[1]!, rgb[2]! * 0.88];
        break;
      case 'cool':
        rgb = [rgb[0]! * 0.9, rgb[1]!, rgb[2]! * 1.08 + 0.02];
        break;
      case 'cinematic':
        rgb = [
          rgb[0]! * 1.1 - 0.04,
          rgb[1]! * 1.04 - 0.01,
          rgb[2]! * 0.94 + 0.03,
        ];
        break;
      case 'mono': {
        const l = rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
        rgb = [l, l, l];
        break;
      }
    }
    if (clip.colorLut) rgb = lutColor(clip.colorLut, rgb);
    for (let c = 0; c < 3; c++)
      data[i + c] = (original[c]! + (rgb[c]! - original[c]!) * strength) * 255;
  }
}
export function chromaPixels(data: Uint8ClampedArray, clip: Clip) {
  const key = clip.chromaKey;
  if (!key) return;
  const rgb = [1, 3, 5].map(
    (i) => parseInt(key.color.slice(i, i + 2), 16) / 255,
  );
  const cb = (r: number, g: number, b: number) =>
    b - (0.2126 * r + 0.7152 * g + 0.0722 * b);
  const cr = (r: number, g: number, b: number) =>
    r - (0.2126 * r + 0.7152 * g + 0.0722 * b);
  const target = [cb(rgb[0]!, rgb[1]!, rgb[2]!), cr(rgb[0]!, rgb[1]!, rgb[2]!)];
  const dominant = rgb.indexOf(Math.max(...rgb));
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]! / 255,
      g = data[i + 1]! / 255,
      b = data[i + 2]! / 255;
    const distance =
      Math.hypot(cb(r, g, b) - target[0]!, cr(r, g, b) - target[1]!) / 2;
    const alpha = key.softness
      ? Math.max(0, Math.min(1, (distance - key.tolerance) / key.softness))
      : Number(distance > key.tolerance);
    data[i + 3] = data[i + 3]! * alpha;
    const other = Math.max(...[r, g, b].filter((_, c) => c !== dominant));
    data[i + dominant] =
      data[i + dominant]! -
      Math.max(0, data[i + dominant]! - other * 255) * key.spill * (1 - alpha);
  }
}

/** Bounded crossover EQ; callers supply preroll on discontinuous windows. */
export function processAudio(channels: Float32Array[], clip: Clip) {
  const eq = clip.equalizer,
    balance = clip.balance ?? 0;
  const lowGain = 10 ** ((eq?.lowDb ?? 0) / 20),
    midGain = 10 ** ((eq?.midDb ?? 0) / 20),
    highGain = 10 ** ((eq?.highDb ?? 0) / 20);
  const a = 1 - Math.exp((-2 * Math.PI * 300) / 48000),
    b = 1 - Math.exp((-2 * Math.PI * 3000) / 48000);
  channels.forEach((channel, c) => {
    let low = 0,
      upper = 0;
    const pan = Math.cos(
      (Math.max(0, c === 0 ? balance : -balance) * Math.PI) / 2,
    );
    for (let i = 0; i < channel.length; i++) {
      const x = channel[i]!;
      low += a * (x - low);
      upper += b * (x - upper);
      channel[i] =
        (eq
          ? low * lowGain + (upper - low) * midGain + (x - upper) * highGain
          : x) * pan;
    }
  });
}
