import { describe, expect, it, vi } from 'vitest';
import {
  createOpenRouter,
  OPENROUTER_LIMITS,
} from '../../src/ai/openrouter.ts';
import type {
  ChatRequest,
  OpenRouter,
  ProviderEvent,
} from '../../src/ai/types.ts';

const model = {
  id: 'vendor/tool-model',
  name: 'Tool model',
  context_length: 32000,
  supported_parameters: ['tools', 'tool_choice'],
  top_provider: { max_completion_tokens: 4000 },
  pricing: { prompt: '0.000001', completion: '0.000002' },
};
const request = (): ChatRequest => ({
  model: model.id,
  messages: [{ role: 'user', content: 'Shorten the clip.' }],
  tools: [
    {
      type: 'function',
      function: {
        name: 'read_project',
        description: 'Read project',
        parameters: { type: 'object', properties: {} },
      },
    },
  ],
  maxOutputTokens: 1000,
});
const completed =
  'data: {"choices":[{"index":0,"delta":{"content":"Done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
const streamResponse = () =>
  new Response(completed, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
function setup(next: () => Response | Promise<Response> = streamResponse) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
    String(input).endsWith('/models')
      ? Response.json({ data: [model] })
      : next(),
  );
  const client = createOpenRouter({ fetch });
  client.setKey('test-key-private');
  return { client, fetch };
}
async function collect(
  client: OpenRouter,
  value = request(),
  signal = new AbortController().signal,
) {
  const events: ProviderEvent[] = [];
  for await (const event of client.stream(value, signal)) events.push(event);
  return events;
}

