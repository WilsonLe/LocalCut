import { expect, test } from '@playwright/test';
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'POST,GET,OPTIONS',
};
for (const base of ['/', '/LocalCut/']) {
  test(`native audio extraction routes OpenRouter STT and persists exact source cues ${base}`, async ({
    page,
    context,
  }) => {
    const requests: string[] = [];
    await context.route(
      'https://openrouter.ai/api/v1/audio/transcriptions',
      (route) => {
        requests.push('openrouter');
        const body = route.request().postDataBuffer()!;
        expect(body.toString()).toContain('verbose_json');
        expect(body.toString()).toContain('audio.wav');
        expect(body.toString()).toContain('whisper-1');
        expect(body.byteLength).toBeGreaterThan(21000);
        return route.fulfill({
          headers: { ...cors, 'content-type': 'application/json' },
          body: JSON.stringify({
            segments: [
              { text: 'Hello', start: 0, end: 0.2 },
              { text: 'world', start: 0.25, end: 0.65 },
            ],
          }),
        });
      },
    );
    await page.goto(base);
    const result = await page.evaluate(async (path) => {
      const api = (await import(
        path + 'editor.js'
      )) as typeof import('../../src/editor');
      const ai = (await import(
        path + 'ai.js'
      )) as typeof import('../../src/ai');
      if ('createChatGPT' in ai || 'createOpenAICompatible' in ai)
        throw new Error('Removed provider factory remains public.');
      const namespace = 'test-' + crypto.randomUUID();
      let editor = await api.createEditor({ namespace });
      const data = new ArrayBuffer(44 + 96000),
        view = new DataView(data);
      const ascii = (offset: number, s: string) => {
        for (let i = 0; i < s.length; i++)
          view.setUint8(offset + i, s.charCodeAt(i));
      };
      ascii(0, 'RIFF');
      view.setUint32(4, data.byteLength - 8, true);
      ascii(8, 'WAVE');
      ascii(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, 48000, true);
      view.setUint32(28, 96000, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      ascii(36, 'data');
      view.setUint32(40, 96000, true);
      for (let i = 0; i < 48000; i++)
        view.setInt16(
          44 + i * 2,
          Math.sin((i * 2 * Math.PI * 440) / 48000) * 16000,
          true,
        );
      const asset = await editor.assets.import(
        new File([data], 'source.wav', { type: 'audio/wav' }),
      ).completion;
      const provider = ai.createOpenRouter();
      provider.setKey('synthetic');
      const router = ai.createServiceRouter(
        [{ id: 'openrouter', name: 'OpenRouter', client: provider }],
        {
          llm: [],
          tts: [],
          stt: [{ providerId: 'openrouter', model: 'openai/whisper-1' }],
        },
      );
      try {
        const transcript = await editor.transcription.transcribe(asset.id, {
          startUs: 120003,
          endUs: 800007,
          language: 'en',
          provider: router.transcribe,
        }).completion;
        await editor.dispose();
        editor = await api.createEditor({ namespace });
        const saved = await editor.transcription.transcript(transcript.id);
        if (!saved) throw new Error('Transcript did not survive reload.');
        const rejected = await editor.transcription
          .transcribe(asset.id, {
            startUs: 120003,
            endUs: 800007,
            provider: async () => ({
              ...saved,
              id: crypto.randomUUID(),
              assetId: 'foreign',
            }),
          })
          .completion.then(
            () => '',
            (e: { code: string }) => e.code,
          );
        return {
          cues: saved.cues.map(({ timeUs, endUs, text }) => ({
            timeUs,
            endUs,
            text,
          })),
          model: saved.model,
          revision: saved.revision,
          rejected,
        };
      } finally {
        router.dispose();
        provider.dispose();
        await editor.dispose();
      }
    }, base);
    expect(requests).toEqual(['openrouter']);
    expect(result).toEqual({
      cues: [
        { timeUs: 120003, endUs: 320003, text: 'Hello' },
        { timeUs: 370003, endUs: 770003, text: 'world' },
      ],
      model: 'openai/whisper-1',
      revision: 'provider:openrouter',
      rejected: 'INVALID_DOCUMENT',
    });
  });
}
