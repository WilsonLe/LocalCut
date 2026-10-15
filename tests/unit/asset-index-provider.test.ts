import { describe, expect, it, vi } from 'vitest';
import { createOpenRouter } from '../../src/ai/openrouter';
const model = 'test/indexing';
const signal = () => new AbortController().signal;
function client(
  modalities = ['text', 'image', 'video', 'audio'],
  reply = '{"summary":"ok"}',
  stream?: string,
  parameters = ['tools', 'tool_choice'],
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
              supported_parameters: parameters,
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
  it.each([
    ['structured_outputs', 'json_schema'],
    ['response_format', 'json_object'],
    ['tools', undefined],
  ])(
    'declares bounded scene and summary contracts for %s routes',
    async (parameter, type) => {
      const { provider, bodies } = client(undefined, undefined, undefined, [
        'tools',
        'tool_choice',
        parameter,
      ]);
      try {
        for (const sceneId of ['scene-7', undefined]) {
          await provider.label(
            {
              model,
              prompt: 'Label evidence',
              sceneId,
              media: [],
              consent: true,
              maxOutputTokens: 2048,
            },
            signal(),
          );
          const body = bodies.at(-1)!;
          const system = (body.messages as { content: string }[])[0]!.content;
          const schema = JSON.parse(system.slice(system.indexOf('{')));
          const fields = sceneId ? schema.properties.label : schema;
          expect(fields).toMatchObject({
            additionalProperties: false,
            required: [
              'summary',
              'subjects',
              'scene',
              'style',
              'tags',
              'sound',
            ],
            properties: {
              summary: { type: 'string', minLength: 1, maxLength: 2000 },
              subjects: {
                type: 'array',
                maxItems: 32,
                items: { type: 'string', maxLength: 100 },
              },
              scene: { type: 'string', maxLength: 300 },
              style: { type: 'string', maxLength: 300 },
              tags: { type: 'array', maxItems: 32, items: { maxLength: 100 } },
              sound: { type: 'string', maxLength: 500 },
            },
          });
          if (sceneId)
            expect(schema.properties.sceneId).toMatchObject({
              enum: [sceneId],
            });
          else expect(schema.properties).not.toHaveProperty('sceneId');
          if (type === 'json_schema') {
            expect(body.response_format).toMatchObject({
              type,
              json_schema: { name: 'asset_labels', strict: true },
            });
            const wire = (
              body.response_format as { json_schema: { schema: typeof schema } }
            ).json_schema.schema;
            expect(JSON.stringify(wire)).not.toMatch(
              /"(?:minLength|maxLength|maxItems|const)":/,
            );
            const wireLabel = sceneId ? wire.properties.label : wire;
            expect(wireLabel).toMatchObject({
              type: 'object',
              additionalProperties: false,
              required: fields.required,
              properties: {
                summary: {
                  type: 'string',
                  description:
                    'Local validation limits: {"minLength":1,"maxLength":2000}',
                },
                subjects: {
                  type: 'array',
                  description: 'Local validation limits: {"maxItems":32}',
                  items: {
                    type: 'string',
                    description: 'Local validation limits: {"maxLength":100}',
                  },
                },
                style: {
                  type: 'string',
                  description: 'Local validation limits: {"maxLength":300}',
                },
              },
            });
            if (sceneId)
              expect(wire.properties.sceneId).toEqual({
                type: 'string',
                enum: [sceneId],
              });
          } else if (type) expect(body.response_format).toEqual({ type });
          else expect(body).not.toHaveProperty('response_format');
          expect(body).not.toHaveProperty('tools');
          expect(body).toMatchObject({
            model,
            provider: { allow_fallbacks: false },
          });
        }
        expect(bodies).toHaveLength(2);
      } finally {
        provider.dispose();
      }
    },
  );
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
          sessionId: 'index-run-1',
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
        provider: {
          data_collection: 'deny',
          require_parameters: true,
          allow_fallbacks: false,
        },
        session_id: 'index-run-1',
      });
      await provider.label(
        {
          model,
          prompt: 'Summarize indexed scenes',
          sessionId: 'index-run-1',
          media: [],
          consent: true,
          maxOutputTokens: 100,
        },
        signal(),
      );
      expect(bodies[1]).toMatchObject({
        session_id: 'index-run-1',
        provider: bodies[0]!.provider,
      });
      expect(bodies[0]!.provider).not.toHaveProperty('order');
      expect(bodies[0]!.provider).not.toHaveProperty('only');
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
