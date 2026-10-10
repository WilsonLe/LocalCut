import { describe, expect, it, vi } from 'vitest';
import {
  ChatGPTAuthorization,
  CHATGPT_CALLBACK,
  CHATGPT_CREDENTIAL_KEY,
} from '../../src/ai/chatgpt-auth';
import { createChatGPT } from '../../src/ai/chatgpt';
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
async function setup() {
  const persistent = memory(),
    temporary = memory();
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
  };
}
describe('ChatGPT OAuth', () => {
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
