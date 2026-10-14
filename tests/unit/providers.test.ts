import { describe, expect, it, vi } from 'vitest';
import { createOpenRouter } from '../../src/ai/openrouter';
import { createServiceRouter } from '../../src/ai/providers';
import type { ServiceRoutes } from '../../src/ai/providers';
import type {
  ChatRequest,
  OpenRouter,
  ProviderEvent,
} from '../../src/ai/types';
import {
  parseProviderConfiguration,
  defaultProviderConfiguration,
  workspaceContextPolicy,
} from '../../src/workspace/provider-preferences';
import {
  accountStorage,
  accountCredentialKey,
} from '../../src/workspace/provider-account-storage';

const signal = () => new AbortController().signal;
const routes = (): ServiceRoutes => ({
  llm: [{ providerId: 'openrouter', model: 'selected' }],
  tts: [{ providerId: 'openrouter', model: 'speech', voice: 'voice' }],
  stt: [{ providerId: 'local', model: 'whisper' }],
});
const chat: ChatRequest = {
  model: 'selected',
  messages: [{ role: 'user', content: 'Hello' }],
  tools: [],
};
async function collect(events: AsyncIterable<ProviderEvent>) {
  const result = [];
  for await (const event of events) result.push(event);
  return result;
}
function connected(): OpenRouter {
  return { ...createOpenRouter(), status: () => ({ connected: true }) };
}
function router(client: OpenRouter, selection = routes()) {
  return createServiceRouter(
    [{ id: 'openrouter', name: 'OpenRouter', client }],
    selection,
  );
}

describe('single OpenRouter services', () => {
  it('rejects multiple connections and backup routes for every service before any call', () => {
    const client = connected();
    expect(() =>
      createServiceRouter(
        [
          { id: 'openrouter', name: 'OpenRouter', client },
          { id: 'other', name: 'Other', client },
        ],
        routes(),
      ),
    ).toThrow(/one OpenRouter/);
    for (const service of ['llm', 'tts', 'stt'] as const) {
      const selection = routes();
      selection[service].push({ providerId: 'backup', model: 'backup' });
      expect(() => router(client, selection)).toThrow(/one service/);
    }
    const selection = routes();
    selection.llm = [{ providerId: 'foreign', model: 'm' }];
    expect(() => router(client, selection)).toThrow(/one service/);
    client.dispose();
  });
  it('preserves selected models, reasoning and requests without invoking another service on failure', async () => {
    const client = connected();
    const speech = vi.fn().mockRejectedValue(new Error('speech failed'));
    const stt = vi.fn().mockRejectedValue(new Error('stt failed'));
    const stream = vi.fn(async function* (
      _request: ChatRequest,
      _signal: AbortSignal,
    ) {
      void _request;
      void _signal;
      throw new Error('chat failed');
      yield { type: 'text', text: '' } as ProviderEvent;
    });
    client.stream = stream;
    client.synthesizeSpeech = speech;
    client.transcribeSpeech = stt;
    const selection = routes();
    selection.stt = [{ providerId: 'openrouter', model: 'whisper' }];
    const service = router(client, selection);
    const local = vi.fn();
    await expect(collect(service.stream(chat, signal()))).rejects.toThrow(
      'chat failed',
    );
    const request = {
      model: 'speech',
      voice: 'voice',
      script: 'Hello',
      languages: ['English'],
      instructions: '',
    };
    await expect(service.synthesizeSpeech(request, signal())).rejects.toThrow(
      'speech failed',
    );
    await expect(
      service.transcribe(
        new Float32Array(16000),
        { assetId: 'asset', startUs: 0, endUs: 1000000 },
        local,
        signal(),
      ),
    ).rejects.toThrow('stt failed');
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0]?.[0]).toEqual(chat);
    expect(speech).toHaveBeenCalledTimes(1);
    expect(speech.mock.calls[0]?.[0]).toEqual(request);
    expect(stt).toHaveBeenCalledTimes(1);
    expect(local).not.toHaveBeenCalled();
    expect(service.transcriptionDisclosure).toContain('OpenRouter');
    service.dispose();
    client.dispose();
  });
  it('keeps Whisper local, including missing model failure, without remote fallback', async () => {
    const client = connected();
    client.transcribeSpeech = vi.fn();
    const service = router(client);
    const local = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('Prepare Whisper'), { code: 'MODEL_REQUIRED' }),
      );
    await expect(
      service.transcribe(
        new Float32Array(16000),
        { assetId: 'asset', startUs: 0, endUs: 1000000 },
        local,
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'MODEL_REQUIRED' });
    expect(local).toHaveBeenCalledTimes(1);
    expect(client.transcribeSpeech).not.toHaveBeenCalled();
    expect(service.transcriptionDisclosure).toContain('locally');
    service.dispose();
    client.dispose();
  });
  it('does not replace a failed catalog or replay visible chat output', async () => {
    const client = connected();
    client.listModels = vi.fn().mockRejectedValue(new Error('catalog failed'));
    client.stream = vi.fn(async function* () {
      yield { type: 'text', text: 'partial' } as ProviderEvent;
      throw new Error('interrupted');
    });
    const service = router(client);
    await expect(service.listModels()).rejects.toThrow('catalog failed');
    const received = [];
    try {
      for await (const e of service.stream(chat, signal())) received.push(e);
    } catch (e) {
      expect((e as Error).message).toBe('interrupted');
    }
    expect(received).toEqual([{ type: 'text', text: 'partial' }]);
    expect(client.stream).toHaveBeenCalledTimes(1);
    service.dispose();
    client.dispose();
  });
  it('freezes service choices and aborts active requests without disconnecting shared credentials', async () => {
    const client = connected();
    const selection = routes();
    let used: AbortSignal | undefined;
    client.synthesizeSpeech = vi.fn((_request, s) => {
      used = s;
      return new Promise<import('../../src/ai/types').SpeechAudio>(
        (_resolve, reject) =>
          s.addEventListener('abort', () => reject(new Error('cancelled'))),
      );
    });
    const service = router(client, selection);
    selection.tts[0]!.providerId = 'other';
    expect(service.selectedProvider('tts')).toBe('openrouter');
    const pending = service.synthesizeSpeech(
      {
        model: 'speech',
        voice: 'voice',
        script: 'hi',
        languages: ['English'],
        instructions: '',
      },
      signal(),
    );
    service.dispose();
    await expect(pending).rejects.toThrow('cancelled');
    expect(used?.aborted).toBe(true);
    expect(client.status().connected).toBe(true);
    client.dispose();
  });
});

