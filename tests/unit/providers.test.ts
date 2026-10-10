import { describe, expect, it, vi } from 'vitest';
import {
  createOpenAICompatible,
  createServiceRouter,
} from '../../src/ai/providers';
import { AiError } from '../../src/ai/errors';
import type {
  ChatRequest,
  OpenRouter,
  ProviderEvent,
  SpeechRequest,
} from '../../src/ai/types';
import {
  defaultProviderConfiguration,
  parseProviderConfiguration,
} from '../../src/workspace/provider-preferences';
import { parseResponses, responsesBody } from '../../src/ai/responses';
const signal = () => new AbortController().signal;
const chat: ChatRequest = {
  model: 'primary-model',
  messages: [{ role: 'user', content: 'Hello' }],
  tools: [],
  maxOutputTokens: 100,
};
const complete: ProviderEvent = {
  type: 'complete',
  message: { role: 'assistant', content: 'Hello' },
};
async function collect(stream: AsyncIterable<ProviderEvent>) {
  const events = [];
  for await (const e of stream) events.push(e);
  return events;
}
function client(stream: OpenRouter['stream']): OpenRouter {
  return {
    ...createOpenAICompatible({
      baseUrl: 'https://example.test/v1',
      model: 'm',
    }),
    status: () => ({ connected: true }),
    stream,
  };
}
function routed(a: OpenRouter, b: OpenRouter) {
  return createServiceRouter(
    [
      { id: 'a', name: 'A', client: a },
      { id: 'b', name: 'B', client: b },
    ],
    {
      llm: [
        { providerId: 'a', model: 'primary-model' },
        { providerId: 'b', model: 'backup-model' },
      ],
      tts: [
        { providerId: 'b', model: 'speech', voice: 'voice' },
        { providerId: 'a', model: 'backup-speech', voice: 'backup-voice' },
      ],
      stt: [{ providerId: 'local', model: 'whisper' }],
    },
  );
}
describe('service providers', () => {
  it('sends bounded compatible requests to only the explicit endpoint without OpenRouter extensions or key headers for local servers', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          'data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
    );
    const p = createOpenAICompatible(
      { baseUrl: 'http://localhost:1234/v1/', model: 'primary-model' },
      { fetch },
    );
    expect(fetch).not.toHaveBeenCalled();
    p.setKey('');
    expect(await p.listModels()).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
    await collect(p.stream(chat, signal()));
    expect(fetch.mock.calls[0]![0]).toBe(
      'http://localhost:1234/v1/chat/completions',
    );
    expect(
      JSON.parse(String(fetch.mock.calls[0]![1]!.body)),
    ).not.toHaveProperty('provider');
    expect(fetch.mock.calls[0]![1]!.headers).not.toHaveProperty(
      'Authorization',
    );
    p.dispose();
  });
  it.each([
    'http://example.test/v1',
    'https://secret@example.test/v1',
    'https://example.test/v1?key=secret',
    'https://example.test/v1#secret',
  ])('rejects unsafe endpoints %s', (baseUrl) => {
    expect(() => createOpenAICompatible({ baseUrl })).toThrow(AiError);
  });
  it('falls back in configured LLM order with the backup model and no provider reasoning signatures', async () => {
    const first = vi.fn(async function* () {
      yield* [];
      throw new AiError('RATE_LIMITED', 'limited');
    });
    const backup = vi.fn(async function* (r: ChatRequest) {
      expect(r.model).toBe('backup-model');
      expect(r.messages[0]).not.toHaveProperty('reasoning_details');
      yield complete;
    });
    const router = routed(client(first), client(backup));
    expect(
      await collect(
        router.stream(
          {
            ...chat,
            messages: [
              {
                role: 'assistant',
                content: 'Earlier',
                reasoning_details: [
                  { type: 'reasoning.encrypted', data: 'provider-only' },
                ],
              },
            ],
          },
          signal(),
        ),
      ),
    ).toEqual([complete]);
    expect(first).toHaveBeenCalledTimes(1);
    expect(backup).toHaveBeenCalledTimes(1);
    router.dispose();
  });
  it('never retries after partial output or on refusal, cancellation or invalid requests', async () => {
    for (const code of [
      'NETWORK_ERROR',
      'PROVIDER_REFUSAL',
      'CANCELLED',
      'INVALID_REQUEST',
    ] as const) {
      const backup = vi.fn(async function* () {
        yield complete;
      });
      const first = client(async function* () {
        if (code === 'NETWORK_ERROR') yield { type: 'text', text: 'partial' };
        throw new AiError(code, 'failed');
      });
      const router = routed(first, client(backup));
      await expect(
        collect(router.stream(chat, signal())),
      ).rejects.toMatchObject({ code });
      expect(backup).not.toHaveBeenCalled();
      router.dispose();
    }
  });
  it('retirement cancels work and cannot initiate a fallback', async () => {
    let entered!: () => void;
    const barrier = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const backup = vi.fn(async function* () {
      yield complete;
    });
    const first = client(async function* (_, s) {
      yield* [];
      entered();
      await new Promise<void>((resolve) =>
        s.addEventListener('abort', () => resolve(), { once: true }),
      );
      throw new AiError('NETWORK_ERROR', 'ended');
    });
    const router = routed(first, client(backup));
    const pending = collect(router.stream(chat, signal()));
    await barrier;
    router.dispose();
    await expect(pending).rejects.toThrow();
    expect(backup).not.toHaveBeenCalled();
  });
  it('TTS uses its own order and the explicitly configured backup model/voice', async () => {
    const a = client(async function* () {
      yield complete;
    });
    const b = client(async function* () {
      yield complete;
    });
    b.synthesizeSpeech = vi.fn(async () => {
      throw new AiError('PROVIDER_UNAVAILABLE', 'unavailable');
    });
    a.synthesizeSpeech = vi.fn(async (r: SpeechRequest) => {
      expect(r.model).toBe('backup-speech');
      expect(r.voice).toBe('backup-voice');
      return { samples: new Float32Array([0]), sampleRate: 24000 as const };
    });
    const router = routed(a, b);
    await router.synthesizeSpeech(
      { model: 'speech', voice: 'voice', script: 'Hi', languages: ['English'] },
      signal(),
    );
    expect(b.synthesizeSpeech).toHaveBeenCalledTimes(1);
    expect(a.synthesizeSpeech).toHaveBeenCalledTimes(1);
  });
  it('portable routing configuration strips credentials and validates endpoint and service capabilities', () => {
    const c = defaultProviderConfiguration();
    c.profiles.push({
      id: 'custom',
      name: 'Custom',
      kind: 'compatible',
      baseUrl: 'https://example.test/v1',
      model: 'm',
    });
    c.routes.llm.push({ providerId: 'custom', model: 'm' });
    const raw = JSON.stringify({
      ...c,
      accessToken: 'secret',
      profiles: c.profiles.map((p) => ({
        ...p,
        apiKey: 'secret',
        callback: 'http://localhost?code=secret',
      })),
    });
    expect(JSON.stringify(parseProviderConfiguration(raw))).not.toContain(
      'secret',
    );
    expect(parseProviderConfiguration(raw).routes.llm).toHaveLength(2);
    c.routes.tts.push({ providerId: 'custom', model: 'm' });
    expect(parseProviderConfiguration(JSON.stringify(c))).toEqual(
      defaultProviderConfiguration(),
    );
  });
});
describe('Responses protocol', () => {
  const response = (events: unknown[]) =>
    new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  it('maps tools/history and only publishes function calls after completed terminal validation', async () => {
    const body = JSON.parse(
      responsesBody({
        ...chat,
        messages: [
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call1',
                type: 'function',
                function: { name: 'inspect', arguments: '{}' },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'call1', content: '{}' },
        ],
      }),
    );
    expect(body.store).toBe(false);
    expect(body.input[1]).toMatchObject({
      type: 'function_call_output',
      call_id: 'call1',
    });
    const output = await collect(
      parseResponses(
        response([
          { type: 'response.output_text.delta', delta: 'ok' },
          {
            type: 'response.completed',
            response: {
              status: 'completed',
              output: [
                {
                  type: 'function_call',
                  call_id: 'c1',
                  name: 'inspect',
                  arguments: '{}',
                },
              ],
              usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
            },
          },
        ]),
        signal(),
      ),
    );
    expect(output[1]).toMatchObject({
      type: 'complete',
      message: { tool_calls: [{ id: 'c1' }] },
    });
  });
  it('rejects failed/truncated/duplicate terminal frames and malformed calls', async () => {
    const terminal = {
      type: 'response.completed',
      response: { status: 'completed', output: [] },
    };
    for (const events of [
      [{ type: 'response.output_text.delta', delta: 'partial' }],
      [{ type: 'response.failed' }],
      [terminal, terminal],
      [
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            output: [
              {
                type: 'function_call',
                call_id: 'c1',
                name: 'inspect',
                arguments: 1,
              },
            ],
          },
        },
      ],
    ])
      await expect(
        collect(parseResponses(response(events), signal())),
      ).rejects.toThrow(AiError);
  });
});
