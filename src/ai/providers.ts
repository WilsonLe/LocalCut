import { AiError, aiInvariant } from './errors';
import { createOpenRouter } from './openrouter';
import type {
  CompatibleEndpoint,
  OpenRouter,
  OpenRouterOptions,
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
  options: Omit<OpenRouterOptions, 'compatible'> = {},
): OpenRouter {
  for (const model of [endpoint.model, endpoint.speechModel])
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
): OpenRouter {
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
  function stop() {
    disposed = true;
    for (const controller of active) controller.abort();
  }
  return {
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
    disconnect: stop,
    dispose: stop,
    beginAuthorization: (options) => primary('llm').beginAuthorization(options),
    completeAuthorization: (options, signal) =>
      primary('llm').completeAuthorization(options, signal),
    listModels: (signal) => run(signal, (s) => primary('llm').listModels(s)),
    listSpeechModels: (signal) =>
      run(signal, (s) => primary('tts').listSpeechModels(s)),
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
        for (const [index, route] of selected.llm.entries()) {
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
            const model = index === 0 ? request.model : route.model;
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
        for (const [index, route] of selected.tts.entries()) {
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
            aiInvariant(
              index === 0 || (route.model && route.voice),
              'MODEL_REQUIRED',
              'Choose a model and voice for each speech fallback.',
            );
            const result = await client.synthesizeSpeech(
              index === 0
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
