import { describe, it, expect } from 'vitest';
import { newProject, clipSchema } from '../../src/core/model';
import type { Project } from '../../src/core/model';
import { applyOperations } from '../../src/core/commands';
import { parseTool, proposalBatch } from '../../src/ai/tools';
import { localError } from '../../src/ai/assistant-errors';
import { EditorError } from '../../src/core/errors';

const project = () => ({
  ...newProject('PRIVATE_NAME'),
  tracks: [
    {
      id: 'track',
      kind: 'video' as const,
      muted: false,
      clips: [
        clipSchema.parse({
          id: 'a',
          kind: 'image',
          assetId: 'asset',
          startUs: 0,
          durationUs: 2000000,
        }),
        clipSchema.parse({
          id: 'b',
          kind: 'image',
          assetId: 'asset',
          startUs: 2000000,
          durationUs: 2000000,
        }),
      ],
    },
  ],
});
const transition = {
  id: 'cross',
  kind: 'crossfade' as const,
  trackId: 'track',
  fromClipId: 'a',
  toClipId: 'b',
};
describe('safe actionable edit validation', () => {
  it.each(['touching', 'gap', 'reversed', 'wrong-track', 'third-clip'])(
    'rejects %s transitions with the precise safe repair and no partial changes',
    (mode) => {
      const p = project();
      if (mode === 'gap') p.tracks[0]!.clips[1]!.startUs = 3000000;
      if (mode === 'third-clip') {
        p.tracks[0]!.clips[1]!.startUs = 1000000;
        p.tracks[0]!.clips.push(
          clipSchema.parse({
            id: 'third',
            kind: 'image',
            assetId: 'asset',
            startUs: 1500000,
            durationUs: 1000000,
          }),
        );
      }
      if (mode === 'wrong-track')
        p.tracks.push({ id: 'other', kind: 'video', muted: false, clips: [] });
      const before = structuredClone(p);
      const t = {
        ...transition,
        ...(mode === 'reversed' ? { fromClipId: 'b', toClipId: 'a' } : {}),
        ...(mode === 'wrong-track' ? { trackId: 'other' } : {}),
      };
      try {
        proposalBatch(
          p,
          [{ type: 'addTransition', transition: t }],
          'request',
          Infinity,
        );
        throw new Error('accepted invalid transition');
      } catch (error) {
        const safe = localError(error);
        expect(safe.details).toMatchObject({
          validation: { rule: 'transition_overlap', transitionIndex: 0 },
        });
        expect(safe.message).toContain(
          'Touching or gapped clips cannot crossfade',
        );
        expect(JSON.stringify(safe)).not.toContain('PRIVATE_NAME');
      }
      expect(p).toEqual(before);
    },
  );
  it('accepts corrected positive overlap and rejects invalid schema without echoing authored values', () => {
    const p = project();
    const batch = proposalBatch(
      p,
      [
        { type: 'updateClip', clipId: 'b', patch: { startUs: 1000000 } },
        { type: 'addTransition', transition },
      ],
      'ok',
      Infinity,
    );
    expect(
      applyOperations(p, batch.operations).project.transitions,
    ).toHaveLength(1);
    try {
      proposalBatch(
        p,
        [
          {
            type: 'updateClip',
            clipId: 'a',
            patch: { durationUs: 'PRIVATE_SECRET' },
          },
        ],
        'invalid',
        Infinity,
      );
      throw new Error('accepted');
    } catch (error) {
      const safe = localError(error);
      expect(safe.details).toMatchObject({
        validation: {
          rule: 'schema',
          fieldPath: 'operations.0.patch.durationUs',
        },
      });
      expect(JSON.stringify(safe)).not.toContain('PRIVATE_SECRET');
    }
  });
  it.each([
    [{ fadeInUs: 3000000 }, 'fades_duration'],
    [
      {
        keyframes: {
          opacity: [
            { id: 'key', timeUs: 3000000, value: 1, interpolation: 'linear' },
          ],
        },
      },
      'keyframe_bounds',
    ],
  ] as const)(
    'reports clip location for duration constraints',
    (patch, rule) => {
      try {
        proposalBatch(
          project(),
          [{ type: 'updateClip', clipId: 'a', patch }],
          'bad',
          Infinity,
        );
        throw new Error('accepted');
      } catch (error) {
        expect(localError(error).details).toMatchObject({
          validation: { rule, trackIndex: 0, clipIndex: 0 },
        });
      }
    },
  );
  it.each(['validate_edits', 'propose_edits'])(
    'preserves safe schema feedback at the %s transport boundary',
    (name) => {
      try {
        parseTool(
          name,
          JSON.stringify({
            ...(name === 'propose_edits' ? { summary: 'Fix duration' } : {}),
            operations: [
              {
                type: 'updateClip',
                clipId: 'a',
                patch: { durationUs: 'PRIVATE_SECRET' },
              },
            ],
          }),
        );
        throw new Error('accepted');
      } catch (error) {
        const safe = localError(error);
        expect(safe.code).toBe('INVALID_TOOL_ARGUMENTS');
        expect(safe.details).toMatchObject({
          validation: {
            rule: 'schema',
            fieldPath: 'operations.0.patch.durationUs',
          },
        });
        expect(JSON.stringify(safe)).not.toContain('PRIVATE_SECRET');
      }
    },
  );
  it.each([
    [undefined, 'media_source_range'],
    [1000000, 'source_duration'],
  ] as const)('reports timed-media range failures', (sourceOutUs, rule) => {
    const p = project();
    p.tracks[0]!.clips[0] = clipSchema.parse({
      id: 'a',
      kind: 'video',
      assetId: 'asset',
      startUs: 0,
      durationUs: 2000000,
      sourceOutUs,
    });
    expect(() =>
      proposalBatch(
        p,
        [{ type: 'updateClip', clipId: 'a', patch: { opacity: 0.5 } }],
        'bad',
        Infinity,
      ),
    ).toThrow(
      expect.objectContaining({
        details: expect.objectContaining({
          validation: expect.objectContaining({
            rule,
            trackIndex: 0,
            clipIndex: 0,
          }),
        }),
      }),
    );
  });
  it('keeps unknown exceptions and untrusted diagnostic fields private', () => {
    expect(
      JSON.stringify(
        localError(
          new EditorError('INVALID_DOCUMENT', 'PRIVATE_SECRET', {
            validation: { rule: 'unknown', secret: 'PRIVATE_SECRET' },
          }),
        ),
      ),
    ).not.toContain('PRIVATE_SECRET');
    const safe = localError(
      new EditorError('INVALID_DOCUMENT', 'PRIVATE_SECRET', {
        validation: {
          rule: 'transition_overlap',
          transitionIndex: 1,
          trackIndex: -1,
          fieldPath: 'PRIVATE_SECRET',
          secret: 'PRIVATE_SECRET',
        },
      }),
    );
    expect(safe.details).toMatchObject({
      validation: { rule: 'transition_overlap', transitionIndex: 1 },
    });
    expect(JSON.stringify(safe)).not.toContain('PRIVATE_SECRET');
  });
});

