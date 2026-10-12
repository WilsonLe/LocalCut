import type { TranscriptionExecutor } from '../editor';
import { sourceCues } from '../services/transcript-cues';
import { AiError, aiInvariant } from './errors';
import type { OpenRouter, ProviderEvent } from './types';

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

/** One immutable OpenRouter connection and one selection per service. No failover. */
export function createServiceRouter(
  connections: readonly ProviderConnection[],
  routes: ServiceRoutes,
): OpenRouter & {
  transcribe: TranscriptionExecutor;
  transcriptionDisclosure: string;
  selectedProvider(service: 'llm' | 'tts'): string | undefined;
} {
  aiInvariant(
    connections.length <= 1,
    'INVALID_REQUEST',
    'Use one OpenRouter connection.',
  );
  for (const service of ['llm', 'tts', 'stt'] as const)
    aiInvariant(
      Array.isArray(routes[service]) &&
        routes[service].length <= 1 &&
        routes[service].every(
          (r) =>
            r &&
            typeof r.model === 'string' &&
            (r.providerId === connections[0]?.id ||
              (service === 'stt' &&
                r.providerId === 'local' &&
                r.model === 'whisper')),
        ),
      'INVALID_REQUEST',
      'Choose one service on the connected OpenRouter account or local Whisper.',
    );
  const selected = structuredClone(routes);
  const client = connections[0]?.client;
  const remote =
    selected.stt[0]?.providerId !== 'local' && !!selected.stt.length;
  const transcriptionDisclosure = remote
    ? 'Approving sends the selected source audio to OpenRouter using the selected STT model. Provider charges may apply. Transcript text follows the current context-sharing policy.'
    : 'Transcription runs locally with Whisper. Source audio stays in this browser.';
  let disposed = false;
  const active = new Set<AbortController>();
  function primary(service: 'llm' | 'tts' | 'stt') {
    aiInvariant(!disposed, 'DISPOSED', 'Service router is disposed.');
    aiInvariant(
      selected[service].length && client?.status().connected,
      'AUTH_REQUIRED',
      'Connect OpenRouter for this service.',
    );
    return client;
  }
  function operation(signal?: AbortSignal) {
    aiInvariant(!disposed, 'DISPOSED', 'Service router is disposed.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    active.add(controller);
    return {
      signal: controller.signal,
      finish() {
        signal?.removeEventListener('abort', abort);
        active.delete(controller);
      },
    };
  }
  async function run<T>(
    signal: AbortSignal | undefined,
    fn: (signal: AbortSignal) => Promise<T>,
  ) {
    const op = operation(signal);
    try {
      if (op.signal.aborted)
        throw new AiError('CANCELLED', 'Service request cancelled.');
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
    transcriptionDisclosure,
    selectedProvider: (service) => selected[service][0]?.providerId,
    status: () => ({ connected: !disposed && !!client?.status().connected }),
    setKey: () => {
      throw new AiError(
        'INVALID_REQUEST',
        'Connect OpenRouter before selecting services.',
      );
    },
    restoreCredential: () => {
      throw new AiError(
        'INVALID_REQUEST',
        'Restore the OpenRouter connection directly.',
      );
    },
    beginAuthorization: () => {
      throw new AiError('INVALID_REQUEST', 'Authorize OpenRouter directly.');
    },
    completeAuthorization: () => {
      throw new AiError('INVALID_REQUEST', 'Authorize OpenRouter directly.');
    },
    disconnect: stop,
    dispose: stop,
    listModels: (signal) => run(signal, (s) => primary('llm').listModels(s)),
    listSpeechModels: (signal) =>
      run(signal, (s) => primary('tts').listSpeechModels(s)),
    label: (request, signal) =>
      run(signal, (s) => primary('llm').label(request, s)),
    transcribe: (audio, context, local, signal) =>
      run(signal, async (s) => {
        const route = selected.stt[0];
        aiInvariant(route, 'MODEL_REQUIRED', 'Select a transcription service.');
        if (route.providerId === 'local') return local();
        const provider = primary('stt');
        aiInvariant(
          provider.transcribeSpeech,
          'MODEL_UNSUPPORTED',
          'OpenRouter does not support this transcription service.',
        );
        const segments = await provider.transcribeSpeech(
          {
            model: route.model,
            audio,
            ...(context.language ? { language: context.language } : {}),
          },
          s,
        );
        return {
          id: crypto.randomUUID(),
          assetId: context.assetId,
          model: route.model,
          revision: `provider:${route.providerId}`,
          ...(context.language ? { language: context.language } : {}),
          cues: sourceCues(segments, context.startUs, context.endUs),
        };
      }),
    async *stream(request, signal): AsyncGenerator<ProviderEvent> {
      const op = operation(signal);
      try {
        if (op.signal.aborted)
          throw new AiError('CANCELLED', 'AI request cancelled.');
        for await (const event of primary('llm').stream(request, op.signal)) {
          if (op.signal.aborted)
            throw new AiError('CANCELLED', 'AI request cancelled.');
          yield event;
        }
      } finally {
        op.finish();
      }
    },
    synthesizeSpeech: (request, signal) =>
      run(signal, (s) => primary('tts').synthesizeSpeech(request, s)),
  };
}
