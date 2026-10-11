import {
  accountStorage,
  accountCredentialKey,
} from '../../src/workspace/provider-account-storage';
import { createOpenRouter } from '../../src/ai/openrouter';
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
  it('caps a reasoning request to the actual configured fallback model completion limit', async () => {
    const model = (id: string, max: number) => ({
      id,
      name: id,
      context_length: 300000,
      supported_parameters: ['tools', 'tool_choice', 'reasoning'],
      top_provider: { max_completion_tokens: max },
    });
    const primaryFetch = vi.fn<typeof globalThis.fetch>(async (url) =>
      String(url).endsWith('/models')
        ? Response.json({ data: [model('primary-model', 32768)] })
        : new Response(null, { status: 429 }),
    );
    const backupFetch = vi.fn<typeof globalThis.fetch>(async (url) =>
      String(url).endsWith('/models')
        ? Response.json({ data: [model('backup-model', 8192)] })
        : new Response(
            'data: {"choices":[{"index":0,"delta":{"content":"Backup completed"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
            { headers: { 'Content-Type': 'text/event-stream' } },
          ),
    );
    const a = createOpenRouter({ fetch: primaryFetch });
    const b = createOpenRouter({ fetch: backupFetch });
    a.setKey('synthetic-primary');
    b.setKey('synthetic-backup');
    const router = routed(a, b);
    try {
      const events = await collect(
        router.stream({ ...chat, maxOutputTokens: 16384 }, signal()),
      );
      expect(events.at(-1)).toMatchObject({
        type: 'complete',
        message: { content: 'Backup completed' },
      });
      const primary = primaryFetch.mock.calls.find(([url]) =>
        String(url).endsWith('/chat/completions'),
      )!;
      const backup = backupFetch.mock.calls.find(([url]) =>
        String(url).endsWith('/chat/completions'),
      )!;
      expect(JSON.parse(String(primary[1]?.body)).max_tokens).toBe(16384);
      expect(JSON.parse(String(backup[1]?.body)).max_tokens).toBe(8192);
      expect(
        backupFetch.mock.calls.filter(([url]) =>
          String(url).endsWith('/chat/completions'),
        ),
      ).toHaveLength(1);
    } finally {
      router.dispose();
      a.dispose();
      b.dispose();
    }
  });

  it('verifies independently stored OpenRouter keys without inference and disconnects only one account', async () => {
    const records = new Map<string, string>();
    const storage = {
      getItem: (key: string) => records.get(key) ?? null,
      setItem: (key: string, value: string) => {
        records.set(key, value);
      },
      removeItem: (key: string) => {
        records.delete(key);
      },
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ data: { is_free_tier: true } }),
    );
    const profileA = { id: 'openrouter', kind: 'openrouter' as const };
    const profileB = { id: 'openrouter-work', kind: 'openrouter' as const };
    const a = createOpenRouter({
      fetch,
      credentialStorage: () => accountStorage(profileA, () => storage),
    });
    const b = createOpenRouter({
      fetch,
      credentialStorage: () => accountStorage(profileB, () => storage),
    });
    a.setKey('synthetic-account-a');
    b.setKey('synthetic-account-b');
    await expect(a.verifyConnection!()).resolves.toBe('credentials');
    await expect(b.verifyConnection!()).resolves.toBe('credentials');
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      'https://openrouter.ai/api/v1/key',
      'https://openrouter.ai/api/v1/key',
    ]);
    expect(fetch.mock.calls.map((call) => call[1]?.headers)).toEqual([
      { Authorization: 'Bearer synthetic-account-a' },
      { Authorization: 'Bearer synthetic-account-b' },
    ]);
    a.disconnect();
    expect(records.has(accountCredentialKey(profileA))).toBe(false);
    expect(records.has(accountCredentialKey(profileB))).toBe(true);
    expect(b.status().connected).toBe(true);
    const restored = createOpenRouter({
      credentialStorage: () => accountStorage(profileB, () => storage),
    });
    expect(restored.restoreCredential().connected).toBe(true);
    a.dispose();
    b.dispose();
    restored.dispose();
  });
  it('does not expose provider bodies or claim successful verification for rejected credentials', async () => {
    const p = createOpenRouter({
      fetch: async () =>
        new Response('secret echoed by provider', { status: 401 }),
    });
    p.setKey('synthetic-account');
    await expect(p.verifyConnection!()).rejects.toMatchObject({
      code: 'AUTH_INVALID',
    });
    await expect(p.verifyConnection!()).rejects.not.toThrow(
      'secret echoed by provider',
    );
    p.dispose();
  });

  it('uses service route models without a duplicate compatible connection model and refreshes model identity', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          'data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
    );
    const p = createOpenAICompatible(
      { baseUrl: 'http://localhost:1234/v1' },
      { fetch },
    );
    p.setKey('');
    const c = defaultProviderConfiguration();
    c.profiles.push({
      id: 'custom',
      kind: 'compatible',
      name: 'Custom',
      baseUrl: 'http://localhost:1234/v1',
    });
    c.routes.llm = [{ providerId: 'custom', model: '' }];
    expect(parseProviderConfiguration(JSON.stringify(c))).toEqual(c);
    expect(await p.listModels()).toEqual([]);
    c.routes.llm[0]!.model = 'first-model';
    const router = createServiceRouter(
      [{ id: 'custom', name: 'Custom', client: p }],
      c.routes,
    );
    expect((await router.listModels())[0]?.id).toBe('first-model');
    expect(fetch).not.toHaveBeenCalled();
    await collect(router.stream({ ...chat, model: 'first-model' }, signal()));
    router.dispose();
    const next = createServiceRouter(
      [{ id: 'custom', name: 'Custom', client: p }],
      {
        ...c.routes,
        llm: [{ providerId: 'custom', model: 'second-model' }],
      },
    );
    expect((await next.listModels())[0]?.id).toBe('second-model');
    await collect(next.stream({ ...chat, model: 'second-model' }, signal()));
    expect(
      fetch.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).model),
    ).toEqual(['first-model', 'second-model']);
    await expect(
      p.listModels(signal(), 'https://invalid.test'),
    ).rejects.toHaveProperty('code', 'INVALID_REQUEST');
    next.dispose();
    p.dispose();
  });

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
  it('never shares a saved reference with fallback speech providers', async () => {
    const a = client(async function* () {
      yield complete;
    });
    const b = client(async function* () {
      yield complete;
    });
    b.synthesizeSpeech = vi.fn(async () => {
      throw new AiError('PROVIDER_UNAVAILABLE', 'unavailable');
    });
    a.synthesizeSpeech = vi.fn();
    const router = routed(a, b);
    await expect(
      router.synthesizeSpeech(
        {
          model: 'fish-audio/s2.1-pro',
          voice: 'reference',
          script: 'New script',
          languages: ['English'],
          reference: { data: 'synthetic', transcript: 'Original' },
        },
        signal(),
      ),
    ).rejects.toHaveProperty('code', 'PROVIDER_UNAVAILABLE');
    expect(b.synthesizeSpeech).toHaveBeenCalledTimes(1);
    expect(a.synthesizeSpeech).not.toHaveBeenCalled();
    router.dispose();
  });
  it('keeps removed OpenRouter absent and accepts its explicit timestamped STT route', () => {
    const c = defaultProviderConfiguration();
    c.profiles = [];
    c.routes.llm = [];
    c.routes.tts = [];
    expect(parseProviderConfiguration(JSON.stringify(c))).toEqual(c);
    c.profiles.push({
      id: 'openrouter',
      kind: 'openrouter',
      name: 'OpenRouter',
    });
    c.routes.stt.push({ providerId: 'openrouter', model: 'openai/whisper-1' });
    expect(parseProviderConfiguration(JSON.stringify(c))).toEqual(c);
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

describe('ordered transcription routes', () => {
  it('uses independent remote STT models after missing local preparation and preserves source bounds', async () => {
    const a = client(async function* () {
      yield complete;
    });
    a.transcribeSpeech = vi.fn(async () => [
      { text: 'Hello', timestamp: [0, 1] as [number, number] },
    ]);
    const local = vi.fn(async () => {
      throw { code: 'MODEL_REQUIRED' };
    });
    const router = createServiceRouter(
      [{ id: 'a', name: 'Remote STT', client: a }],
      {
        llm: [],
        tts: [],
        stt: [
          { providerId: 'local', model: 'whisper' },
          { providerId: 'a', model: 'whisper-1' },
        ],
      },
    );
    expect(router.transcriptionDisclosure).toContain('Remote STT');
    const result = await router.transcribe(
      new Float32Array(16000),
      { assetId: 'asset', startUs: 100000, endUs: 1100000 },
      local,
      signal(),
    );
    expect(result).toMatchObject({
      assetId: 'asset',
      model: 'whisper-1',
      revision: 'provider:a',
      cues: [{ timeUs: 100000, endUs: 1100000, text: 'Hello' }],
    });
    expect(local).toHaveBeenCalledTimes(1);
    expect(a.transcribeSpeech).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'whisper-1' }),
      expect.any(AbortSignal),
    );
    router.dispose();
    a.dispose();
  });
  it('uses a local fallback only after recoverable remote failures and stops for invalid segments or cancellation', async () => {
    const a = client(async function* () {
      yield complete;
    });
    a.transcribeSpeech = vi.fn(async () => {
      throw new AiError('RATE_LIMITED', 'busy');
    });
    const saved = {
      id: 't',
      assetId: 'a',
      model: 'whisper',
      revision: 'pinned',
      cues: [],
    };
    const local = vi.fn(async () => saved);
    const router = createServiceRouter(
      [{ id: 'a', name: 'Remote', client: a }],
      {
        llm: [],
        tts: [],
        stt: [
          { providerId: 'a', model: 'remote' },
          { providerId: 'local', model: 'whisper' },
        ],
      },
    );
    const request = () =>
      router.transcribe(
        new Float32Array(16000),
        { assetId: 'a', startUs: 0, endUs: 1000000 },
        local,
        signal(),
      );
    expect(await request()).toEqual(saved);
    local.mockClear();
    a.transcribeSpeech = vi.fn(async () => {
      throw new AiError('INVALID_RESPONSE', 'invalid');
    });
    await expect(request()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(local).not.toHaveBeenCalled();
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      router.transcribe(
        new Float32Array(16000),
        { assetId: 'a', startUs: 0, endUs: 1000000 },
        local,
        cancelled.signal,
      ),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(local).not.toHaveBeenCalled();
    router.dispose();
    a.dispose();
  });
  it('reuses OpenRouter credentials for timestamped transcription and rejects untimed responses', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ segments: [{ text: 'Hello', start: 0, end: 1 }] }),
    );
    const client = createOpenRouter({ fetch });
    client.setKey('synthetic');
    expect(
      await client.transcribeSpeech!(
        {
          model: 'openai/whisper-1',
          audio: new Float32Array(16000),
          language: 'en',
        },
        signal(),
      ),
    ).toEqual([{ text: 'Hello', timestamp: [0, 1] }]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/audio/transcriptions');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer synthetic' });
    expect((init?.body as FormData).get('model')).toBe('openai/whisper-1');
    fetch.mockResolvedValue(Response.json({ text: 'Hello' }));
    await expect(
      client.transcribeSpeech!(
        { model: 'openai/whisper-1', audio: new Float32Array(16000) },
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    client.dispose();
  });
  it('sends only bounded WAV and validates timestamp JSON without exposing provider errors', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ segments: [{ text: 'Hello', start: 0, end: 1 }] }),
    );
    const a = createOpenAICompatible(
      {
        baseUrl: 'https://stt.example.test/v1',
        transcriptionModel: 'whisper-1',
      },
      { fetch },
    );
    a.setKey('synthetic');
    expect(
      await a.transcribeSpeech!(
        { model: 'whisper-1', audio: new Float32Array(16000) },
        signal(),
      ),
    ).toEqual([{ text: 'Hello', timestamp: [0, 1] as [number, number] }]);
    const body = fetch.mock.calls[0]![1]!.body as FormData;
    expect(body.get('response_format')).toBe('verbose_json');
    expect(body.get('timestamp_granularities[]')).toBe('segment');
    expect((body.get('file') as File).size).toBe(32044);
    fetch.mockResolvedValue(
      Response.json({ segments: [{ text: 'private', start: -1, end: 2 }] }),
    );
    await expect(
      a.transcribeSpeech!(
        { model: 'whisper-1', audio: new Float32Array(16000) },
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    fetch.mockClear();
    await expect(
      a.transcribeSpeech!(
        { model: 'whisper-1', audio: new Float32Array([NaN]) },
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(fetch).not.toHaveBeenCalled();
    a.dispose();
  });
});

