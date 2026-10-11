import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { applyOperations } from '../../src/core/commands';
import {
  clipSchema,
  newProject,
  textStyleSchema,
  validateBackup,
} from '../../src/core/model';
import {
  TEXT_FONTS,
  TEXT_TEMPLATES,
  matchesTextLabels,
} from '../../src/core/text-library';

describe('styled text contract', () => {
  it('keeps legacy text unchanged and preserves styled text through commands and backups', () => {
    expect(textStyleSchema.parse({ text: 'old' })).toEqual({
      text: 'old',
      fontSize: 64,
      color: '#ffffff',
      background: 'transparent',
      align: 'center',
    });
    for (const template of TEXT_TEMPLATES) {
      const clip = clipSchema.parse({
        id: 'text',
        kind: 'text',
        startUs: 0,
        durationUs: 3000000,
        text: template.style,
      });
      const p = applyOperations(newProject('styles'), [
        { type: 'addTrack', track: { id: 'overlay', kind: 'overlay' } },
        { type: 'insertClip', trackId: 'overlay', clip },
      ]);
      const saved = validateBackup(
        JSON.parse(
          JSON.stringify({
            backupVersion: 1,
            project: p.project,
            assets: [],
            transcripts: [],
          }),
        ),
      );
      expect(saved.project.tracks[0]!.clips[0]!.text).toEqual(clip.text);
      const updated = applyOperations(p.project, [
        { type: 'updateClip', clipId: 'text', patch: { gain: 0.5 } },
      ]);
      expect(updated.project.tracks[0]!.clips[0]!.text).toEqual(clip.text);
    }
  });
  it('rejects invalid families and out-of-range effects without changing the original', () => {
    for (const field of [
      { fontFamily: 'remote-font' },
      { fontFamily: 'font-unavailable' },
      { curve: 181 },
      { outlineWidth: -1 },
      { letterSpacing: 101 },
      { shadow: { color: 'black', blur: -1, offsetX: 0, offsetY: 0 } },
    ]) {
      expect(
        textStyleSchema.safeParse({ text: 'nope', ...field }).success,
      ).toBe(false);
    }
  });
  it('validates every bundled identity and searches combined names, styles and languages', () => {
    expect(TEXT_FONTS.length).toBeGreaterThan(1700);
    expect(
      JSON.stringify(z.toJSONSchema(textStyleSchema.shape.fontFamily)).length,
    ).toBeLessThan(1000);
    for (const font of TEXT_FONTS)
      expect(
        textStyleSchema.safeParse({ text: 'test', fontFamily: font.id })
          .success,
      ).toBe(true);
    expect(
      TEXT_FONTS.filter((font) =>
        matchesTextLabels(font, 'Inter vietnamese modern'),
      ).map((font) => font.id),
    ).toContain('font-inter');
    expect(
      TEXT_FONTS.filter((font) =>
        matchesTextLabels(font, 'Patrick cute handwriting'),
      ).map((font) => font.id),
    ).toEqual(['font-patrick-hand']);
  });
  it('finds font and template labels with case-insensitive multiword search', () => {
    expect(
      TEXT_FONTS.filter((font) => matchesTextLabels(font, ' CuTe ')).map(
        (font) => font.id,
      ),
    ).toEqual(
      expect.arrayContaining(['rounded', 'handwritten', 'font-patrick-hand']),
    );
    expect(
      TEXT_TEMPLATES.filter((item) =>
        matchesTextLabels(item, 'shadowed retro'),
      ).map((item) => item.id),
    ).toEqual(['retro']);
    expect(
      TEXT_TEMPLATES.filter((item) => matchesTextLabels(item, 'curved')),
    ).toHaveLength(1);
  });
});
