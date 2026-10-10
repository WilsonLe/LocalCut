import {
  CHATGPT_AUTHORITY_KEY,
  CHATGPT_CREDENTIAL_KEY,
  ChatGPTAuthorization,
} from './chatgpt-auth';
import { AiError, aiInvariant, httpError } from './errors';
import { readJson } from './protocol';
import { parseResponses, responsesBody } from './responses';
import type {
  AuthorizationStorage,
  OpenRouter,
  OpenRouterOptions,
} from './types';
export interface ChatGPTOptions extends Omit<
  OpenRouterOptions,
  'compatible' | 'credentialStorage'
> {
  credentialStorage?: AuthorizationStorage;
}
export interface ChatGPTClient extends OpenRouter {
  restore(): boolean;
}
/** Inert, public OAuth/Responses adapter. No Codex client ID or private ChatGPT endpoints. */
export function createChatGPT(options: ChatGPTOptions = {}): ChatGPTClient {
  const requestFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  let disposed = false;
  let generation = 0;
  const active = new Set<AbortController>();
  const timeout = options.requestTimeoutMs ?? 120000;
  aiInvariant(
    Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 600000,
    'INVALID_REQUEST',
    'Invalid AI timeout.',
  );
  function operation(signal?: AbortSignal, bindIdentity = true) {
    aiInvariant(!disposed, 'DISPOSED', 'ChatGPT provider is disposed.');
    const controller = new AbortController();
    const epoch = generation;
    const sessionId = bindIdentity ? auth.sessionId() : null;
    let timedOut = false;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => {
      timedOut = true;
      abort();
    }, timeout);
    active.add(controller);
    const check = () => {
      if (bindIdentity) {
        try {
          if (auth.synchronize() || auth.sessionId() !== sessionId) {
            generation++;
            for (const c of active) c.abort();
          }
        } catch {
          auth.invalidate(false);
          generation++;
          for (const c of active) c.abort();
        }
      }
      if (timedOut) throw new AiError('TIMEOUT', 'ChatGPT request timed out.');
      if (disposed || epoch !== generation || controller.signal.aborted)
        throw new AiError('CANCELLED', 'ChatGPT request cancelled.');
    };
    return {
      signal: controller.signal,
      check,
      finish() {
        clearTimeout(timer);
        active.delete(controller);
        signal?.removeEventListener('abort', abort);
      },
    };
  }
  async function request(url: string, init: RequestInit, signal?: AbortSignal) {
    if (signal?.aborted)
      throw new AiError('CANCELLED', 'ChatGPT request cancelled.');
    try {
      let onAbort: (() => void) | undefined;
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () =>
          reject(new AiError('CANCELLED', 'ChatGPT request cancelled.'));
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      const pending = requestFetch(url, {
        ...init,
        signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      });
      let response: Response;
      try {
        response = await Promise.race([pending, aborted]);
      } finally {
        if (onAbort) signal?.removeEventListener('abort', onAbort);
      }
      if (signal?.aborted) {
        void response.body?.cancel();
        throw new AiError('CANCELLED', 'ChatGPT request cancelled.');
      }
      if (!response.ok) {
        void response.body?.cancel();
        throw httpError(response.status, response.headers.get('retry-after'));
      }
      return response;
    } catch (error) {
      if (error instanceof AiError) throw error;
      if (signal?.aborted)
        throw new AiError('CANCELLED', 'ChatGPT request cancelled.');
      throw new AiError(
        'NETWORK_ERROR',
        'Could not connect to ChatGPT. Check browser access and retry sign-in.',
      );
    }
  }
  const auth = new ChatGPTAuthorization(
    request,
    () => options.credentialStorage ?? globalThis.localStorage,
    () => options.oauthStorage ?? globalThis.sessionStorage,
    options.now,
  );
  let listening = false;
  const storageChanged = (event: StorageEvent) => {
    if (
      event.key !== CHATGPT_CREDENTIAL_KEY &&
      event.key !== CHATGPT_AUTHORITY_KEY &&
      event.key !== null
    )
      return;
    try {
      if (event.storageArea !== globalThis.localStorage || !auth.synchronize())
        return;
    } catch {
      auth.invalidate(false);
    }
    generation++;
    for (const c of active) c.abort();
  };
  const listen = () => {
    if (
      !listening &&
      !options.credentialStorage &&
      typeof window !== 'undefined'
    ) {
      window.addEventListener('storage', storageChanged);
      listening = true;
    }
  };
  async function run<T>(
    signal: AbortSignal | undefined,
    fn: (signal: AbortSignal) => Promise<T>,
    bindIdentity = true,
  ): Promise<T> {
    const op = operation(signal, bindIdentity);
    try {
      op.check();
      const result = await fn(op.signal);
      op.check();
      return result;
    } catch (error) {
      op.check();
      throw error;
    } finally {
      op.finish();
    }
  }
  function stop(remove: boolean) {
    generation++;
    for (const c of active) c.abort();
    auth.invalidate(remove);
  }
  const unsupported = async (): Promise<never> => {
    throw new AiError(
      'MODEL_UNSUPPORTED',
      'ChatGPT plan connection supports LLM only.',
    );
  };
  return {
    status: () => ({ connected: !disposed && auth.connected() }),
    restore() {
      aiInvariant(!disposed, 'DISPOSED', 'ChatGPT provider is disposed.');
      generation++;
      for (const c of active) c.abort();
      const result = auth.restore();
      listen();
      return result;
    },
    restoreCredential() {
      return { connected: this.restore() };
    },
    setKey() {
      throw new AiError('AUTH_INVALID', 'Use Continue with ChatGPT.');
    },
    disconnect: () => stop(true),
    dispose() {
      if (!disposed) {
        stop(false);
        disposed = true;
        if (listening) window.removeEventListener('storage', storageChanged);
      }
    },
    beginAuthorization: () => {
      listen();
      generation++;
      for (const c of active) c.abort();
      return run(undefined, () => auth.begin(), false);
    },
    completeAuthorization: (options, signal) =>
      run(
        signal,
        async (s) => {
          listen();
          await auth.complete(options.callbackUrl, s);
          return {
            connected: true,
            sanitizedCallbackUrl: 'http://127.0.0.1:1455/auth/callback',
          };
        },
        false,
      ),
    listSpeechModels: unsupported,
    synthesizeSpeech: unsupported,
    label: unsupported,
    listModels: (signal) =>
      run(signal, async (s) => {
        const token = await auth.accessToken(s);
        const response = await request(
          'https://api.openai.com/v1/models',
          { headers: { Authorization: `Bearer ${token}` } },
          s,
        );
        const value = await readJson(response, s);
        aiInvariant(
          !!value &&
            typeof value === 'object' &&
            'models' in value &&
            Array.isArray(value.models) &&
            value.models.length <= 20000,
          'INVALID_RESPONSE',
          'Invalid ChatGPT model catalog.',
        );
        return value.models
          .filter((m) => m && typeof m === 'object' && m.visibility === 'list')
          .map((m: { slug?: unknown; display_name?: unknown }) => {
            aiInvariant(
              typeof m.slug === 'string' &&
                /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(m.slug) &&
                typeof m.display_name === 'string' &&
                m.display_name.length <= 512,
              'INVALID_RESPONSE',
              'Invalid ChatGPT model.',
            );
            return {
              id: m.slug,
              name: m.display_name,
              contextLength: 128000,
              supportedParameters: ['tools', 'tool_choice'],
              supportsTools: true,
            };
          });
      }),
    async *stream(chat, signal) {
      const body = responsesBody(chat);
      const op = operation(signal);
      try {
        op.check();
        const token = await auth.accessToken(op.signal);
        const response = await request(
          'https://api.openai.com/v1/responses',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              Accept: 'text/event-stream',
            },
            body,
          },
          op.signal,
        );
        aiInvariant(
          response.headers.get('content-type')?.split(';')[0]?.trim() ===
            'text/event-stream',
          'INVALID_RESPONSE',
          'ChatGPT did not return an event stream.',
        );
        for await (const event of parseResponses(response, op.signal)) {
          op.check();
          yield event;
        }
        op.check();
      } catch (error) {
        op.check();
        throw error;
      } finally {
        op.finish();
      }
    },
  };
}
