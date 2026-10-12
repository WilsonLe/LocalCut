import {
  accountStorage,
  accountCredentialKey,
} from '../../src/workspace/provider-account-storage';
import type { ProviderProfile } from '../../src/workspace/provider-preferences';
import { describe, expect, it, vi } from 'vitest';
import {
  ChatGPTAuthorization,
  CHATGPT_CALLBACK,
  CHATGPT_CREDENTIAL_KEY,
} from '../../src/ai/chatgpt-auth';
import { createChatGPT } from '../../src/ai/chatgpt';
import { errorText } from '../../src/workspace/conversation-errors';
import { errorDiagnostic } from '../../src/core/error-diagnostics';
import type { AuthorizationStorage } from '../../src/ai';
const memory = (): AuthorizationStorage => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
  };
};
const b64 = (value: Uint8Array) => Buffer.from(value).toString('base64url');
async function setup(
  profile?: Pick<ProviderProfile, 'id' | 'kind'>,
  persistentRoot = memory(),
  temporaryRoot = memory(),
) {
  const persistent = profile
      ? accountStorage(profile, () => persistentRoot)
      : persistentRoot,
    temporary = profile
      ? accountStorage(profile, () => temporaryRoot)
      : temporaryRoot;
  let time = 1000000;
  const keys = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const jwk = {
    ...(await crypto.subtle.exportKey('jwk', keys.publicKey)),
    kid: 'test',
  };
  let nonce = '';
  let granted = true;
  let identity: Record<string, unknown> = {};
  const token = async () => {
    const header = b64(
      new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid: 'test' })),
    );
    const claims = b64(
      new TextEncoder().encode(
        JSON.stringify({
          iss: 'https://auth.openai.com',
          aud: 'oaiapp_test',
          sub: 'subject',
          exp: time / 1000 + 3600,
          nonce,
          ...identity,
        }),
      ),
    );
    const data = `${header}.${claims}`;
    return {
      access_token: 'synthetic-access-token',
      refresh_token: 'synthetic-refresh-token',
      id_token: `${data}.${b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(data))))}`,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: granted
        ? 'chatgpt.tokens.use.direct resource.invoke offline_access'
        : 'openid',
    };
  };
  const request = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async (url: string) =>
      url.endsWith('jwks.json')
        ? Response.json({ keys: [jwk] })
        : Response.json(await token()),
  );
  const auth = new ChatGPTAuthorization(
    request,
    () => persistent,
    () => temporary,
    () => time,
  );
  const begin = await auth.begin();
  const params = new URL(begin.authorizationUrl).searchParams;
  nonce = params.get('nonce')!;
  const callback = new URL(CHATGPT_CALLBACK);
  callback.searchParams.set('state', params.get('state')!);
  callback.searchParams.set('code', 'one-use-code');
  callback.searchParams.set('client_id', 'oaiapp_test');
  return {
    auth,
    request,
    persistent,
    temporary,
    params,
    callback,
    time: (v: number) => {
      time = v;
    },
    nonce: (v: string) => {
      nonce = v;
    },
    grant: (v: boolean) => {
      granted = v;
    },
    identity: (v: Record<string, unknown>) => {
      identity = v;
    },
  };
}
describe('ChatGPT OAuth', () => {
  it.each(['chatgpt_code_exchange', 'chatgpt_signing_keys'] as const)(
    'identifies blocked %s without exposing callback, tokens or fetch errors',
    async (stage) => {
      const s = await setup();
      const client = createChatGPT({
        credentialStorage: s.persistent,
        oauthStorage: s.temporary,
        now: () => 1000000,
        fetch: async (url, init) => {
          if (
            String(url).endsWith(
              stage === 'chatgpt_signing_keys' ? 'jwks.json' : '/token',
            )
          )
            throw new TypeError('private-code private-token private-url');
          return s.request(String(url), init);
        },
      });
      try {
        const begin = await client.beginAuthorization({ callbackUrl: '' });
        const params = new URL(begin.authorizationUrl).searchParams;
        s.nonce(params.get('nonce')!);
        const callback = new URL(CHATGPT_CALLBACK);
        callback.searchParams.set('state', params.get('state')!);
        callback.searchParams.set('code', 'private-code');
        callback.searchParams.set('client_id', 'oaiapp_test');
        const error = await client
          .completeAuthorization({ callbackUrl: callback.href })
          .catch((error: unknown) => error);
        expect(error).toMatchObject({
          code: 'NETWORK_ERROR',
          details: { stage },
        });
        expect(errorDiagnostic(error).details).toEqual({ stage });
        expect(errorText(error)).toContain(
          stage === 'chatgpt_signing_keys'
            ? 'signing keys'
            : 'authorization code',
        );
        expect(errorText(error)).toContain('cross-origin');
        expect(JSON.stringify(errorDiagnostic(error))).not.toMatch(
          /private-code|private-token|private-url|synthetic/,
        );
        expect(client.status().connected).toBe(false);
        expect(s.persistent.getItem(CHATGPT_CREDENTIAL_KEY)).toBeNull();
      } finally {
        client.dispose();
      }
    },
  );
  it.each([
    'chatgpt_models',
    'chatgpt_token_refresh',
    'chatgpt_response',
  ] as const)(
    'identifies blocked %s for a restored connection',
    async (stage) => {
      const s = await setup();
      await s.auth.complete(s.callback.href);
      if (stage === 'chatgpt_token_refresh') {
        const saved = JSON.parse(s.persistent.getItem(CHATGPT_CREDENTIAL_KEY)!);
        s.persistent.setItem(
          CHATGPT_CREDENTIAL_KEY,
          JSON.stringify({ ...saved, expiresAt: 1000000 }),
        );
      }
      const client = createChatGPT({
        credentialStorage: s.persistent,
        oauthStorage: memory(),
        now: () => 1000000,
        fetch: async () => {
          throw new TypeError('private-token');
        },
      });
      try {
        client.restore();
        const run = async () => {
          if (stage === 'chatgpt_response') {
            for await (const event of client.stream(
              {
                model: 'test',
                messages: [{ role: 'user', content: 'Hello' }],
                tools: [],
              },
              new AbortController().signal,
            ))
              void event;
          } else await client.listModels();
        };
        const error = await run().catch((error: unknown) => error);
        expect(error).toMatchObject({
          code: 'NETWORK_ERROR',
          details: { stage },
        });
        expect(errorText(error)).not.toContain('Start a new sign-in');
        expect(JSON.stringify(errorDiagnostic(error))).not.toContain(
          'private-token',
        );
      } finally {
        client.dispose();
      }
    },
  );

  it.each(['token_response', 'signature'] as const)(
    'reports %s without publishing credentials or leaking tokens',
    async (reason) => {
      const s = await setup();
      const original = s.request.getMockImplementation()!;
      s.request.mockImplementation(async (url, init) => {
        const response = await original(url, init);
        if (!url.endsWith('/token')) return response;
        const value = await response.json();
        if (reason === 'token_response') delete value.id_token;
        else {
          const parts = value.id_token.split('.');
          parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
          value.id_token = parts.join('.');
        }
        return Response.json(value);
      });
      const error = await s.auth
        .complete(s.callback.href)
        .catch((error: unknown) => error);
      expect(error).toMatchObject({
        code: 'AUTH_FLOW_INVALID',
        details: { stage: 'chatgpt_identity', reason },
      });
      expect(s.persistent.getItem(CHATGPT_CREDENTIAL_KEY)).toBeNull();
      expect(errorText(error)).not.toMatch(/synthetic|one-use-code/);
    },
  );
  it('accepts a signed singleton audience array without an optional authorized party', async () => {
    const s = await setup();
    s.identity({ aud: ['oaiapp_test'] });
    await s.auth.complete(s.callback.href);
    expect(s.auth.connected()).toBe(true);
    expect(s.persistent.getItem(CHATGPT_CREDENTIAL_KEY)).not.toBeNull();
    expect(
      s.request.mock.calls.some(([url]) => url.endsWith('jwks.json')),
    ).toBe(true);
  });
  it.each([
    { aud: 'oaiapp_test', azp: 'oaiapp_test' },
    { aud: ['oaiapp_test'], azp: 'oaiapp_test' },
    { aud: ['oaiapp_test', 'other-audience'], azp: 'oaiapp_test' },
  ])('accepts the existing authorized audience forms: %j', async (claims) => {
    const s = await setup();
    s.identity(claims);
    await s.auth.complete(s.callback.href);
    expect(s.auth.connected()).toBe(true);
  });
  it.each([
    [{ aud: ['other-client'] }, 'audience'],
    [{ aud: [] }, 'audience'],
    [{ aud: ['oaiapp_test', 42], azp: 'oaiapp_test' }, 'audience'],
    [{ aud: ['oaiapp_test', 'other-audience'] }, 'audience'],
    [{ aud: ['oaiapp_test'], azp: 'other-client' }, 'audience'],
    [{ aud: 'oaiapp_test', azp: 'other-client' }, 'audience'],
    [{ iss: 'https://wrong-issuer.example' }, 'issuer'],
    [{ exp: 1000 }, 'token_expired'],
    [{ nbf: 1061 }, 'token_not_yet_valid'],
    [{ nbf: '1000' }, 'token_format'],
    [{ nonce: 'private-wrong-nonce' }, 'nonce'],
    [{ sub: '' }, 'subject'],
  ] as const)(
    'rejects signed identity %j with safe reason %s',
    async (claims, reason) => {
      const s = await setup();
      s.identity(claims);
      const error = await s.auth
        .complete(s.callback.href)
        .catch((error: unknown) => error);
      expect(error).toMatchObject({
        code: 'AUTH_FLOW_INVALID',
        details: { stage: 'chatgpt_identity', reason },
      });
      expect(errorDiagnostic(error).details).toEqual({
        stage: 'chatgpt_identity',
        reason,
      });
      expect(errorText(error)).toContain('ChatGPT');
      expect(errorText(error)).not.toContain('link is invalid');
      expect(JSON.stringify(errorDiagnostic(error))).not.toMatch(
        /synthetic-access-token|private-wrong-nonce|wrong-issuer\.example|other-client/,
      );
      expect(s.auth.connected()).toBe(false);
      expect(s.persistent.getItem(CHATGPT_CREDENTIAL_KEY)).toBeNull();
    },
  );
  it('isolates multiple accounts pending state, signed tokens, restore and disconnect authority', async () => {
    const persistent = memory(),
      temporary = memory();
    const primary = { id: 'chatgpt', kind: 'chatgpt' as const };
    const secondary = { id: 'chatgpt-work', kind: 'chatgpt' as const };
    const a = await setup(primary, persistent, temporary);
    const b = await setup(secondary, persistent, temporary);
    expect(a.params.get('state')).not.toBe(b.params.get('state'));
    await a.auth.complete(a.callback.href);
    await b.auth.complete(b.callback.href);
    expect(persistent.getItem(accountCredentialKey(primary))).not.toBeNull();
    const secondTokens = persistent.getItem(accountCredentialKey(secondary));
    expect(secondTokens).not.toBeNull();
    a.auth.invalidate(true);
    expect(persistent.getItem(accountCredentialKey(primary))).toBeNull();
    expect(persistent.getItem(accountCredentialKey(secondary))).toBe(
      secondTokens,
    );
    expect(b.auth.connected()).toBe(true);
    expect(b.auth.restore()).toBe(true);
    expect(await b.auth.accessToken(new AbortController().signal)).toBe(
      'synthetic-access-token',
    );
    b.auth.invalidate(true);
    expect(persistent.getItem(accountCredentialKey(secondary))).toBeNull();
  });

  it('has no default ChatGPT inference timeout and cancels the active stream', async () => {
    const s = await setup();
    await s.auth.complete(s.callback.href);
    vi.useFakeTimers();
    let cancelled = false;
    const client = createChatGPT({
      credentialStorage: s.persistent,
      oauthStorage: memory(),
      now: () => 1000000,
      fetch: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    });
    client.restore();
    const controller = new AbortController();
    try {
      const pending = (async () => {
        for await (const event of client.stream(
          {
            model: 'model',
            messages: [{ role: 'user', content: 'Hello' }],
            tools: [],
          },
          controller.signal,
        ))
          void event;
      })();
      let settled = false;
      void pending.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await vi.advanceTimersByTimeAsync(600001);
      expect(settled).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      controller.abort();
      await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
      expect(cancelled).toBe(true);
    } finally {
      controller.abort();
      client.dispose();
      vi.useRealTimers();
    }
  });
  it('is inert and generates independent PKCE, state and nonce with the public dynamic registration flow', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const c = createChatGPT({ fetch });
    expect(fetch).not.toHaveBeenCalled();
    expect(c.status()).toEqual({ connected: false });
    c.dispose();
    const s = await setup();
    expect(s.request).not.toHaveBeenCalled();
    expect(s.params.get('client_id')).toBe('dynamic_agent_client');
    expect(s.params.get('redirect_uri')).toBe(CHATGPT_CALLBACK);
    expect(s.params.get('code_challenge')).toHaveLength(43);
    expect(s.params.get('agent_name_hint')).toBe('LocalCut');
  });
  it('exchanges the pasted code, validates signed identity and saves only tokens; restores and refreshes after reload', async () => {
    const s = await setup();
    await s.auth.complete(s.callback.href);
    const stored = s.persistent.getItem(CHATGPT_CREDENTIAL_KEY)!;
    expect(stored).not.toContain('one-use-code');
    expect(stored).not.toContain('code_verifier');
    expect(s.auth.connected()).toBe(true);
    const fields = new URLSearchParams(
      String(s.request.mock.calls[0]?.[1]?.body),
    );
    expect(fields.get('client_id')).toBe('oaiapp_test');
    expect(fields.get('redirect_uri')).toBe(CHATGPT_CALLBACK);
    await expect(s.auth.complete(s.callback.href)).rejects.toMatchObject({
      code: 'AUTH_FLOW_INVALID',
    });
    const restored = new ChatGPTAuthorization(
      s.request,
      () => s.persistent,
      () => s.temporary,
      () => 5000000,
    );
    expect(restored.restore()).toBe(true);
    s.time(5000000);
    expect(await restored.accessToken(new AbortController().signal)).toBe(
      'synthetic-access-token',
    );
    expect(
      s.request.mock.calls.filter((c) => c[0].endsWith('/token')),
    ).toHaveLength(2);
    restored.invalidate(false);
    expect(s.persistent.getItem(CHATGPT_CREDENTIAL_KEY)).not.toBeNull();
    restored.invalidate(true);
    expect(s.persistent.getItem(CHATGPT_CREDENTIAL_KEY)).toBeNull();
  });
  it('rejects state, duplicate code, wrong callback, missing issued client ID and expired sign-ins without exchange', async () => {
    for (const mutate of [
      (u: URL) => u.searchParams.set('state', 'wrong'),
      (u: URL) => u.searchParams.append('code', 'duplicate'),
      (u: URL) => {
        u.hostname = 'localhost';
      },
      (u: URL) => u.searchParams.delete('client_id'),
    ]) {
      const s = await setup();
      mutate(s.callback);
      await expect(s.auth.complete(s.callback.href)).rejects.toMatchObject({
        code: 'AUTH_FLOW_INVALID',
      });
      expect(s.request).not.toHaveBeenCalled();
      expect(s.auth.connected()).toBe(false);
    }
    const s = await setup();
    s.time(1600000);
    await expect(s.auth.complete(s.callback.href)).rejects.toThrow();
    expect(s.request).not.toHaveBeenCalled();
  });
  it('rejects wrong signed nonce, denied plan scope and invalid signatures without persisting credentials', async () => {
    for (const kind of ['nonce', 'scope', 'signature']) {
      const s = await setup();
      if (kind === 'nonce') s.nonce('wrong');
      if (kind === 'scope') s.grant(false);
      if (kind === 'signature') {
        const original = s.request.getMockImplementation()!;
        s.request.mockImplementation(async (url: string) =>
          url.endsWith('jwks.json')
            ? Response.json({ keys: [] })
            : original(url),
        );
      }
      await expect(s.auth.complete(s.callback.href)).rejects.toThrow();
      expect(s.persistent.getItem(CHATGPT_CREDENTIAL_KEY)).toBeNull();
    }
  });
  it('a disconnect while exchanging cannot republish credentials', async () => {
    const s = await setup();
    const original = s.request.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    s.request.mockImplementation(async (url) => {
      if (url.endsWith('/token')) await gate;
      return original(url);
    });
    const pending = s.auth.complete(s.callback.href);
    s.auth.invalidate(true);
    release();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(s.persistent.getItem(CHATGPT_CREDENTIAL_KEY)).toBeNull();
  });
});

