import type { TranscriptionExecutor } from '../editor';
import { sourceCues } from '../services/transcript-cues';
import { AiError, aiInvariant } from './errors';
import { createOpenRouter } from './openrouter';
import type {
  CompatibleEndpoint,
  OpenRouter,
  OpenRouterOptions,
  OpenRouterModel,
  SpeechModel,
  ProviderEvent,
} from './types';

export type ServiceKind = 'llm' | 'tts' | 'stt';
export interface ProviderRoute {
  providerId: string;
  model: string;
  voice?: string;
}
export interface ServiceRoutes {
  llm: ProviderRoute[];
  tts: ProviderRoute[];
  stt: ProviderRoute[];
}
export interface ProviderConnection {
  id: string;
  name: string;
  client: OpenRouter;
}

/** Reuse the bounded transport/parser and credential cancellation owner. */
export function createOpenAICompatible(
  endpoint: CompatibleEndpoint,
  options: Omit<OpenRouterOptions, 'compatible' | 'credentialStorage'> = {},
): OpenRouter {
  for (const model of [
    endpoint.model,
    endpoint.speechModel,
    endpoint.transcriptionModel,
  ])
    aiInvariant(
      model === undefined ||
        /^~?[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(model),
      'INVALID_REQUEST',
      'Invalid provider model ID.',
    );
  aiInvariant(
    !endpoint.voices ||
      (endpoint.voices.length <= 256 &&
        endpoint.voices.every((v) => /^[A-Za-z0-9_-]{1,80}$/.test(v))),
    'INVALID_REQUEST',
    'Invalid provider voice.',
  );
  return createOpenRouter({
    ...options,
    compatible: structuredClone(endpoint),
  });
}
const recoverable = new Set([
  'AUTH_REQUIRED',
  'AUTH_INVALID',
  'INSUFFICIENT_CREDITS',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'NETWORK_ERROR',
  'TIMEOUT',
]);
function retry(error: unknown, signal: AbortSignal): boolean {
  return (
    !signal.aborted && error instanceof AiError && recoverable.has(error.code)
  );
}

/** Immutable route snapshot. Reconfiguration retires this router, never its shared connections. */
export function createServiceRouter(
  connections: readonly ProviderConnection[],
  routes: ServiceRoutes,
): OpenRouter & {
  transcribe: TranscriptionExecutor;
  transcriptionDisclosure: string;
  selectedProvider(service: 'llm' | 'tts'): string | undefined;
} {
  for (const service of ['llm', 'tts', 'stt'] as const)
    aiInvariant(
      Array.isArray(routes[service]) &&
        routes[service].length <= 20 &&
        new Set(routes[service].map((r) => r.providerId)).size ===
          routes[service].length,
      'INVALID_REQUEST',
      'Use a bounded route with each provider listed once.',
    );
  const selected = structuredClone(routes);
  const clients = new Map(connections.map((p) => [p.id, p.client]));
  const recipients = selected.stt
    .filter((r) => r.providerId !== 'local')
    .map(
      (r) =>
        connections.find((p) => p.id === r.providerId)?.name ?? r.providerId,
    );
  const transcriptionDisclosure = recipients.length
    ? `Approving may send the selected source audio to these STT providers in order: ${recipients.join(' → ')}. Provider charges may apply. Transcript text stays local unless separately shared.`
    : 'Transcription runs locally with Whisper. Source audio stays in this browser.';
  const catalogOwner: Partial<Record<'llm' | 'tts', string>> = {};
  let disposed = false;
  const active = new Set<AbortController>();
  function primary(service: 'llm' | 'tts') {
    aiInvariant(!disposed, 'DISPOSED', 'Service router is disposed.');
    const route = selected[service][0];
    const client = route && clients.get(route.providerId);
    aiInvariant(
      client,
      'AUTH_REQUIRED',
      `Configure a ${service.toUpperCase()} provider.`,
    );
    return client;
  }
  function operation(signal: AbortSignal) {
    aiInvariant(!disposed, 'DISPOSED', 'Service router is disposed.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    active.add(controller);
    return {
      signal: controller.signal,
      finish() {
        signal.removeEventListener('abort', abort);
        active.delete(controller);
      },
    };
  }
  async function run<T>(
    signal: AbortSignal | undefined,
    fn: (signal: AbortSignal) => Promise<T>,
  ) {
    const op = operation(signal ?? new AbortController().signal);
    try {
      const result = await fn(op.signal);
      if (op.signal.aborted)
        throw new AiError('CANCELLED', 'Service request cancelled.');
      return result;
    } finally {
      op.finish();
    }
  }
  async function discover(
    service: 'llm',
    signal: AbortSignal,
  ): Promise<OpenRouterModel[]>;
  async function discover(
    service: 'tts',
    signal: AbortSignal,
  ): Promise<SpeechModel[]>;
  async function discover(service: 'llm' | 'tts', signal: AbortSignal) {
    let failure: unknown = new AiError(
      'AUTH_REQUIRED',
      `Connect a configured ${service.toUpperCase()} provider.`,
    );
    for (const route of selected[service]) {
      if (signal.aborted)
        throw new AiError('CANCELLED', 'Catalog request cancelled.');
      const client = clients.get(route.providerId);
      if (!client?.status().connected) continue;
      try {
        const catalog =
          service === 'llm'
            ? await client.listModels(signal)
            : await client.listSpeechModels(signal);
        if (signal.aborted)
          throw new AiError('CANCELLED', 'Catalog request cancelled.');
        aiInvariant(
          catalog.length,
          'MODEL_UNSUPPORTED',
          'No supported models are configured for this service.',
        );
        catalogOwner[service] = route.providerId;
        return catalog;
      } catch (error) {
        if (!retry(error, signal)) throw error;
        failure = error;
      }
    }
    throw failure;
  }
  function stop() {
    disposed = true;
    for (const controller of active) controller.abort();
  }
  return {
    transcriptionDisclosure,
    selectedProvider: (service) =>
      catalogOwner[service] ?? selected[service][0]?.providerId,
    transcribe: (audio, context, local, signal) =>
      run(signal, async (s) => {
        let failure: unknown = new AiError(
          'MODEL_REQUIRED',
          'Configure an STT route.',
        );
        for (const route of selected.stt) {
          if (s.aborted)
            throw new AiError('CANCELLED', 'Transcription cancelled.');
          try {
            if (route.providerId === 'local') {
              try {
                return await local();
              } catch (error) {
                // Missing local weights never download automatically; an approved remote fallback may proceed.
                if (
                  !s.aborted &&
                  (error as { code?: string })?.code === 'MODEL_REQUIRED'
                ) {
                  failure = error;
                  continue;
                }
                throw error;
              }
            }
            const client = clients.get(route.providerId);
            if (!client?.status().connected) {
              failure = new AiError(
                'AUTH_REQUIRED',
                'A configured STT provider is disconnected.',
              );
              continue;
            }
            aiInvariant(
              client.transcribeSpeech,
              'MODEL_UNSUPPORTED',
              'Provider does not support STT.',
            );
            const segments = await client.transcribeSpeech(
              { model: route.model, audio, language: context.language },
              s,
            );
            if (s.aborted)
              throw new AiError('CANCELLED', 'Transcription cancelled.');
            return {
              id: crypto.randomUUID(),
              assetId: context.assetId,
              model: route.model,
              revision: `provider:${route.providerId}`,
              ...(context.language ? { language: context.language } : {}),
              cues: sourceCues(segments, context.startUs, context.endUs),
            };
          } catch (error) {
            if (!retry(error, s)) throw error;
            failure = error;
          }
        }
        throw failure;
      }),
    status: () => ({
      connected:
        !disposed && [...clients.values()].some((p) => p.status().connected),
    }),
    setKey() {
      throw new AiError(
        'INVALID_REQUEST',
        'Connect credentials to a named provider.',
      );
    },
    restoreCredential() {
      throw new AiError(
        'INVALID_REQUEST',
        'Restore credentials on a named provider.',
      );
    },
    disconnect: stop,
    dispose: stop,
    beginAuthorization: (options) => primary('llm').beginAuthorization(options),
    completeAuthorization: (options, signal) =>
      primary('llm').completeAuthorization(options, signal),
    listModels: (signal) => run(signal, (s) => discover('llm', s)),
    listSpeechModels: (signal) => run(signal, (s) => discover('tts', s)),
    // Indexing has separate evidence consent and intentionally never fails over.
    label: (request, signal) =>
      run(signal, (s) => primary('llm').label(request, s)),
    async *stream(request, signal): AsyncGenerator<ProviderEvent> {
      const op = operation(signal);
      let published = false;
      let failure: unknown = new AiError(
        'AUTH_REQUIRED',
        'Configure an LLM route.',
      );
      try {
        for (const route of selected.llm) {
          if (op.signal.aborted)
            throw new AiError('CANCELLED', 'AI request cancelled.');
          const client = clients.get(route.providerId);
          if (!client?.status().connected) {
            failure = new AiError(
              'AUTH_REQUIRED',
              'A configured provider is disconnected.',
            );
            continue;
          }
          try {
            const ownsSelection =
              route.providerId ===
              (catalogOwner.llm ?? selected.llm[0]?.providerId);
            const model = ownsSelection ? request.model : route.model;
            if (!ownsSelection && !model) continue;
            aiInvariant(
              model,
              'MODEL_REQUIRED',
              'Choose a model for each LLM fallback.',
            );
            // Provider-specific reasoning signatures never travel to another endpoint.
            const messages =
              selected.llm.length === 1
                ? request.messages
                : request.messages.map((m) =>
                    m.role === 'assistant'
                      ? {
                          role: m.role,
                          content: m.content,
                          ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
                        }
                      : m,
                  );
            for await (const event of client.stream(
              { ...request, model, messages },
              op.signal,
            )) {
              if (op.signal.aborted)
                throw new AiError('CANCELLED', 'AI request cancelled.');
              published = true;
              yield event;
            }
            return;
          } catch (error) {
            if (published || !retry(error, op.signal)) throw error;
            failure = error;
          }
        }
        throw failure;
      } finally {
        op.finish();
      }
    },
    async synthesizeSpeech(request, signal) {
      const op = operation(signal);
      let failure: unknown = new AiError(
        'AUTH_REQUIRED',
        'Configure a TTS route.',
      );
      try {
        for (const route of selected.tts) {
          if (op.signal.aborted)
            throw new AiError('CANCELLED', 'Speech request cancelled.');
          const client = clients.get(route.providerId);
          if (!client?.status().connected) {
            failure = new AiError(
              'AUTH_REQUIRED',
              'A configured provider is disconnected.',
            );
            continue;
          }
          try {
            const ownsSelection =
              route.providerId ===
              (catalogOwner.tts ?? selected.tts[0]?.providerId);
            if (!ownsSelection && (!route.model || !route.voice)) continue;
            aiInvariant(
              ownsSelection || (route.model && route.voice),
              'MODEL_REQUIRED',
              'Choose a model and voice for each speech fallback.',
            );
            const result = await client.synthesizeSpeech(
              ownsSelection
                ? request
                : { ...request, model: route.model, voice: route.voice! },
              op.signal,
            );
            if (op.signal.aborted)
              throw new AiError('CANCELLED', 'Speech request cancelled.');
            return result;
          } catch (error) {
            if (!retry(error, op.signal)) throw error;
            failure = error;
          }
        }
        throw failure;
      } finally {
        op.finish();
      }
    },
  };
}
