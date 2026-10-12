import { describe, expect, it } from 'vitest';
import {
  parseCube,
  lutColor,
  maskPosition,
  maskSchema,
} from '../../src/core/effects';
import { clipSchema, clipPatchSchema, newProject } from '../../src/core/model';
import { applyOperations } from '../../src/core/commands';
import {
  colorPixels,
  chromaPixels,
  processAudio,
} from '../../src/media/effects';
import { suppressNoise } from '../../src/media/denoise';
import { matchRegion } from '../../src/media/mask-tracking';
const identity =
  'TITLE "Identity"\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1';
const clip = () =>
  clipSchema.parse({
    id: 'clip',
    assetId: 'image',
    kind: 'image',
    startUs: 0,
    durationUs: 1e6,
  });
const rms = (values: Float32Array) =>
  Math.sqrt(values.reduce((s, v) => s + v * v, 0) / values.length);
describe('creative effects', () => {
  it('imports red-fastest cubes, interpolates domains and rejects malformed tables', () => {
    expect(lutColor(parseCube(identity), [0.25, 0.5, 0.75])).toEqual([
      0.25, 0.5, 0.75,
    ]);
    const domain = parseCube(
      identity.replace(
        'LUT_3D_SIZE 2',
        'LUT_3D_SIZE 2\nDOMAIN_MIN -1 -1 -1\nDOMAIN_MAX 1 1 1',
      ),
    );
    expect(lutColor(domain, [0, 0, 0])).toEqual([0.5, 0.5, 0.5]);
    for (const text of [
      identity + '\n1 1 1',
      identity.replace('1 1 1', 'NaN 1 1'),
      identity.replace('LUT_3D_SIZE 2', 'LUT_1D_SIZE 2'),
      identity + '\nDOMAIN_MIN 0 0 0',
      identity.replace('LUT_3D_SIZE 2', 'LUT_3D_SIZE 66'),
      identity.replace('1 1 1', ''),
    ])
      expect(() => parseCube(text)).toThrow();
  });
  it('keeps neutral samples exact and preserves alpha through presets/LUT strength', () => {
    const source = new Uint8ClampedArray([100, 140, 180, 123]);
    const neutral = source.slice();
    colorPixels(neutral, clip());
    expect(neutral).toEqual(source);
    const graded = source.slice();
    colorPixels(graded, { ...clip(), colorPreset: 'mono' });
    expect(graded[0]).toBe(graded[1]);
    expect(graded[1]).toBe(graded[2]);
    expect(graded[3]).toBe(123);
    colorPixels(source, { ...clip(), colorPreset: 'warm', colorStrength: 0 });
    expect(source).toEqual(neutral);
  });
  it('removes green and preserves foreground with configurable spill suppression', () => {
    const pixels = new Uint8ClampedArray([0, 255, 0, 255, 255, 0, 0, 255]);
    chromaPixels(pixels, {
      ...clip(),
      chromaKey: { color: '#00ff00', tolerance: 0.1, softness: 0.1, spill: 1 },
    });
    expect(pixels[3]).toBe(0);
    expect(pixels[7]).toBe(255);
    expect(pixels[4]).toBe(255);
  });
  it('balances without amplification and gives frequency-dependent EQ', () => {
    const original = Float32Array.from(
      { length: 4800 },
      (_, i) => 0.1 * Math.sin((2 * Math.PI * 100 * i) / 48000),
    );
    const samples = [original.slice(), original.slice()];
    processAudio(samples, { ...clip(), balance: 1 });
    expect(rms(samples[0]!)).toBeLessThan(1e-8);
    expect(samples[1]).toEqual(original);
    const bass = [original.slice(), original.slice()];
    processAudio(bass, {
      ...clip(),
      equalizer: { lowDb: 12, midDb: 0, highDb: 0 },
    });
    expect(rms(bass[0]!.slice(1000))).toBeGreaterThan(rms(original) * 3);
  });
  it('suppresses stationary low noise, preserves a loud tone and is independent of window slicing', () => {
    const input = Float32Array.from(
      { length: 10000 },
      (_, i) =>
        0.2 * Math.sin((2 * Math.PI * 750 * i) / 48000) +
        0.00002 * Math.sin(i * 37),
    );
    const whole = [input.slice()];
    suppressNoise(whole, 0, 1, -50);
    expect(rms(whole[0]!.slice(2048, 8192))).toBeGreaterThan(0.13);
    const part = [input.slice(2048, 8192)];
    suppressNoise(part, 2048, 1, -50);
    for (let i = 512; i < part[0]!.length - 512; i++)
      expect(part[0]![i]).toBeCloseTo(whole[0]![i + 2048]!, 7);
    const noise = [
      Float32Array.from({ length: 4096 }, (_, i) => 0.00002 * Math.sin(i * 37)),
    ];
    suppressNoise(noise, 0, 1, -50);
    expect(rms(noise[0]!)).toBeLessThan(1e-7);
  });
  it('preserves omitted fields, clears nested settings and rebases mask motion at a split', () => {
    expect(clipPatchSchema.parse({ balance: 0.5 })).toEqual({ balance: 0.5 });
    expect(clipPatchSchema.parse({ mask: null, colorLut: null })).toEqual({
      mask: null,
      colorLut: null,
    });
    const mask = maskSchema.parse({
      shape: 'rectangle',
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.2,
      invert: false,
      feather: 0,
      points: [
        { timeUs: 0, x: 0.1, y: 0.1 },
        { timeUs: 1e6, x: 0.6, y: 0.6 },
      ],
    });
    const project = {
      ...newProject('mask'),
      tracks: [
        {
          id: 'v',
          kind: 'video' as const,
          muted: false,
          clips: [{ ...clip(), mask }],
        },
      ],
    };
    const split = applyOperations(project, [
      { type: 'splitClip', clipId: 'clip', atUs: 500000, rightClipId: 'right' },
    ]).project;
    const [a, b] = split.tracks[0]!.clips;
    expect(maskPosition(a!.mask!, 500000).x).toBeCloseTo(0.35);
    expect(maskPosition(b!.mask!, 0).x).toBeCloseTo(0.35);
    expect(maskPosition(b!.mask!, 250000).x).toBeCloseTo(0.475);
    expect(() => maskSchema.parse({ ...mask, x: 0.9 })).toThrow();
  });
  it('tracks textured region translation and rejects featureless regions', () => {
    const width = 64,
      height = 64,
      before = new Uint8ClampedArray(width * height * 4),
      after = before.slice();
    for (let y = 10; y < 30; y++)
      for (let x = 10; x < 30; x++) {
        const v = (x * 19 + y * 53) % 255;
        for (let c = 0; c < 3; c++) {
          before[(y * width + x) * 4 + c] = v;
          after[((y + 4) * width + x + 5) * 4 + c] = v;
        }
      }
    const result = matchRegion(before, after, width, height, 10, 10, 20, 20);
    expect(result.x).toBe(15);
    expect(result.y).toBe(14);
    expect(result.confidence).toBe(1);
    expect(() =>
      matchRegion(
        new Uint8ClampedArray(width * height * 4),
        after,
        width,
        height,
        10,
        10,
        20,
        20,
      ),
    ).toThrow(/texture/);
  });
  it('retimes replacement mask motion and fades through speed ramps', () => {
    const mask = {
      shape: 'ellipse' as const,
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.2,
      invert: false,
      feather: 1,
      points: [
        { timeUs: 0, x: 0.1, y: 0.1 },
        { timeUs: 900000, x: 0.5, y: 0.5 },
      ],
    };
    const video = clipSchema.parse({
      id: 'v',
      kind: 'video',
      assetId: 'source',
      startUs: 0,
      durationUs: 1000000,
      sourceOutUs: 1000000,
    });
    const project = {
      ...newProject('Ramp mask'),
      tracks: [
        { id: 't', kind: 'video' as const, muted: false, clips: [video] },
      ],
    };
    const saved = applyOperations(project, [
      { type: 'updateClip', clipId: 'v', patch: { mask, fadeInUs: 100000 } },
      {
        type: 'setSpeedRamp',
        clipId: 'v',
        points: [
          { position: 0, speed: 2 },
          { position: 1, speed: 2 },
        ],
        pitchMode: 'preserve',
      },
    ]).project.tracks[0]!.clips[0]!;
    expect(saved.durationUs).toBe(500000);
    expect(saved.mask!.points![1]!.timeUs).toBe(450000);
    expect(saved.fadeInUs).toBe(50000);
    const constant = applyOperations(project, [
      { type: 'updateClip', clipId: 'v', patch: { mask } },
      { type: 'setSpeed', clipId: 'v', speed: 2 },
    ]).project.tracks[0]!.clips[0]!;
    expect(constant.mask!.points![1]!.timeUs).toBe(450000);
  });
});
