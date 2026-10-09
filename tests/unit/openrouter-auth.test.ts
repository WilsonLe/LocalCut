import { describe, expect, it, vi } from 'vitest';
import { createOpenRouter } from '../../src/ai/openrouter.ts';
import { OAUTH_STORAGE_KEY, OAUTH_TTL_MS } from '../../src/ai/auth.ts';
import type { AuthorizationStorage } from '../../src/ai/types.ts';

function storage(): AuthorizationStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}
const callback = 'https://wilsonle.github.io/LocalCut/?workspace=one';
function returned(url: string, target = callback) {
  const actual = new URL(target);
  actual.searchParams.set('code', 'authorization-code');
  actual.searchParams.set('state', new URL(url).searchParams.get('state')!);
  return actual.href;
}

describe('OpenRouter explicit PKCE authorization', () => {
  it('generates S256, stores only expiring state/verifier, exchanges once and keeps the key in memory', async () => {
    const store = storage();
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ key: 'test-key-private' }),
    );
    const client = createOpenRouter({
      fetch,
      oauthStorage: store,
      now: () => 1000,
    });
    expect(store.values.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    const { authorizationUrl, expiresAt } = await client.beginAuthorization({
      callbackUrl: callback,
    });
    expect(fetch).not.toHaveBeenCalled();
    const url = new URL(authorizationUrl);
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth');
    expect(url.searchParams.get('callback_url')).toBe(callback);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(expiresAt).toBe(1000 + OAUTH_TTL_MS);
    const stored = JSON.parse(store.values.get(OAUTH_STORAGE_KEY)!) as {
      verifier: string;
      state: string;
    };
    const hash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(stored.verifier),
    );
    expect(url.searchParams.get('code_challenge')).toBe(
      Buffer.from(hash).toString('base64url'),
    );
    expect(stored.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.values.size).toBe(1);
    const result = await client.completeAuthorization({
      callbackUrl: returned(authorizationUrl),
    });
    expect(result).toEqual({ connected: true, sanitizedCallbackUrl: callback });
    expect(store.values.size).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetch.mock.calls[0]!;
    expect(endpoint).toBe('https://openrouter.ai/api/v1/auth/keys');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    expect(JSON.parse(String(init!.body))).toEqual({
      code: 'authorization-code',
      code_verifier: stored.verifier,
      code_challenge_method: 'S256',
    });
    await expect(
      client.completeAuthorization({ callbackUrl: returned(authorizationUrl) }),
    ).rejects.toMatchObject({ code: 'AUTH_FLOW_INVALID' });
    expect(JSON.stringify(client.status())).not.toContain('private');
  });
  it('resumes after reload from same tab session storage and returns a clean callback URL', async () => {
    const store = storage();
    const first = createOpenRouter({ oauthStorage: store });
    const { authorizationUrl } = await first.beginAuthorization({
      callbackUrl: 'http://localhost:5173/?a=one%20two',
    });
    const second = createOpenRouter({
      oauthStorage: store,
      fetch: async () => Response.json({ key: 'test-key-private' }),
    });
    const actual = returned(
      authorizationUrl,
      'http://localhost:5173/?a=one%20two',
    );
    expect(await second.completeAuthorization({ callbackUrl: actual })).toEqual(
      {
        connected: true,
        sanitizedCallbackUrl: 'http://localhost:5173/?a=one+two',
      },
    );
    expect(first.status()).toEqual({ connected: false });
  });
  it.each([
    'http://example.com/callback',
    'https://user:pass@example.com/callback',
    'https://example.com/callback#fragment',
    'javascript:alert(1)',
    '/relative',
    'https://example.com/?code=old',
    'https://example.com/?state=old',
  ])('rejects unsafe or ambiguous callback %s', async (callbackUrl) => {
    const client = createOpenRouter({ oauthStorage: storage() });
    await expect(
      client.beginAuthorization({ callbackUrl }),
    ).rejects.toMatchObject({ code: 'AUTH_FLOW_INVALID' });
  });
  it.each([
    'https://other.test/LocalCut/?workspace=one',
    'https://wilsonle.github.io/Other/?workspace=one',
    'https://wilsonle.github.io/LocalCut/?workspace=two',
    'https://wilsonle.github.io/LocalCut/?workspace=one&extra=value',
  ])('requires matching origin/path/query on return %s', async (target) => {
    const store = storage();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = createOpenRouter({ oauthStorage: store, fetch });
    const { authorizationUrl } = await client.beginAuthorization({
      callbackUrl: callback,
    });
    await expect(
      client.completeAuthorization({
        callbackUrl: returned(authorizationUrl, target),
      }),
    ).rejects.toMatchObject({ code: 'AUTH_FLOW_INVALID' });
    expect(fetch).not.toHaveBeenCalled();
    expect(store.values.size).toBe(0);
  });
  it.each([
    'missing-state',
    'wrong-state',
    'duplicate-state',
    'missing-code',
    'duplicate-code',
    'empty-code',
    'fragment',
  ])('rejects %s and consumes the attempted flow', async (variant) => {
    const store = storage();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = createOpenRouter({ oauthStorage: store, fetch });
    const { authorizationUrl } = await client.beginAuthorization({
      callbackUrl: callback,
    });
    const actual = new URL(returned(authorizationUrl));
    if (variant === 'missing-state') actual.searchParams.delete('state');
    if (variant === 'wrong-state') actual.searchParams.set('state', 'wrong');
    if (variant === 'duplicate-state')
      actual.searchParams.append('state', actual.searchParams.get('state')!);
    if (variant === 'missing-code') actual.searchParams.delete('code');
    if (variant === 'duplicate-code')
      actual.searchParams.append('code', 'another');
    if (variant === 'empty-code') actual.searchParams.set('code', '');
    if (variant === 'fragment') actual.hash = 'fragment';
    await expect(
      client.completeAuthorization({ callbackUrl: actual.href }),
    ).rejects.toMatchObject({ code: 'AUTH_FLOW_INVALID' });
    expect(fetch).not.toHaveBeenCalled();
    expect(store.values.size).toBe(0);
  });
  it('handles denial without a state and never propagates error_description', async () => {
    const store = storage();
    const client = createOpenRouter({ oauthStorage: store });
    await client.beginAuthorization({ callbackUrl: callback });
    await expect(
      client.completeAuthorization({
        callbackUrl: callback + '&error=access_denied&error_description=SECRET',
      }),
    ).rejects.toThrow(
      expect.objectContaining({
        code: 'AUTH_CANCELLED',
        message: 'OpenRouter authorization was declined.',
      }),
    );
    expect(client.status()).toEqual({ connected: false });
  });
  it.each([OAUTH_TTL_MS, OAUTH_TTL_MS + 1, -1])(
    'rejects expired or clock-reversed state %#',
    async (offset) => {
      let now = 10_000;
      const client = createOpenRouter({
        oauthStorage: storage(),
        now: () => now,
      });
      const { authorizationUrl } = await client.beginAuthorization({
        callbackUrl: callback,
      });
      now += offset;
      await expect(
        client.completeAuthorization({
          callbackUrl: returned(authorizationUrl),
        }),
      ).rejects.toMatchObject({ code: 'AUTH_EXPIRED' });
    },
  );
  it('rejects malformed stored state and unavailable storage without leaking details', async () => {
    const store = storage();
    store.setItem(OAUTH_STORAGE_KEY, '{broken');
    const client = createOpenRouter({ oauthStorage: store });
    await expect(
      client.completeAuthorization({ callbackUrl: callback }),
    ).rejects.toMatchObject({ code: 'AUTH_FLOW_INVALID' });
    const broken = {
      getItem() {
        throw new Error('SECRET');
      },
      setItem() {
        throw new Error('SECRET');
      },
      removeItem() {
        throw new Error('SECRET');
      },
    };
    await expect(
      client.beginAuthorization({ callbackUrl: callback, storage: broken }),
    ).rejects.toThrow('Session storage is unavailable');
  });
  it('invalidates old flows when a new authorization begins or disconnect happens', async () => {
    const store = storage();
    const client = createOpenRouter({ oauthStorage: store });
    const first = await client.beginAuthorization({ callbackUrl: callback });
    await client.beginAuthorization({ callbackUrl: callback });
    await expect(
      client.completeAuthorization({
        callbackUrl: returned(first.authorizationUrl),
      }),
    ).rejects.toMatchObject({ code: 'AUTH_FLOW_INVALID' });
    await client.beginAuthorization({ callbackUrl: callback });
    client.disconnect();
    expect(store.values.size).toBe(0);
  });
  it.each(['disconnect', 'setKey', 'dispose'] as const)(
    'cannot reconnect after %s during code exchange',
    async (action) => {
      const store = storage();
      let resolve!: (response: Response) => void;
      const fetch: typeof globalThis.fetch = async () =>
        new Promise((done) => {
          resolve = done;
        });
      const client = createOpenRouter({ oauthStorage: store, fetch });
      const { authorizationUrl } = await client.beginAuthorization({
        callbackUrl: callback,
      });
      const pending = client.completeAuthorization({
        callbackUrl: returned(authorizationUrl),
      });
      if (action === 'setKey') client.setKey('new-key-private');
      else client[action]();
      resolve(Response.json({ key: 'old-key-private' }));
      await expect(pending).rejects.toMatchObject({
        code: action === 'dispose' ? 'DISPOSED' : 'CANCELLED',
      });
      expect(client.status()).toEqual({ connected: action === 'setKey' });
    },
  );
  it('aborts exchange explicitly and does not persist a failed or malformed response', async () => {
    const store = storage();
    const client = createOpenRouter({
      oauthStorage: store,
      fetch: async () => Response.json({ key: 'bad' }),
    });
    const flow = await client.beginAuthorization({ callbackUrl: callback });
    await expect(
      client.completeAuthorization({
        callbackUrl: returned(flow.authorizationUrl),
      }),
    ).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    expect(store.values.size).toBe(0);
    expect(client.status().connected).toBe(false);
    const second = await client.beginAuthorization({ callbackUrl: callback });
    const abort = new AbortController();
    abort.abort();
    await expect(
      client.completeAuthorization(
        { callbackUrl: returned(second.authorizationUrl) },
        abort.signal,
      ),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });
  it('does not modify unrelated storage or ambient browser history', async () => {
    const store = storage();
    store.setItem('other-app', 'keep');
    const client = createOpenRouter({ oauthStorage: store });
    await client.beginAuthorization({ callbackUrl: callback });
    client.dispose();
    expect([...store.values]).toEqual([['other-app', 'keep']]);
  });
  it.each(['disconnect', 'setKey'] as const)(
    'clears a previous instance flow on fresh-client %s',
    async (action) => {
      const store = storage();
      store.setItem('unrelated', 'keep');
      const first = createOpenRouter({ oauthStorage: store });
      const flow = await first.beginAuthorization({ callbackUrl: callback });
      const fetch = vi.fn<typeof globalThis.fetch>();
      const fresh = createOpenRouter({ oauthStorage: store, fetch });
      expect(store.getItem(OAUTH_STORAGE_KEY)).not.toBeNull();
      if (action === 'setKey') fresh.setKey('replacement-key');
      else fresh.disconnect();
      await expect(
        fresh.completeAuthorization({
          callbackUrl: returned(flow.authorizationUrl),
        }),
      ).rejects.toMatchObject({ code: 'AUTH_FLOW_INVALID' });
      expect(fetch).not.toHaveBeenCalled();
      expect(store.getItem('unrelated')).toBe('keep');
      expect(store.getItem(OAUTH_STORAGE_KEY)).toBeNull();
    },
  );
  it('clears an unregistered default session store only on an explicit operation', async () => {
    const store = storage();
    store.setItem('unrelated', 'keep');
    const original = Object.getOwnPropertyDescriptor(
      globalThis,
      'sessionStorage',
    );
    let accesses = 0;
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        accesses++;
        return store;
      },
    });
    try {
      const first = createOpenRouter();
      expect(accesses).toBe(0);
      const flow = await first.beginAuthorization({ callbackUrl: callback });
      const before = accesses;
      const fetch = vi.fn<typeof globalThis.fetch>();
      const fresh = createOpenRouter({ fetch });
      expect(accesses).toBe(before);
      fresh.disconnect();
      expect(accesses).toBeGreaterThan(before);
      await expect(
        fresh.completeAuthorization({
          callbackUrl: returned(flow.authorizationUrl),
        }),
      ).rejects.toMatchObject({ code: 'AUTH_FLOW_INVALID' });
      expect(fetch).not.toHaveBeenCalled();
      expect(store.getItem('unrelated')).toBe('keep');
    } finally {
      if (original)
        Object.defineProperty(globalThis, 'sessionStorage', original);
      else Reflect.deleteProperty(globalThis, 'sessionStorage');
    }
  });
  it('keeps disconnect and key replacement safe when default storage is denied', () => {
    const original = Object.getOwnPropertyDescriptor(
      globalThis,
      'sessionStorage',
    );
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('denied SECRET');
      },
    });
    try {
      const fresh = createOpenRouter();
      expect(() => fresh.disconnect()).not.toThrow();
      expect(() => fresh.setKey('replacement-key')).not.toThrow();
      expect(fresh.status()).toEqual({ connected: true });
      fresh.dispose();
    } finally {
      if (original)
        Object.defineProperty(globalThis, 'sessionStorage', original);
      else Reflect.deleteProperty(globalThis, 'sessionStorage');
    }
  });
});
