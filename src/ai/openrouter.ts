import { AuthorizationFlow } from './auth.ts';
import { AiError, aiInvariant, httpError } from './errors.ts';
import { parseChatStream, readJson } from './protocol.ts';
import type {
  ChatRequest,
  OpenRouter,
  OpenRouterModel,
  OpenRouterOptions,
  ProviderEvent,
} from './types.ts';

const API = 'https://openrouter.ai/api/v1';
export const OPENROUTER_LIMITS = Object.freeze({
  requestBytes: 2_097_152,
  maxOutputTokens: 32_768,
  timeoutMs: 120_000,
  maximumTimeoutMs: 600_000,
  models: 20_000,
});
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function keyValue(value: unknown): string {
  aiInvariant(
    typeof value === 'string',
    'AUTH_INVALID',
    'An OpenRouter API key is required.',
  );
  const key = value.trim();
  aiInvariant(
    /^[\x21-\x7e]{8,4096}$/.test(key),
    'AUTH_INVALID',
    'OpenRouter API key format is invalid.',
  );
  return key;
}
function modelsFrom(value: unknown): OpenRouterModel[] {
  aiInvariant(
    object(value) &&
      Array.isArray(value.data) &&
      value.data.length <= OPENROUTER_LIMITS.models,
    'INVALID_RESPONSE',
    'OpenRouter returned an invalid model catalog.',
  );
  const models: OpenRouterModel[] = [];
  const ids = new Set<string>();
  for (const item of value.data) {
    aiInvariant(
      object(item) &&
        typeof item.id === 'string' &&
        !item.id.includes('://') &&
        /^~?[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(item.id) &&
        !ids.has(item.id) &&
        typeof item.name === 'string' &&
        item.name.length <= 512 &&
        typeof item.context_length === 'number' &&
        Number.isSafeInteger(item.context_length) &&
        item.context_length > 0 &&
        Array.isArray(item.supported_parameters) &&
        item.supported_parameters.every(
          (parameter) =>
            typeof parameter === 'string' && parameter.length <= 128,
        ),
      'INVALID_RESPONSE',
      'OpenRouter returned an invalid model catalog.',
    );
    ids.add(item.id);
    const parameters = item.supported_parameters as string[];
    const model: OpenRouterModel = {
      id: item.id,
      name: item.name,
      contextLength: item.context_length,
      supportedParameters: [...parameters],
      supportsTools:
        parameters.includes('tools') && parameters.includes('tool_choice'),
    };
    if (
      object(item.top_provider) &&
      typeof item.top_provider.max_completion_tokens === 'number' &&
      Number.isSafeInteger(item.top_provider.max_completion_tokens) &&
      item.top_provider.max_completion_tokens > 0
    )
      model.maxCompletionTokens = item.top_provider.max_completion_tokens;
    if (object(item.pricing)) {
      const pricing: { prompt?: string; completion?: string } = {};
      for (const name of ['prompt', 'completion'] as const) {
        const price = item.pricing[name];
        if (
          typeof price === 'string' &&
          /^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(price) &&
          price.length <= 64
        )
          pricing[name] = price;
      }
      model.pricing = pricing;
    }
    models.push(model);
  }
  return models;
}
function validateRequest(request: ChatRequest): string {
  aiInvariant(
    typeof request.model === 'string' && request.model.length > 0,
    'MODEL_REQUIRED',
    'Select an explicit OpenRouter model.',
  );
  aiInvariant(
    request.model !== 'openrouter/auto',
    'MODEL_UNSUPPORTED',
    'Automatic model routing is not enabled.',
  );
  aiInvariant(
    Number.isInteger(request.maxOutputTokens) &&
      request.maxOutputTokens > 0 &&
      request.maxOutputTokens <= OPENROUTER_LIMITS.maxOutputTokens,
    'INVALID_REQUEST',
    'AI output token limit is invalid.',
  );
  aiInvariant(
    Array.isArray(request.messages) &&
      request.messages.length > 0 &&
      request.messages.length <= 256 &&
      Array.isArray(request.tools) &&
      request.tools.length <= 32,
    'INVALID_REQUEST',
    'AI request size is invalid.',
  );
  for (const rawMessage of request.messages) {
    const message: unknown = rawMessage;
    aiInvariant(
      object(message),
      'INVALID_REQUEST',
      'AI messages must be text-only.',
    );
    const valid =
      ((message.role === 'system' || message.role === 'user') &&
        typeof message.content === 'string') ||
      (message.role === 'tool' &&
        typeof message.content === 'string' &&
        typeof message.tool_call_id === 'string') ||
      (message.role === 'assistant' &&
        (typeof message.content === 'string' || message.content === null));
    aiInvariant(valid, 'INVALID_REQUEST', 'AI messages must be text-only.');
    const allowed =
      message.role === 'assistant'
        ? ['role', 'content', 'tool_calls']
        : message.role === 'tool'
          ? ['role', 'content', 'tool_call_id']
          : ['role', 'content'];
    aiInvariant(
      Object.keys(message).every((key) => allowed.includes(key)),
      'INVALID_REQUEST',
      'Unsupported AI message field.',
    );
    if (message.role === 'assistant' && message.tool_calls !== undefined) {
      aiInvariant(
        Array.isArray(message.tool_calls) && message.tool_calls.length <= 32,
        'INVALID_REQUEST',
        'Invalid tool history.',
      );
      for (const call of message.tool_calls)
        aiInvariant(
          object(call) &&
            typeof call.id === 'string' &&
            call.type === 'function' &&
            object(call.function) &&
            typeof call.function.name === 'string' &&
            typeof call.function.arguments === 'string' &&
            Object.keys(call).every((key) =>
              ['id', 'type', 'function'].includes(key),
            ) &&
            Object.keys(call.function).every((key) =>
              ['name', 'arguments'].includes(key),
            ),
          'INVALID_REQUEST',
          'Invalid tool history.',
        );
    }
  }
  const names = new Set<string>();
  for (const tool of request.tools) {
    aiInvariant(
      object(tool) &&
        tool.type === 'function' &&
        object(tool.function) &&
        typeof tool.function.name === 'string' &&
        /^[A-Za-z0-9_-]{1,128}$/.test(tool.function.name) &&
        !names.has(tool.function.name) &&
        typeof tool.function.description === 'string' &&
        object(tool.function.parameters) &&
        Object.keys(tool).every((key) => ['type', 'function'].includes(key)) &&
        Object.keys(tool.function).every((key) =>
          ['name', 'description', 'parameters'].includes(key),
        ),
      'INVALID_REQUEST',
      'Invalid AI tool definition.',
    );
    names.add(tool.function.name);
  }
  let json: string;
  try {
    json = JSON.stringify({
      model: request.model,
      messages: request.messages,
      tools: request.tools,
      max_tokens: request.maxOutputTokens,
      stream: true,
      ...(request.tools.length
        ? { tool_choice: 'auto', parallel_tool_calls: false }
        : {}),
      provider: { data_collection: 'deny', require_parameters: true },
    });
  } catch {
    throw new AiError('INVALID_REQUEST', 'AI request could not be serialized.');
  }
  aiInvariant(
    new TextEncoder().encode(json).byteLength <= OPENROUTER_LIMITS.requestBytes,
    'INVALID_REQUEST',
    'AI request exceeded the size limit.',
  );
  return json;
}

/** No network, storage, worker or navigation activity occurs during construction. */
export function createOpenRouter(options: OpenRouterOptions = {}): OpenRouter {
  const requestFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeout = options.requestTimeoutMs ?? OPENROUTER_LIMITS.timeoutMs;
  aiInvariant(
    Number.isSafeInteger(timeout) &&
      timeout > 0 &&
      timeout <= OPENROUTER_LIMITS.maximumTimeoutMs,
    'INVALID_REQUEST',
    'AI request timeout is invalid.',
  );
  let key: string | undefined;
  let disposed = false;
  let generation = 0;
  let catalog: OpenRouterModel[] | undefined;
  const active = new Set<AbortController>();
  const assertActive = () =>
    aiInvariant(!disposed, 'DISPOSED', 'OpenRouter client is disposed.');
  function operation(signal?: AbortSignal) {
    assertActive();
    const controller = new AbortController();
    const epoch = generation;
    let timedOut = false;
    const abort = () => controller.abort();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);
    active.add(controller);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const check = () => {
      assertActive();
      if (timedOut) throw new AiError('TIMEOUT', 'AI request timed out.');
      if (controller.signal.aborted || epoch !== generation)
        throw new AiError('CANCELLED', 'AI request cancelled.');
    };
    return {
      signal: controller.signal,
      check,
      async fetch(
        path: '/auth/keys' | '/models' | '/chat/completions',
        init: RequestInit,
      ): Promise<Response> {
        check();
        // Race also protects integrations whose injected fetch implementation ignores signals.
        let onAbort: (() => void) | undefined;
        try {
          const aborted = new Promise<never>((_, reject) => {
            onAbort = () =>
              reject(new AiError('CANCELLED', 'AI request cancelled.'));
            controller.signal.addEventListener('abort', onAbort, {
              once: true,
            });
          });
          const response = await Promise.race([
            requestFetch(`${API}${path}`, {
              ...init,
              signal: controller.signal,
              credentials: 'omit',
              redirect: 'error',
              referrerPolicy: 'no-referrer',
              cache: 'no-store',
            }),
            aborted,
          ]);
          check();
          if (!response.ok) {
            void response.body?.cancel().catch(() => undefined);
            throw httpError(
              response.status,
              response.headers.get('retry-after'),
            );
          }
          return response;
        } finally {
          if (onAbort) controller.signal.removeEventListener('abort', onAbort);
        }
      },
      error(error: unknown): never {
        check();
        if (error instanceof AiError) throw error;
        throw new AiError('NETWORK_ERROR', 'Unable to connect to OpenRouter.');
      },
      finish() {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        active.delete(controller);
      },
    };
  }
  function disconnect() {
    key = undefined;
    catalog = undefined;
    generation++;
    auth.invalidate();
    for (const controller of active) controller.abort();
  }
  function setKey(value: string) {
    assertActive();
    const next = keyValue(value);
    disconnect();
    key = next;
  }
  const auth = new AuthorizationFlow({
    ...(options.oauthStorage ? { storage: options.oauthStorage } : {}),
    now: options.now ?? Date.now,
    assertActive,
    connect: setKey,
    async exchange(code, verifier, signal) {
      const op = operation(signal);
      try {
        const response = await op.fetch('/auth/keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            code_verifier: verifier,
            code_challenge_method: 'S256',
          }),
        });
        const value = await readJson(response, op.signal, 16_384);
        op.check();
        aiInvariant(
          object(value),
          'INVALID_RESPONSE',
          'OpenRouter returned an invalid authorization response.',
        );
        return keyValue(value.key);
      } catch (error) {
        return op.error(error);
      } finally {
        op.finish();
      }
    },
  });
  const client: OpenRouter = {
    status: () => ({ connected: !disposed && key !== undefined }),
    setKey,
    disconnect,
    beginAuthorization: (args) => auth.begin(args),
    completeAuthorization: (args, signal) => auth.complete(args, signal),
    async listModels(signal) {
      const op = operation(signal);
      try {
        const response = await op.fetch('/models', {
          method: 'GET',
          headers: key ? { Authorization: `Bearer ${key}` } : {},
        });
        const result = modelsFrom(await readJson(response, op.signal));
        op.check();
        catalog = structuredClone(result);
        return result;
      } catch (error) {
        return op.error(error);
      } finally {
        op.finish();
      }
    },
    async *stream(
      request: ChatRequest,
      signal: AbortSignal,
    ): AsyncGenerator<ProviderEvent> {
      assertActive();
      aiInvariant(
        key,
        'AUTH_REQUIRED',
        'Connect to OpenRouter before starting an AI request.',
      );
      const body = validateRequest(request);
      const requestedModel = request.model;
      const requestedTokens = request.maxOutputTokens;
      const epoch = generation;
      const models = catalog ?? (await client.listModels(signal));
      assertActive();
      aiInvariant(epoch === generation, 'CANCELLED', 'AI request cancelled.');
      const model = models.find((candidate) => candidate.id === requestedModel);
      aiInvariant(
        model?.supportsTools,
        'MODEL_UNSUPPORTED',
        'Selected model does not support LocalCut tool calling.',
      );
      aiInvariant(
        !model.maxCompletionTokens ||
          requestedTokens <= model.maxCompletionTokens,
        'INVALID_REQUEST',
        'Output limit exceeds the selected model capability.',
      );
      const op = operation(signal);
      try {
        const response = await op.fetch('/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body,
        });
        if (
          response.headers
            .get('content-type')
            ?.split(';')[0]
            ?.trim()
            .toLowerCase() !== 'text/event-stream'
        ) {
          await response.body?.cancel().catch(() => undefined);
          throw new AiError(
            'INVALID_RESPONSE',
            'OpenRouter did not return an event stream.',
          );
        }
        for await (const event of parseChatStream(response, op.signal)) {
          op.check();
          yield event;
        }
        op.check();
      } catch (error) {
        op.error(error);
      } finally {
        op.finish();
      }
    },
    dispose() {
      if (!disposed) {
        disconnect();
        disposed = true;
      }
    },
  };
  return client;
}
