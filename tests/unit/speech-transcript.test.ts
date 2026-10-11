import { describe, expect, it } from 'vitest';
import {
  retimeSpeechTranscript,
  padSpeechTranscript,
} from '../../src/core/transcript-timing';
import {
  transcriptSchema,
  validateSpeechTranscriptTiming,
} from '../../src/core/model';
import { transcriptContext } from '../../src/ai/context';

const timing = {
  model: 'whisper',
  revision: 'pinned',
  cues: [
    { id: 'first', timeUs: 250_000, endUs: 900_000, text: 'First phrase.' },
    { id: 'second', timeUs: 1_400_000, endUs: 2_000_000, text: 'Last phrase.' },
  ],
};
describe('generated speech timing', () => {
  it('preserves measured pauses, IDs and provenance through local timing changes', () => {
    const scaled = retimeSpeechTranscript(timing, 2_000_000, 1_000_000);
    expect(scaled.cues).toEqual([
      { id: 'first', timeUs: 125_000, endUs: 450_000, text: 'First phrase.' },
      { id: 'second', timeUs: 700_000, endUs: 1_000_000, text: 'Last phrase.' },
    ]);
    expect(scaled.model).toBe('whisper');
    expect(timing.cues[0]?.timeUs).toBe(250_000);
  });
  it.each([
    { ...timing.cues[0]!, timeUs: -1 },
    { ...timing.cues[0]!, endUs: 2_000_001 },
    { ...timing.cues[0]!, timeUs: 0.5 },
    { ...timing.cues[0]!, endUs: 100 },
  ])('rejects invalid source boundaries before retiming', (cue) => {
    expect(() =>
      retimeSpeechTranscript({ ...timing, cues: [cue] }, 2_000_000, 1_000_000),
    ).toThrow('Invalid measured speech timing');
  });
  it('rejects duplicate identities and unordered phrases', () => {
    for (const cues of [
      [timing.cues[0]!, timing.cues[0]!],
      [...timing.cues].reverse(),
    ])
      expect(() =>
        retimeSpeechTranscript({ ...timing, cues }, 2_000_000, 1_000_000),
      ).toThrow('Invalid measured speech timing');
  });
  it('adds bounded padding, shares close boundaries, and resolves provider overlaps', () => {
    for (const pair of [
      [900_000, 1_000_000],
      [1_200_000, 1_000_000],
      [900_000, 900_000],
    ]) {
      const source = {
        ...timing,
        cues: [
          { ...timing.cues[0]!, endUs: pair[0]! },
          { ...timing.cues[1]!, timeUs: pair[1]! },
        ],
      };
      const padded = padSpeechTranscript(source, 2_000_000);
      expect(padded.cues).toHaveLength(2);
      expect(padded.cues[0]!.timeUs).toBe(170_000);
      expect(padded.cues[0]!.endUs).toBe(padded.cues[1]!.timeUs);
      expect(padded.cues[1]!.endUs).toBe(2_000_000);
      expect(source.cues[0]!.endUs).toBe(pair[0]);
    }
    const value = {
      ...timing,
      id: 't',
      assetId: 'a',
      speech: {
        script: 'First phrase. Last phrase.',
        model: 'tts',
        voice: 'voice',
        languages: [],
        originalDurationUs: 2_000_000,
        measuredCues: timing.cues,
        paddingUs: 80_000,
      },
    };
    expect(() =>
      validateSpeechTranscriptTiming(
        {
          ...value,
          cues: [{ ...timing.cues[0]!, endUs: 1_500_000 }, timing.cues[1]!],
        },
        2_000_000,
      ),
    ).toThrow('ranges overlap');
    expect(() => validateSpeechTranscriptTiming(value, 1_000_000)).toThrow(
      'Invalid measured speech timing',
    );
  });
  it('keeps generation metadata private until transcript sharing is enabled', () => {
    const value = transcriptSchema.parse({
      ...timing,
      id: 'transcript',
      assetId: 'asset',
      speech: {
        script: 'Original authored script.',
        model: 'tts-model',
        voice: 'favorite',
        languages: ['English'],
        originalDurationUs: 2_000_000,
        measuredCues: timing.cues,
        paddingUs: 80_000,
      },
    });
    expect(() => transcriptContext(value, {})).toThrow('Transcript sharing');
    const shared = transcriptContext(value, { includeTranscripts: true });
    expect(shared.speech?.script).toBe('Original authored script.');
    shared.cues[0]!.text = 'changed';
    expect(value.cues[0]!.text).toBe('First phrase.');
    expect(
      transcriptSchema.parse({ ...timing, id: 'old', assetId: 'asset' }).speech,
    ).toBeUndefined();
    expect(
      transcriptSchema.safeParse({
        ...value,
        speech: { ...value.speech, reference: 'private bytes' },
      }).success,
    ).toBe(false);
  });
});
