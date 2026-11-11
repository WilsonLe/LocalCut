import { describe, expect, it } from 'vitest';
import { assetSchema } from '../../src/core/model';
import { assetClipState, validateAssetClips } from '../../src/core/asset-clips';
import { assetSchema as toolSchema } from '../../src/workspace/webmcp/contracts';
const asset = {
  id: 'asset',
  name: 'source',
  kind: 'audio',
  size: 32,
  type: 'audio/wav',
  durationUs: 6_000_000,
  width: 0,
  height: 0,
  rotation: 0,
  status: 'ready',
};
const clip = {
  id: 'opening',
  name: 'Opening',
  startUs: 0,
  endUs: 2_000_000,
  context: '  Context\n',
  transcript: 'Xin chào.\nSecond line.',
};
describe('asset source clips', () => {
  it('provides a whole-source clip without changing legacy data', () => {
    const input = assetSchema.parse({
      ...asset,
      notes: {
        revision: 3,
        context: clip.context,
        transcript: clip.transcript,
      },
    });
    const before = structuredClone(input);
    expect(assetClipState(input)).toEqual({
      revision: 3,
      clips: [
        {
          id: 'full-source',
          name: 'Clip 1',
          startUs: 0,
          endUs: 6_000_000,
          context: clip.context,
          transcript: clip.transcript,
        },
      ],
    });
    expect(input).toEqual(before);
    expect(assetClipState(asset)).toMatchObject({
      revision: 0,
      clips: [{ context: '', transcript: '' }],
    });
  });
  it('preserves independent text, overlapping source selections and explicit empty text', () => {
    const clips = [
      clip,
      {
        ...clip,
        id: 'detail',
        startUs: 1_000_000,
        endUs: 4_000_000,
        context: '',
        transcript: '',
      },
    ];
    expect(validateAssetClips(clips, asset)).toEqual(clips);
    expect(
      assetSchema.parse({ ...asset, clips, clipsRevision: 4 }).clips,
    ).toEqual(clips);
  });
  it.each([
    'empty',
    'duplicate',
    'reverse',
    'past-end',
    'zero',
    'negative',
    'fractional',
    'name',
    'oversized',
    'unknown',
  ])('rejects invalid %s clips at write and backup boundaries', (kind) => {
    let clips: unknown = [clip];
    if (kind === 'empty') clips = [];
    if (kind === 'duplicate') clips = [clip, clip];
    if (kind === 'reverse') clips = [{ ...clip, startUs: 3_000_000 }];
    if (kind === 'past-end') clips = [{ ...clip, endUs: 6_000_001 }];
    if (kind === 'zero') clips = [{ ...clip, endUs: 0 }];
    if (kind === 'negative') clips = [{ ...clip, startUs: -1 }];
    if (kind === 'fractional') clips = [{ ...clip, endUs: 1.2 }];
    if (kind === 'name') clips = [{ ...clip, name: ' ' }];
    if (kind === 'oversized')
      clips = [{ ...clip, context: 'x'.repeat(100001) }];
    if (kind === 'unknown') clips = [{ ...clip, provider: 'no' }];
    expect(() => validateAssetClips(clips, asset)).toThrow();
    expect(assetSchema.safeParse({ ...asset, clips }).success).toBe(false);
  });
  it('allows a still-image clip with zero source duration', () => {
    expect(
      validateAssetClips([{ ...clip, startUs: 0, endUs: 0 }], {
        durationUs: 0,
      }),
    ).toHaveLength(1);
  });
  it('exposes the canonical source-clip shape to WebMCP', () => {
    expect(
      toolSchema.parse({
        projectId: 'p',
        assetId: 'a',
        action: 'update_clips',
        expectedClipsRevision: 0,
        clips: [clip],
      }).clips,
    ).toEqual([clip]);
    expect(
      toolSchema.parse({
        projectId: 'p',
        assetId: 'a',
        action: 'preview_clip',
        clipId: clip.id,
      }).clipId,
    ).toBe(clip.id);
  });
});