describe('OpenRouter transport', () => {
  it('has no eager I/O and never reveals keys in status or serialized client', () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = createOpenRouter({ fetch });
    expect(fetch).not.toHaveBeenCalled();
    expect(client.status()).toEqual({ connected: false });
    client.setKey('  test-key-private  ');
    expect(client.status()).toEqual({ connected: true });
    expect(JSON.stringify(client)).not.toContain('private');
    client.disconnect();
    expect(client.status()).toEqual({ connected: false });
    client.dispose();
    client.dispose();
    expect(() => client.setKey('test-key-private')).toThrow(
      expect.objectContaining({ code: 'DISPOSED' }),
    );
  });
  it.each(['', 'short', 'test key', 'test\nkey', 'é'.repeat(20)])(
    'rejects malformed key %#',
    (key) => {
      const client = createOpenRouter();
      expect(() => client.setKey(key)).toThrow(
        expect.objectContaining({ code: 'AUTH_INVALID' }),
      );
    },
  );
  it('requires explicit authentication and model selection', async () => {
    const client = createOpenRouter();
    await expect(collect(client)).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
    const connected = setup().client;
    await expect(
      collect(connected, { ...request(), model: '' }),
    ).rejects.toMatchObject({ code: 'MODEL_REQUIRED' });
    await expect(
      collect(connected, { ...request(), model: 'openrouter/auto' }),
    ).rejects.toMatchObject({ code: 'MODEL_UNSUPPORTED' });
    await expect(
      collect(connected, { ...request(), model: '~auto' }),
    ).rejects.toMatchObject({ code: 'MODEL_UNSUPPORTED' });
  });
  it('verifies models and sends fixed private text-only API requests', async () => {
    const { client, fetch } = setup();
    expect(await collect(client)).toMatchObject([
      { type: 'text', text: 'Done' },
      { type: 'complete' },
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[1]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { Authorization: 'Bearer test-key-private' },
    });
    expect(JSON.parse(String(init!.body))).toMatchObject({
      model: model.id,
      messages: request().messages,
      stream: true,
      max_tokens: 1000,
      parallel_tool_calls: false,
      provider: { data_collection: 'deny', require_parameters: true },
    });
    await collect(client);
    expect(fetch).toHaveBeenCalledTimes(3); // One catalog snapshot until explicitly refreshed or disconnected.
  });
  it('supports explicit unauthenticated catalog reads and protects cached models from mutation', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ data: [model] }),
    );
    const client = createOpenRouter({ fetch });
    const models = await client.listModels();
    expect(fetch.mock.calls[0]![1]?.headers).toEqual({});
    expect(models[0]).toMatchObject({
      supportsTools: true,
      contextLength: 32000,
      maxCompletionTokens: 4000,
      pricing: model.pricing,
    });
    models[0]!.supportedParameters.length = 0;
    models[0]!.supportsTools = false;
    client.dispose();
  });
  it('rejects missing models, tool-incapable models, and excessive output tokens before generation', async () => {
    const { client, fetch } = setup();
    await expect(
      collect(client, { ...request(), model: 'vendor/missing' }),
    ).rejects.toMatchObject({ code: 'MODEL_UNSUPPORTED' });
    await expect(
      collect(client, { ...request(), maxOutputTokens: 5000 }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const noTools = createOpenRouter({
      fetch: async () =>
        Response.json({ data: [{ ...model, supported_parameters: [] }] }),
    });
    noTools.setKey('test-key-private');
    await expect(collect(noTools)).rejects.toMatchObject({
      code: 'MODEL_UNSUPPORTED',
    });
  });
  it.each([
    {},
    { data: [{}] },
    { data: [{ ...model, id: 'https://evil.test' }] },
    { data: [model, model] },
    { data: [{ ...model, context_length: -1 }] },
  ])('rejects malformed catalog %#', async (data) => {
    const client = createOpenRouter({ fetch: async () => Response.json(data) });
    await expect(client.listModels()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it.each([
    [401, 'AUTH_INVALID'],
    [403, 'AUTH_INVALID'],
    [402, 'INSUFFICIENT_CREDITS'],
    [429, 'RATE_LIMITED'],
    [500, 'PROVIDER_UNAVAILABLE'],
    [503, 'PROVIDER_UNAVAILABLE'],
    [400, 'INVALID_REQUEST'],
  ])('maps HTTP %s safely without leaking the body', async (status, code) => {
    const { client } = setup(
      () =>
        new Response('{"error":"test-key-private prompt SECRET"}', {
          status,
          headers: { 'retry-after': '7' },
        }),
    );
    try {
      await collect(client);
      throw new Error('expected error');
    } catch (error) {
      expect(error).toMatchObject({
        code,
        details: { status, retryAfterSeconds: 7 },
      });
      expect(JSON.stringify(error)).not.toMatch(/private|SECRET/);
    }
  });
  it('maps network errors safely, validates content type and rejects redirects', async () => {
    const { client } = setup(() => {
      throw new Error('test-key-private');
    });
    await expect(collect(client)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
    const wrongType = setup(() =>
      Response.json({ secret: 'test-key-private' }),
    ).client;
    await expect(collect(wrongType)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it('cancels pending fetch on disconnect and replacement keys', async () => {
    let requestSignal: AbortSignal | undefined;
    let notify!: () => void;
    const started = new Promise<void>((resolve) => {
      notify = resolve;
    });
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      requestSignal = init?.signal ?? undefined;
      notify();
      return new Promise(() => undefined);
    };
    const client = createOpenRouter({ fetch });
    client.setKey('test-key-private');
    const pending = collect(client);
    await started;
    client.setKey('replacement-key');
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(requestSignal?.aborted).toBe(true);
    expect(client.status()).toEqual({ connected: true });
  });
  it('bounds request duration even when fetch ignores cancellation', async () => {
    const client = createOpenRouter({
      requestTimeoutMs: 10,
      fetch: async () => new Promise(() => undefined),
    });
    await expect(client.listModels()).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    client.dispose();
  });
  it('cancels a response reader when the caller aborts or disposes', async () => {
    let cancelled = false;
    const { client } = setup(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
                ),
              );
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    const abort = new AbortController();
    const events = client.stream(request(), abort.signal);
    const iterator = events[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'text' },
    });
    const pending = iterator.next();
    abort.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(cancelled).toBe(true);
    const disposed = createOpenRouter({
      fetch: async () => new Promise(() => undefined),
    });
    const waiting = disposed.listModels();
    disposed.dispose();
    await expect(waiting).rejects.toMatchObject({ code: 'DISPOSED' });
  });
  it('rejects multimodal or extra properties before any network request', async () => {
    const { client, fetch } = setup();
    const malformed = {
      ...request(),
      messages: [
        { role: 'user', content: [{ type: 'image_url', image_url: 'secret' }] },
      ],
    } as unknown as ChatRequest;
    await expect(collect(client, malformed)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await expect(
      collect(client, {
        ...request(),
        messages: [{ role: 'user', content: 'hi', image: 'secret' }],
      } as unknown as ChatRequest),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects invalid limits and bounds requests', async () => {
    expect(() => createOpenRouter({ requestTimeoutMs: 0 })).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
    expect(() => createOpenRouter({ requestTimeoutMs: Infinity })).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
    const { client, fetch } = setup();
    await expect(
      collect(client, {
        ...request(),
        maxOutputTokens: OPENROUTER_LIMITS.maxOutputTokens + 1,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      collect(client, {
        ...request(),
        messages: [
          { role: 'user', content: 'x'.repeat(OPENROUTER_LIMITS.requestBytes) },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('binds model validation to the serialized request despite caller mutation during catalog load', async () => {
    let resolve!: (response: Response) => void;
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      calls.push(String(input));
      return new Promise((done) => {
        resolve = done;
      });
    };
    const client = createOpenRouter({ fetch });
    client.setKey('test-key-private');
    const value = request();
    value.model = 'vendor/missing';
    const pending = collect(client, value);
    value.model = model.id;
    resolve(Response.json({ data: [model] }));
    await expect(pending).rejects.toMatchObject({ code: 'MODEL_UNSUPPORTED' });
    expect(calls).toHaveLength(1);
  });
  it('times out a stalled stream and cancels its reader', async () => {
    let cancelled = false;
    const fetch: typeof globalThis.fetch = async (input) =>
      String(input).endsWith('/models')
        ? Response.json({ data: [model] })
        : new Response(
            new ReadableStream({
              cancel() {
                cancelled = true;
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          );
    const client = createOpenRouter({ fetch, requestTimeoutMs: 10 });
    client.setKey('test-key-private');
    await expect(collect(client)).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(cancelled).toBe(true);
  });
  it('cancels an unexpected non-stream response body', async () => {
    let cancelled = false;
    const { client } = setup(
      () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    await expect(collect(client)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(cancelled).toBe(true);
  });
  it('accepts explicit provider aliases returned by the live catalog without enabling automatic routing', async () => {
    // Minimal required fields from the public catalog on 2026-10-10. Alias IDs are
    // provider-supported identifiers, distinct from the openrouter/auto router.
    const alias = {
      id: '~deepseek/deepseek-pro-latest',
      name: 'DeepSeek: DeepSeek Pro Latest',
      context_length: 1048576,
      supported_parameters: ['max_tokens', 'tool_choice', 'tools'],
      top_provider: {
        context_length: 1048576,
        max_completion_tokens: 393216,
        is_moderated: false,
      },
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
      String(input).endsWith('/models')
        ? Response.json({
            data: [alias, { ...model, id: 'vendor/model:free' }],
          })
        : streamResponse(),
    );
    const client = createOpenRouter({ fetch });
    client.setKey('test-key-private');
    const models = await client.listModels();
    expect(models.map((item) => item.id)).toEqual([
      alias.id,
      'vendor/model:free',
    ]);
    expect(models[0]).toMatchObject({
      supportsTools: true,
      maxCompletionTokens: 393216,
    });
    await expect(
      collect(client, { ...request(), model: alias.id }),
    ).resolves.toMatchObject([{ type: 'text' }, { type: 'complete' }]);
    expect(JSON.parse(String(fetch.mock.calls[1]![1]?.body)).model).toBe(
      alias.id,
    );
  });
});