describe('portable single-provider migration', () => {
  const legacy = {
    profiles: [
      {
        id: 'endpoint',
        name: 'Endpoint',
        kind: 'compatible',
        baseUrl: 'https://example.test/v1',
        key: 'SECRET',
      },
      { id: 'one', name: 'Work', kind: 'openrouter' },
      { id: 'two', name: 'Personal', kind: 'openrouter' },
      {
        id: 'chatgpt',
        name: 'ChatGPT',
        kind: 'chatgpt',
        accessToken: 'SECRET',
      },
    ],
    routes: {
      llm: [
        { providerId: 'two', model: 'selected' },
        { providerId: 'one', model: 'backup' },
      ],
      tts: [
        { providerId: 'one', model: 'backup-speech' },
        { providerId: 'two', model: 'speech', voice: 'Kore' },
      ],
      stt: [
        { providerId: 'local', model: 'whisper' },
        { providerId: 'two', model: 'remote' },
      ],
    },
  };
  it('retains one selected OpenRouter namespace and choices, strips all backups and unsupported credentials', () => {
    const result = parseProviderConfiguration(JSON.stringify(legacy));
    expect(result).toEqual({
      profiles: [{ id: 'two', name: 'Personal', kind: 'openrouter' }],
      routes: {
        llm: [{ providerId: 'two', model: 'selected' }],
        tts: [{ providerId: 'two', model: 'speech', voice: 'Kore' }],
        stt: [{ providerId: 'local', model: 'whisper' }],
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /SECRET|compatible|chatgpt|backup|baseUrl/,
    );
    expect(parseProviderConfiguration(JSON.stringify(result))).toEqual(result);
    expect(accountCredentialKey(result.profiles[0]!)).toBe(
      'localcut.openrouter-credential.v1:two',
    );
  });
  it('preserves the exact historical speech route identity for a named single OpenRouter account', () => {
    const original = {
      profiles: [{ id: 'studio', name: 'Studio', kind: 'openrouter' }],
      routes: {
        llm: [{ providerId: 'studio', model: 'chat' }],
        tts: [{ providerId: 'studio', model: 'speech', voice: 'Kore' }],
        stt: [{ providerId: 'local', model: 'whisper' }],
      },
    };
    const migrated = parseProviderConfiguration(JSON.stringify(original));
    // Conversation's existing speech checkpoint identity includes this whole profile.
    const originalIdentity = JSON.stringify({
      routes: [{ providerId: 'studio' }],
      profiles: original.profiles,
    });
    const migratedIdentity = JSON.stringify({
      routes: migrated.routes.tts.map(({ providerId }) => ({ providerId })),
      profiles: migrated.profiles,
    });
    expect(migratedIdentity).toBe(originalIdentity);
    expect(migrated.routes).toEqual(original.routes);
  });
  it('never promotes removed remote STT backup and defaults unsupported-only imports to local', () => {
    const value = structuredClone(legacy);
    value.routes.stt = [
      { providerId: 'endpoint', model: 'old' },
      { providerId: 'two', model: 'remote' },
    ];
    expect(
      parseProviderConfiguration(JSON.stringify(value)).routes.stt,
    ).toEqual([{ providerId: 'local', model: 'whisper' }]);
    value.profiles = value.profiles.filter((p) => p.kind !== 'openrouter');
    expect(parseProviderConfiguration(JSON.stringify(value))).toEqual(
      defaultProviderConfiguration(),
    );
  });
  it('retains explicit OpenRouter STT selection with exactly one recipient', () => {
    const value = structuredClone(legacy);
    value.routes.stt = [
      { providerId: 'two', model: 'remote' },
      { providerId: 'local', model: 'whisper' },
    ];
    expect(
      parseProviderConfiguration(JSON.stringify(value)).routes.stt,
    ).toEqual([{ providerId: 'two', model: 'remote' }]);
  });
  it('requires an actual retained OpenRouter connection for workspace sharing', () => {
    const result = parseProviderConfiguration(JSON.stringify(legacy));
    for (const ids of [[], ['one'], ['endpoint'], ['chatgpt']])
      expect(workspaceContextPolicy(result.profiles, ids).includeText).toBe(
        false,
      );
    expect(workspaceContextPolicy(result.profiles, ['two'])).toEqual({
      includeCodingWorkspace: true,
      includeText: true,
      includeAssetNames: true,
      includeTranscripts: true,
      includeCaptureMetadata: true,
      includeAssetIndexes: true,
    });
  });
  it('keeps credential wrappers scoped and never writes secrets to portable settings', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => {
        values.set(k, v);
      },
      removeItem: (k: string) => {
        values.delete(k);
      },
    };
    const wrapped = accountStorage(
      { id: 'two', kind: 'openrouter' },
      () => storage,
    );
    wrapped.setItem('owned', 'value');
    expect(values.get('owned:two')).toBe('value');
    wrapped.removeItem('owned');
    expect(values.size).toBe(0);
  });
});
