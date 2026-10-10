import { AiError, aiInvariant } from './errors';
import { readJson } from './protocol';
import type { AuthorizationStorage } from './types';

export const CHATGPT_CREDENTIAL_KEY = 'localcut.chatgpt-credentials.v1';
const PENDING = 'localcut.chatgpt-pkce.v1';
const HOST = 'localcut.chatgpt-host.v1';
const ISSUER = 'https://auth.openai.com';
const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
export const CHATGPT_CALLBACK = 'http://127.0.0.1:1455/auth/callback';
interface Pending {
  verifier: string;
  state: string;
  nonce: string;
  created: number;
  clientId: string;
  subject?: string;
}
interface Credential {
  version: 1;
  clientId: string;
  subject: string;
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number;
  scopes: string[];
  sessionId: string;
}
const invalid = () =>
  new AiError(
    'AUTH_FLOW_INVALID',
    'ChatGPT sign-in could not be verified. Start sign-in again.',
  );
const bytes = (value: string) =>
  Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
    c.charCodeAt(0),
  );
const encode = (value: Uint8Array) =>
  btoa(String.fromCharCode(...value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function storedCredential(storage: AuthorizationStorage): Credential | null {
  try {
    const c: unknown = JSON.parse(
      storage.getItem(CHATGPT_CREDENTIAL_KEY) ?? 'null',
    );
    if (
      !object(c) ||
      c.version !== 1 ||
      !['clientId', 'subject', 'accessToken', 'refreshToken', 'idToken'].every(
        (k) =>
          typeof c[k] === 'string' &&
          (c[k] as string).length > 0 &&
          (c[k] as string).length <= 20000,
      ) ||
      typeof c.sessionId !== 'string' ||
      c.sessionId.length > 80 ||
      c.clientId === 'dynamic_agent_client' ||
      typeof c.expiresAt !== 'number' ||
      !Number.isSafeInteger(c.expiresAt) ||
      !Array.isArray(c.scopes) ||
      !c.scopes.includes('chatgpt.tokens.use.direct')
    )
      return null;
    return c as unknown as Credential;
  } catch {
    throw new AiError(
      'AUTH_INVALID',
      'ChatGPT credentials could not be read. Reconnect or disconnect.',
    );
  }
}

/** Stores tokens in a dedicated browser record, never the callback code or portable preferences. */
export class ChatGPTAuthorization {
  private credential: Credential | null = null;
  private generation = 0;
  constructor(
    private readonly request: (
      url: string,
      init: RequestInit,
      signal?: AbortSignal,
    ) => Promise<Response>,
    private readonly persistent: () => AuthorizationStorage,
    private readonly temporary: () => AuthorizationStorage,
    private readonly now = Date.now,
  ) {}
  connected() {
    return this.credential !== null;
  }
  restore() {
    this.credential = storedCredential(this.persistent());
    return this.connected();
  }
  invalidate(remove: boolean) {
    this.generation++;
    this.credential = null;
    try {
      this.temporary().removeItem(PENDING);
    } catch {
      /* No pending browser flow during inert disposal. */
    }
    if (remove) this.persistent().removeItem(CHATGPT_CREDENTIAL_KEY);
  }
  async begin() {
    const epoch = ++this.generation;
    const storage = this.persistent();
    let host = storage.getItem(HOST);
    if (!host || !/^urn:uuid:[a-f0-9-]{36}$/.test(host)) {
      host = `urn:uuid:${crypto.randomUUID()}`;
      storage.setItem(HOST, host);
    }
    const old = this.credential ?? storedCredential(storage);
    const pending: Pending = {
      verifier: random(),
      state: random(),
      nonce: random(),
      created: this.now(),
      clientId: old?.clientId ?? 'dynamic_agent_client',
      ...(old ? { subject: old.subject } : {}),
    };
    const challenge = encode(
      new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(pending.verifier),
        ),
      ),
    );
    if (epoch !== this.generation)
      throw new AiError('CANCELLED', 'Sign-in cancelled.');
    this.temporary().setItem(PENDING, JSON.stringify(pending));
    const url = new URL(`${ISSUER}/api/accounts/authorize`);
    for (const [key, value] of Object.entries({
      client_id: pending.clientId,
      ext_agent_host_id: host,
      response_type: 'code',
      redirect_uri: CHATGPT_CALLBACK,
      scope:
        'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
      resource: 'https://api.openai.com/v1',
      state: pending.state,
      nonce: pending.nonce,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      ...(old ? {} : { agent_name_hint: 'LocalCut' }),
    }))
      url.searchParams.set(key, value);
    return { authorizationUrl: url.href, expiresAt: pending.created + 600000 };
  }
  async complete(callbackUrl: string, signal?: AbortSignal) {
    const epoch = this.generation;
    const temporary = this.temporary();
    let pending: Pending;
    try {
      const raw = temporary.getItem(PENDING);
      temporary.removeItem(PENDING);
      pending = JSON.parse(raw ?? 'null') as Pending;
      if (
        !pending ||
        !['state', 'nonce', 'verifier', 'clientId'].every(
          (k) => typeof pending[k as keyof Pending] === 'string',
        ) ||
        !Number.isSafeInteger(pending.created)
      )
        throw invalid();
      if (callbackUrl.length > 8192) throw invalid();
      const url = new URL(callbackUrl);
      if (
        url.origin + url.pathname !== CHATGPT_CALLBACK ||
        url.hash ||
        url.username ||
        url.password ||
        url.searchParams.getAll('state').length !== 1 ||
        url.searchParams.get('state') !== pending.state ||
        this.now() - pending.created < 0 ||
        this.now() - pending.created >= 600000
      )
        throw invalid();
      if (url.searchParams.has('error'))
        throw new AiError('AUTH_CANCELLED', 'ChatGPT sign-in was declined.');
      const clientId = url.searchParams.get('client_id') ?? pending.clientId;
      if (
        !/^[A-Za-z0-9_-]{1,256}$/.test(clientId) ||
        clientId === 'dynamic_agent_client' ||
        url.searchParams.getAll('client_id').length > 1 ||
        (pending.clientId !== 'dynamic_agent_client' &&
          clientId !== pending.clientId)
      )
        throw invalid();
      const code = url.searchParams.get('code');
      if (
        url.searchParams.getAll('code').length !== 1 ||
        !code ||
        !/^[\x21-\x7e]{1,2048}$/.test(code)
      )
        throw invalid();
      const result = await this.exchange(
        {
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          code_verifier: pending.verifier,
          redirect_uri: CHATGPT_CALLBACK,
          resource: 'https://api.openai.com/v1',
        },
        signal,
      );
      const credential = await this.validate(
        result,
        clientId,
        pending.nonce,
        signal,
      );
      if (pending.subject && credential.subject !== pending.subject)
        throw invalid();
      if (signal?.aborted || epoch !== this.generation)
        throw new AiError('CANCELLED', 'Sign-in cancelled.');
      this.save(credential);
    } catch (error) {
      if (error instanceof AiError) throw error;
      throw invalid();
    }
  }
  private async exchange(
    fields: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await this.request(
      TOKEN,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      },
      signal,
    );
    return readJson(response, signal ?? new AbortController().signal, 65536);
  }
  private async validate(
    value: unknown,
    clientId: string,
    nonce: string | undefined,
    signal?: AbortSignal,
  ): Promise<Credential> {
    if (
      !object(value) ||
      typeof value.access_token !== 'string' ||
      typeof value.refresh_token !== 'string' ||
      typeof value.id_token !== 'string' ||
      value.token_type !== 'Bearer' ||
      typeof value.expires_in !== 'number' ||
      !Number.isSafeInteger(value.expires_in) ||
      value.expires_in <= 0 ||
      value.expires_in > 86400 ||
      typeof value.scope !== 'string'
    )
      throw invalid();
    const scopes = value.scope.split(' ');
    aiInvariant(
      scopes.includes('chatgpt.tokens.use.direct') &&
        scopes.includes('resource.invoke'),
      'AUTH_INVALID',
      'ChatGPT plan use was not authorized. Reconnect and allow plan usage.',
    );
    for (const token of [
      value.access_token,
      value.refresh_token,
      value.id_token,
    ])
      if (!/^[\x21-\x7e]{1,20000}$/.test(token)) throw invalid();
    const parts = value.id_token.split('.');
    if (parts.length !== 3) throw invalid();
    const header: unknown = JSON.parse(
      new TextDecoder().decode(bytes(parts[0]!)),
    );
    const claims: unknown = JSON.parse(
      new TextDecoder().decode(bytes(parts[1]!)),
    );
    if (
      !object(header) ||
      header.alg !== 'RS256' ||
      typeof header.kid !== 'string' ||
      !object(claims) ||
      claims.iss !== ISSUER ||
      !(
        claims.aud === clientId ||
        (Array.isArray(claims.aud) &&
          claims.aud.includes(clientId) &&
          claims.azp === clientId)
      ) ||
      typeof claims.exp !== 'number' ||
      claims.exp * 1000 <= this.now() ||
      (typeof claims.nbf === 'number' &&
        claims.nbf * 1000 > this.now() + 60000) ||
      (nonce && claims.nonce !== nonce) ||
      typeof claims.sub !== 'string' ||
      !claims.sub
    )
      throw invalid();
    const response = await this.request(
      `${ISSUER}/.well-known/jwks.json`,
      { method: 'GET' },
      signal,
    );
    const jwks = await readJson(
      response,
      signal ?? new AbortController().signal,
      131072,
    );
    if (!object(jwks) || !Array.isArray(jwks.keys)) throw invalid();
    const keys = jwks.keys.filter(
      (k) =>
        object(k) &&
        k.kid === header.kid &&
        k.kty === 'RSA' &&
        (k.use === undefined || k.use === 'sig') &&
        (k.alg === undefined || k.alg === 'RS256'),
    );
    if (keys.length !== 1) throw invalid();
    const key = await crypto.subtle.importKey(
      'jwk',
      keys[0] as JsonWebKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    if (
      !(await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        key,
        bytes(parts[2]!),
        new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
      ))
    )
      throw invalid();
    return {
      version: 1,
      clientId,
      subject: claims.sub,
      accessToken: value.access_token,
      refreshToken: value.refresh_token,
      idToken: value.id_token,
      expiresAt: this.now() + value.expires_in * 1000,
      scopes,
      sessionId: crypto.randomUUID(),
    };
  }
  private save(value: Credential) {
    try {
      this.persistent().setItem(CHATGPT_CREDENTIAL_KEY, JSON.stringify(value));
    } catch {
      throw new AiError(
        'AUTH_STORAGE',
        'ChatGPT credentials could not be saved. Allow local browser storage and reconnect.',
      );
    }
    this.credential = value;
  }
  synchronize(): boolean {
    if (!this.credential) return false;
    const saved = storedCredential(this.persistent());
    if (!saved || saved.sessionId !== this.credential.sessionId) {
      this.invalidate(false);
      return true;
    }
    this.credential = saved;
    return false;
  }
  async accessToken(signal: AbortSignal): Promise<string> {
    const epoch = this.generation;
    const run = async () => {
      const saved = storedCredential(this.persistent());
      if (
        !saved ||
        !this.credential ||
        saved.clientId !== this.credential.clientId ||
        saved.subject !== this.credential.subject
      )
        throw new AiError('AUTH_REQUIRED', 'Reconnect ChatGPT.');
      if (saved.expiresAt > this.now() + 60000) {
        this.credential = saved;
        return saved.accessToken;
      }
      const result = await this.exchange(
        {
          grant_type: 'refresh_token',
          client_id: saved.clientId,
          refresh_token: saved.refreshToken,
          resource: 'https://api.openai.com/v1',
        },
        signal,
      );
      const next = await this.validate(
        result,
        saved.clientId,
        undefined,
        signal,
      );
      if (
        next.subject !== saved.subject ||
        signal.aborted ||
        epoch !== this.generation ||
        this.persistent().getItem(CHATGPT_CREDENTIAL_KEY) !==
          JSON.stringify(saved)
      )
        throw new AiError('CANCELLED', 'ChatGPT refresh cancelled.');
      next.sessionId = saved.sessionId;
      this.save(next);
      return next.accessToken;
    };
    // Serialize rotating refresh tokens across tabs of this origin.
    if (typeof navigator !== 'undefined' && navigator.locks)
      return navigator.locks.request(
        'localcut-chatgpt-refresh-v1',
        { signal },
        run,
      );
    return run();
  }
}
