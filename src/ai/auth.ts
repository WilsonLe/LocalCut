import { AiError, aiInvariant } from './errors.ts';
import type { AuthorizationOptions, AuthorizationStorage } from './types.ts';

export const OAUTH_STORAGE_KEY = 'localcut-openrouter-oauth-v1';
export const OAUTH_TTL_MS = 10 * 60 * 1000;
const reserved = ['code', 'state', 'error', 'error_description'];
interface PendingAuthorization {
  version: 1;
  callbackUrl: string;
  verifier: string;
  state: string;
  createdAt: number;
}
interface AuthorizationDependencies {
  storage?: AuthorizationStorage;
  now: () => number;
  assertActive: () => void;
  exchange: (
    code: string,
    verifier: string,
    signal?: AbortSignal,
  ) => Promise<string>;
  connect: (key: string) => void;
}
const invalid = () =>
  new AiError(
    'AUTH_FLOW_INVALID',
    'OpenRouter authorization could not be verified. Restart authorization.',
  );
function parseUrl(value: string): URL {
  try {
    aiInvariant(
      typeof value === 'string' && value.length <= 8192,
      'AUTH_FLOW_INVALID',
      'Invalid OAuth callback URL.',
    );
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw invalid();
    url.search = url.searchParams.toString();
    return url;
  } catch {
    throw invalid();
  }
}
function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}
function randomToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}
function isPending(value: unknown): value is PendingAuthorization {
  if (!value || typeof value !== 'object') return false;
  const pending = value as Partial<PendingAuthorization>;
  return (
    pending.version === 1 &&
    typeof pending.callbackUrl === 'string' &&
    typeof pending.verifier === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(pending.verifier) &&
    typeof pending.state === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(pending.state) &&
    typeof pending.createdAt === 'number' &&
    Number.isSafeInteger(pending.createdAt)
  );
}

/** Created lazily without touching storage. API keys never pass through this storage. */
export class AuthorizationFlow {
  private readonly stores = new Set<AuthorizationStorage>();
  private sequence = 0;
  constructor(private readonly dependencies: AuthorizationDependencies) {}
  private storage(explicit?: AuthorizationStorage): AuthorizationStorage {
    try {
      const storage =
        explicit ?? this.dependencies.storage ?? globalThis.sessionStorage;
      if (!storage) throw invalid();
      this.stores.add(storage);
      return storage;
    } catch {
      throw new AiError(
        'AUTH_FLOW_INVALID',
        'Session storage is unavailable for authorization.',
      );
    }
  }
  invalidate(): void {
    this.sequence++;
    // A fresh client after navigation has not yet registered its session store.
    // Resolve it only on explicit invalidation, never during construction.
    try {
      const storage = this.dependencies.storage ?? globalThis.sessionStorage;
      if (storage) this.stores.add(storage);
    } catch {
      /* Denied browser storage does not block in-memory disconnect. */
    }
    for (const storage of this.stores) {
      try {
        storage.removeItem(OAUTH_STORAGE_KEY);
      } catch {
        /* In-memory flow is still invalidated. */
      }
    }
  }
  async begin(
    options: AuthorizationOptions,
  ): Promise<{ authorizationUrl: string; expiresAt: number }> {
    this.dependencies.assertActive();
    const callback = parseUrl(options.callbackUrl);
    if (reserved.some((name) => callback.searchParams.has(name)))
      throw invalid();
    const storage = this.storage(options.storage);
    this.invalidate();
    const sequence = this.sequence;
    const verifier = randomToken();
    const state = randomToken();
    const challenge = base64Url(
      new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(verifier),
        ),
      ),
    );
    this.dependencies.assertActive();
    if (sequence !== this.sequence)
      throw new AiError('CANCELLED', 'Authorization was cancelled.');
    const createdAt = this.dependencies.now();
    try {
      storage.setItem(
        OAUTH_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          callbackUrl: callback.href,
          verifier,
          state,
          createdAt,
        } satisfies PendingAuthorization),
      );
    } catch {
      throw new AiError(
        'AUTH_FLOW_INVALID',
        'Session storage is unavailable for authorization.',
      );
    }
    const url = new URL('https://openrouter.ai/auth');
    url.searchParams.set('callback_url', callback.href);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    url.searchParams.set('key_label', 'LocalCut');
    return { authorizationUrl: url.href, expiresAt: createdAt + OAUTH_TTL_MS };
  }
  async complete(
    options: AuthorizationOptions,
    signal?: AbortSignal,
  ): Promise<{ connected: boolean; sanitizedCallbackUrl: string }> {
    this.dependencies.assertActive();
    const sequence = this.sequence;
    const storage = this.storage(options.storage);
    let pending: unknown;
    try {
      const raw = storage.getItem(OAUTH_STORAGE_KEY);
      storage.removeItem(OAUTH_STORAGE_KEY); // One use, including invalid callbacks and failed exchanges.
      pending = raw ? (JSON.parse(raw) as unknown) : undefined;
    } catch {
      throw invalid();
    }
    if (!isPending(pending)) throw invalid();
    const callback = parseUrl(options.callbackUrl);
    const base = new URL(callback.href);
    for (const name of reserved) base.searchParams.delete(name);
    if (base.href !== pending.callbackUrl) throw invalid();
    const age = this.dependencies.now() - pending.createdAt;
    if (age < 0 || age >= OAUTH_TTL_MS)
      throw new AiError(
        'AUTH_EXPIRED',
        'OpenRouter authorization expired. Restart authorization.',
      );
    if (callback.searchParams.has('error'))
      throw new AiError(
        'AUTH_CANCELLED',
        'OpenRouter authorization was declined.',
      );
    if (
      callback.searchParams.getAll('state').length !== 1 ||
      callback.searchParams.get('state') !== pending.state ||
      callback.searchParams.getAll('code').length !== 1
    )
      throw invalid();
    const code = callback.searchParams.get('code');
    if (
      !code ||
      code.length > 2048 ||
      /\s/.test(code) ||
      [...code].some((character) => character.charCodeAt(0) < 32)
    )
      throw invalid();
    if (signal?.aborted)
      throw new AiError('CANCELLED', 'Authorization was cancelled.');
    const key = await this.dependencies.exchange(
      code,
      pending.verifier,
      signal,
    );
    this.dependencies.assertActive();
    if (sequence !== this.sequence || signal?.aborted)
      throw new AiError('CANCELLED', 'Authorization was cancelled.');
    this.dependencies.connect(key);
    return { connected: true, sanitizedCallbackUrl: pending.callbackUrl };
  }
}
