import { describe, expect, it } from 'vitest';
import { newProject } from '../../src/core/model';
import {
  ASPECT_RATIOS,
  FRAME_RATES,
  aspectRatioFor,
  resolutionPresets,
} from '../../src/workspace/project-format';

describe('project creation formats', () => {
  it('offers supported dimensions for every aspect ratio and FPS', () => {
    for (const ratio of ASPECT_RATIOS) {
      const presets = resolutionPresets(ratio.value);
      expect(presets.length).toBeGreaterThan(0);
      for (const preset of presets) {
        expect(aspectRatioFor(preset.width, preset.height)).toBe(ratio.value);
        for (const rate of FRAME_RATES) {
          const project = newProject('Format', {
            width: preset.width,
            height: preset.height,
            frameRate: { num: rate.num, den: rate.den },
          });
          expect(project.frameRate).toEqual({ num: rate.num, den: rate.den });
        }
      }
    }
  });

  it('keeps landscape 4K and omits portrait resolutions beyond the height limit', () => {
    expect(resolutionPresets('16:9').at(-1)).toMatchObject({
      width: 3840,
      height: 2160,
    });
    expect(
      resolutionPresets('9:16').map((item) => [item.width, item.height]),
    ).toEqual([
      [720, 1280],
      [1080, 1920],
    ]);
    expect(aspectRatioFor(1000, 750)).toBe('4:3');
    expect(aspectRatioFor(1, 1)).toBe('1:1');
    expect(aspectRatioFor(1919, 1080)).toBe('custom');
    expect(aspectRatioFor(1000, 700)).toBe('custom');
    expect(aspectRatioFor(0, 0)).toBe('custom');
    expect(resolutionPresets('custom')).toEqual([]);
  });
});
