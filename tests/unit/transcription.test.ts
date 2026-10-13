import { describe, expect, it } from 'vitest';
import { transcriptionSegments } from '../../src/ai/transcription';
import { createOpenRouter } from '../../src/ai/openrouter';

describe('remote timestamp normalization', () => {
  it('sorts measured spans, discards instantaneous/empty entries and clips the last phrase to audio', () => {
    const response = {
      segments: [
        { text: ' Last phrase. ', start: 1, end: 2.6 },
        { text: '', start: 2, end: 2.6 },
        { text: 'Instantaneous token', start: 0.8, end: 0.8 },
        { text: ' First phrase. ', start: 0.1, end: 0.9 },
      ],
    };
    expect(transcriptionSegments(response, 2)).toEqual([
      { text: 'First phrase.', timestamp: [0.1, 0.9] },
      { text: 'Last phrase.', timestamp: [1, 2] },
    ]);
    expect(response.segments[0]?.end).toBe(2.6);
  });
  it('retains overlaps and stable equal-start ordering for the shared cue owner', () => {
    expect(
      transcriptionSegments(
        {
          segments: [
            { text: 'a', start: 0.1, end: 1.2 },
            { text: 'b', start: 0.1, end: 0.9 },
            { text: 'c', start: 1, end: 1.9 },
          ],
        },
        2,
      ).map((s) => s.text),
    ).toEqual(['a', 'b', 'c']);
    expect(transcriptionSegments({ segments: [] }, 2)).toEqual([]);
  });
  it.each([
    { text: 'private', start: -0.1, end: 1 },
    { text: 'private', start: 1, end: 0.5 },
    { text: 'private', start: '0', end: 1 },
    { text: 'private', start: NaN, end: 1 },
    { text: 'private', start: 0, end: Infinity },
    { text: 'private', start: 2, end: 2.5 },
    { text: 'private', start: 0.5, end: 0.5 },
    { text: '', start: 0, end: 1 },
    { text: 42, start: 0, end: 1 },
    null,
  ])(
    'rejects malformed or unusable timing without exposing transcript text: %j',
    (segment) => {
      try {
        transcriptionSegments({ segments: [segment] }, 2);
        expect.fail('Expected invalid timestamps');
      } catch (error) {
        expect(error).toMatchObject({ code: 'INVALID_RESPONSE' });
        expect((error as Error).message).not.toContain('private');
      }
    },
  );
  it('uses the same normalization through the configured OpenRouter transcription endpoint', async () => {
    let calls = 0;
    const client = createOpenRouter({
      fetch: async (_url, init) => {
        calls++;
        const body = init?.body as FormData;
        expect(body.get('response_format')).toBe('verbose_json');
        expect(body.get('timestamp_granularities[]')).toBe('segment');
        return Response.json({
          segments: [
            { text: 'last', start: 1, end: 2.6 },
            { text: 'first', start: 0.1, end: 0.9 },
          ],
        });
      },
    });
    client.setKey('synthetic-key');
    try {
      expect(
        await client.transcribeSpeech!(
          { model: 'openai/whisper-large-v3', audio: new Float32Array(32000) },
          new AbortController().signal,
        ),
      ).toEqual([
        { text: 'first', timestamp: [0.1, 0.9] },
        { text: 'last', timestamp: [1, 2] },
      ]);
      expect(calls).toBe(1);
    } finally {
      client.dispose();
    }
  });
});