describe('durable ChatGPT session authority', () => {
  it('synchronizes rotated tokens without retiring work and immediately cancels a replaced session', async () => {
    const s = await setup();
    await s.auth.complete(s.callback.href);
    let release!: (response: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>(
      () => new Promise<Response>((resolve) => (release = resolve)),
    );
    const client = createChatGPT({
      fetch,
      credentialStorage: s.persistent,
      oauthStorage: memory(),
      now: () => 1000000,
    });
    client.restore();
    const catalog = {
      models: [{ slug: 'model', display_name: 'Model', visibility: 'list' }],
    };
    const pending = client.listModels();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const saved = JSON.parse(s.persistent.getItem(CHATGPT_CREDENTIAL_KEY)!);
    s.persistent.setItem(
      CHATGPT_CREDENTIAL_KEY,
      JSON.stringify({ ...saved, accessToken: 'rotated-token' }),
    );
    expect(client.synchronize()).toBe(false);
    expect(client.status().connected).toBe(true);
    release(Response.json(catalog));
    await expect(pending).resolves.toMatchObject([{ id: 'model' }]);
    const replaced = client.listModels();
    const rejected = expect(replaced).rejects.toMatchObject({
      code: 'CANCELLED',
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(
      new Headers(fetch.mock.calls[1]![1]?.headers).get('authorization'),
    ).toBe('Bearer rotated-token');
    s.persistent.setItem(
      CHATGPT_CREDENTIAL_KEY,
      JSON.stringify({ ...saved, sessionId: 'replacement-session' }),
    );
    expect(client.synchronize()).toBe(true);
    await rejected;
    expect(client.status().connected).toBe(false);
    release(Response.json(catalog));
    client.dispose();
  });
  it('rejects replacement credentials before a storage event and cancels late catalog publication', async () => {
    const s = await setup();
    await s.auth.complete(s.callback.href);
    let release!: (r: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const client = createChatGPT({
      fetch,
      credentialStorage: s.persistent,
      oauthStorage: memory(),
      now: () => 1000000,
    });
    client.restore();
    const pending = client.listModels();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const replacement = {
      ...JSON.parse(s.persistent.getItem(CHATGPT_CREDENTIAL_KEY)!),
      sessionId: 'new-session',
      accessToken: 'replacement-token',
    };
    s.persistent.setItem(CHATGPT_CREDENTIAL_KEY, JSON.stringify(replacement));
    release(
      Response.json({
        models: [{ slug: 'model', display_name: 'Model', visibility: 'list' }],
      }),
    );
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(client.status().connected).toBe(false);
    client.dispose();
    const old = new ChatGPTAuthorization(
      s.request,
      () => s.persistent,
      memory,
      () => 1000000,
    );
    old.restore();
    s.persistent.setItem(
      CHATGPT_CREDENTIAL_KEY,
      JSON.stringify({ ...replacement, sessionId: 'third-session' }),
    );
    await expect(
      old.accessToken(new AbortController().signal),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(old.connected()).toBe(false);
  });
  it('rejects a delayed earlier sign-in after another tab commits credentials', async () => {
    const s = await setup();
    const secondTemporary = memory();
    const second = new ChatGPTAuthorization(
      s.request,
      () => s.persistent,
      () => secondTemporary,
      () => 1000000,
    );
    const start = await second.begin();
    const params = new URL(start.authorizationUrl).searchParams;
    const callback = new URL(CHATGPT_CALLBACK);
    callback.searchParams.set('code', 'second-code');
    callback.searchParams.set('state', params.get('state')!);
    callback.searchParams.set('client_id', 'oaiapp_test');
    const original = s.request.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    s.request.mockImplementation(async (url, init) => {
      if (
        url.endsWith('/token') &&
        new URLSearchParams(String(init?.body)).get('code') === 'one-use-code'
      )
        await gate;
      return original(url, init);
    });
    const first = s.auth.complete(s.callback.href);
    s.nonce(params.get('nonce')!);
    await second.complete(callback.href);
    const winner = s.persistent.getItem(CHATGPT_CREDENTIAL_KEY);
    s.nonce(s.params.get('nonce')!);
    release();
    await expect(first).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(s.persistent.getItem(CHATGPT_CREDENTIAL_KEY)).toBe(winner);
  });
  it('external disconnect invalidates an in-flight fresh exchange and same-session rotation stays usable', async () => {
    const s = await setup();
    const original = s.request.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    s.request.mockImplementation(async (url, init) => {
      if (url.endsWith('/token')) await gate;
      return original(url, init);
    });
    const pending = s.auth.complete(s.callback.href);
    const other = new ChatGPTAuthorization(
      s.request,
      () => s.persistent,
      memory,
      () => 1000000,
    );
    other.invalidate(true);
    release();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(s.persistent.getItem(CHATGPT_CREDENTIAL_KEY)).toBeNull();
    const ready = await setup();
    await ready.auth.complete(ready.callback.href);
    const saved = JSON.parse(ready.persistent.getItem(CHATGPT_CREDENTIAL_KEY)!);
    ready.persistent.setItem(
      CHATGPT_CREDENTIAL_KEY,
      JSON.stringify({ ...saved, accessToken: 'rotated-within-session' }),
    );
    expect(await ready.auth.accessToken(new AbortController().signal)).toBe(
      'rotated-within-session',
    );
  });
});