describe('catalog ownership through fallback', () => {
  it('discovers a connected backup and binds selected models and voices to its own requests', async () => {
    const backup = createOpenAICompatible({
      baseUrl: 'https://backup.example.test/v1',
      model: 'backup',
      speechModel: 'tts',
      voices: ['voice'],
    });
    backup.setKey('synthetic');
    const stream = vi.fn<OpenRouter['stream']>(async function* () {
      yield complete;
    });
    backup.stream = stream;
    backup.synthesizeSpeech = vi.fn(async () => ({
      samples: new Float32Array(1),
      sampleRate: 24000 as const,
    }));
    const router = createServiceRouter(
      [{ id: 'backup', name: 'Backup', client: backup }],
      {
        llm: [
          { providerId: 'missing', model: 'primary' },
          { providerId: 'backup', model: 'backup' },
        ],
        tts: [
          { providerId: 'missing', model: 'primary-tts', voice: 'primary' },
          { providerId: 'backup', model: 'tts', voice: 'voice' },
        ],
        stt: [],
      },
    );
    expect((await router.listModels())[0]!.id).toBe('backup');
    expect((await router.listSpeechModels())[0]!.id).toBe('tts');
    expect(router.selectedProvider('llm')).toBe('backup');
    expect(router.selectedProvider('tts')).toBe('backup');
    await collect(router.stream({ ...chat, model: 'backup' }, signal()));
    expect(stream.mock.calls[0]![0].model).toBe('backup');
    await router.synthesizeSpeech(
      { model: 'tts', voice: 'voice', script: 'Hello', languages: ['English'] },
      signal(),
    );
    expect(backup.synthesizeSpeech).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'tts', voice: 'voice' }),
      expect.any(AbortSignal),
    );
    router.dispose();
    backup.dispose();
  });
  it('recovers once from a primary catalog outage and keeps indexing on its original primary', async () => {
    const first = client(async function* () {
      yield complete;
    });
    first.listModels = vi.fn(async () => {
      throw new AiError('PROVIDER_UNAVAILABLE', 'outage');
    });
    first.label = vi.fn(async () => {
      throw new AiError('PROVIDER_UNAVAILABLE', 'outage');
    });
    const backup = createOpenAICompatible({
      baseUrl: 'https://backup.example.test/v1',
      model: 'backup',
    });
    backup.setKey('synthetic');
    const router = createServiceRouter(
      [
        { id: 'a', name: 'A', client: first },
        { id: 'b', name: 'B', client: backup },
      ],
      {
        llm: [
          { providerId: 'a', model: 'primary' },
          { providerId: 'b', model: 'backup' },
        ],
        tts: [],
        stt: [],
      },
    );
    expect((await router.listModels())[0]!.id).toBe('backup');
    expect(first.listModels).toHaveBeenCalledTimes(1);
    expect(router.selectedProvider('llm')).toBe('b');
    await expect(
      router.label(
        {
          model: 'primary',
          prompt: 'Label',
          media: [],
          consent: true,
          maxOutputTokens: 100,
        },
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(first.label).toHaveBeenCalledTimes(1);
    router.dispose();
    first.dispose();
    backup.dispose();
  });
});