it.each([
  ['text', 'video', 'text_style_required'],
  ['image', 'video', 'media_asset_required'],
  ['video', 'video', 'media_asset_required'],
  ['audio', 'video', 'media_asset_required'],
  ['image', 'audio', 'audio_track_clip'],
  ['video', 'overlay', 'overlay_track_clip'],
] as const)(
  'locates invalid %s clip structure on a %s track without exposing authored values',
  (kind, trackKind, rule) => {
    const p: Project = {
      ...project(),
      tracks: [
        { id: 'PRIVATE_TRACK', kind: trackKind, muted: false, clips: [] },
      ],
    };
    const before = structuredClone(p);
    const clip = clipSchema.parse({
      id: 'PRIVATE_CLIP',
      kind,
      startUs: 0,
      durationUs: 1000000,
      ...(trackKind !== 'video' ? { assetId: 'PRIVATE_ASSET' } : {}),
      ...(['video', 'audio'].includes(kind) ? { sourceOutUs: 1000000 } : {}),
    });
    try {
      proposalBatch(
        p,
        [{ type: 'insertClip', trackId: 'PRIVATE_TRACK', clip }],
        'invalid',
        Infinity,
      );
      expect.unreachable('Invalid clip structure must remain rejected');
    } catch (error) {
      const safe = localError(error);
      expect(safe.code).toBe('EDIT_REJECTED');
      expect(safe.details).toMatchObject({
        validation: {
          rule,
          trackIndex: 0,
          clipIndex: 0,
          repair: expect.any(String),
        },
      });
      expect(JSON.stringify(safe)).not.toContain('PRIVATE_');
    }
    expect(p).toEqual(before);
  },
);
