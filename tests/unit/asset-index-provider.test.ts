import { describe, expect, it, vi } from 'vitest';
import { createOpenRouter } from '../../src/ai/openrouter';
const model = 'test/indexing';
const signal = () => new AbortController().signal;
function client(
  modalities = ['text', 'image', 'video', 'audio'],
  reply = '{"summary":"ok"}',
  stream?: string,
) {
  const bodies: Record<string, unknown>[] = [];
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).endsWith('/models'))
      return new Response(
        JSON.stringify({
          data: [
            {
              id: model,
              name: 'Index model',
              context_length: 32000,
              supported_parameters: ['tools', 'tool_choice'],
              architecture: { input_modalities: modalities },
            },
          ],
        }),
      );
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(
      stream ??
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: reply }, finish_reason: 'stop' }], model })}\n\ndata: [DONE]\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  });
  const provider = createOpenRouter({ fetch: fetcher as typeof fetch });
  provider.setKey('synthetic-index-key');
  return { provider, bodies, fetcher };
}
describe('dedicated indexing transport', () => {
  it('rejects incomplete streams and tool calls before publication', async () => {
    for (const stream of [
      'data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call","type":"function","function":{"name":"apply","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
    ]) {
      const { provider } = client(['text', 'image'], '', stream);
      try {
        await expect(
          provider.label(
            {
              model,
              prompt: 'Label',
              media: [],
              consent: true,
              maxOutputTokens: 100,
            },
            signal(),
          ),
        ).rejects.toHaveProperty('code');
      } finally {
        provider.dispose();
      }
    }
  });
  it('sends only data-URL evidence with selected model and denies provider collection', async () => {
    const { provider, bodies } = client();
    try {
      expect((await provider.listModels())[0]?.inputModalities).toEqual([
        'text',
        'image',
        'video',
        'audio',
      ]);
      await provider.label(
        {
          model,
          prompt: 'Label scene',
          media: [
            { type: 'image/jpeg', data: 'YWJj' },
            { type: 'video/mp4', data: 'YWJj' },
          ],
          consent: true,
          maxOutputTokens: 100,
        },
        signal(),
      );
      expect(bodies[0]).toMatchObject({
        model,
        provider: { data_collection: 'deny', require_parameters: true },
      });
      expect(bodies[0]).not.toHaveProperty('tools');
      expect(JSON.stringify(bodies)).not.toContain('synthetic-index-key');
      expect(JSON.stringify(bodies)).toContain('data:video/mp4;base64,YWJj');
    } finally {
      provider.dispose();
    }
  });
  it('fails before paid traffic for unsupported modalities and oversized evidence', async () => {
    const { provider, bodies } = client(['text']);
    try {
      await expect(
        provider.label(
          {
            model,
            prompt: 'Label',
            media: [{ type: 'image/jpeg', data: 'YWJj' }],
            consent: true,
            maxOutputTokens: 100,
          },
          signal(),
        ),
      ).rejects.toMatchObject({ code: 'MODEL_UNSUPPORTED' });
      expect(bodies).toEqual([]);
    } finally {
      provider.dispose();
    }
    const next = client();
    try {
      await expect(
        next.provider.label(
          {
            model,
            prompt: 'Label',
            media: [{ type: 'video/mp4', data: 'A'.repeat(2200000) }],
            consent: true,
            maxOutputTokens: 100,
          },
          signal(),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      expect(next.bodies).toEqual([]);
    } finally {
      next.provider.dispose();
    }
  });
  it('sends WAV evidence using the required audio modality without tool execution', async () => {
    const { provider, bodies } = client(['text', 'audio']);
    try {
      await provider.label(
        {
          model,
          prompt: 'Describe audio',
          media: [{ type: 'audio/wav', data: 'YWJj' }],
          consent: true,
          maxOutputTokens: 100,
        },
        signal(),
      );
      expect(bodies[0]).toMatchObject({
        messages: [
          { role: 'system' },
          {
            role: 'user',
            content: [
              { type: 'text' },
              {
                type: 'input_audio',
                input_audio: { data: 'YWJj', format: 'wav' },
              },
            ],
          },
        ],
      });
      expect(bodies[0]).not.toHaveProperty('tools');
    } finally {
      provider.dispose();
    }
  });
  it('rejects arbitrary evidence URLs', async () => {
    const { provider, bodies } = client();
    try {
      await expect(
        provider.label(
          {
            model,
            prompt: 'Label',
            media: [
              { type: 'image/jpeg', data: 'https://private.example/image' },
            ],
            consent: true,
            maxOutputTokens: 100,
          },
          signal(),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      expect(bodies).toEqual([]);
    } finally {
      provider.dispose();
    }
  });
});
