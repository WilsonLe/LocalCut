import { TEXT_FONTS } from '../core/text-library';
import type { FontId } from '../core/text-library';
import { ensureFontFamily } from '../media/fonts';
import { systemAppearanceFonts } from './appearance';

// Preserve appearance's old IDs/stacks while offering every authored-text face.
export const appearanceFontChoices = [
  ...systemAppearanceFonts.map((font) => ({
    ...font,
    labels: [...font.labels],
  })),
  ...TEXT_FONTS.filter(
    (font) => !systemAppearanceFonts.some((system) => system.id === font.id),
  ),
];

export async function prepareAppearanceFonts(ids: string[]) {
  await Promise.all(
    [...new Set(ids)]
      .filter((id) => id.startsWith('font-'))
      .map((id) => ensureFontFamily(id as FontId)),
  );
}
