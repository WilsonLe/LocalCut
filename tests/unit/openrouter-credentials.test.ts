import { describe, it, expect, vi } from 'vitest';
import { createOpenRouter } from '../../src/ai/openrouter';
import { CREDENTIAL_STORAGE_KEY } from '../../src/ai/credentials';

function fixture() {
  const values = new Map<string, string>([['unrelated', 'keep']]);
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  return { store, values };
}
const key = 'synthetic-persistent-credential';
describe('persistent OpenRouter credentials', () => {
  it('is opt-in and inert, restores without fetching, survives disposal and is removed only by Disconnect', () => {
    const { store, values } = fixture();
    const storage = vi.fn(() => store);
    const fetch = vi.fn<typeof globalThis.fetch>();
    const first = createOpenRouter({ credentialStorage: storage, fetch });
    expect(storage).not.toHaveBeenCalled();
    expect(first.status().connected).toBe(false);
    first.setKey(key);
    first.dispose();
    const second = createOpenRouter({ credentialStorage: storage, fetch });
    expect(second.restoreCredential().connected).toBe(true);
    first.disconnect(); // A disposed instance cannot delete a later connection.
    expect(store.getItem(CREDENTIAL_STORAGE_KEY)).not.toBeNull();
    expect(JSON.stringify(second.status())).not.toContain(key);
    expect(fetch).not.toHaveBeenCalled();
    second.disconnect();
    second.dispose();
    const third = createOpenRouter({ credentialStorage: storage, fetch });
    expect(third.restoreCredential().connected).toBe(false);
    expect([...values]).toEqual([['unrelated', 'keep']]);
    third.dispose();
    const memory = createOpenRouter();
    memory.setKey(key);
    memory.dispose();
    expect(createOpenRouter().restoreCredential().connected).toBe(false);
  });
  it('never restores or modifies the OpenRouter record through a compatible endpoint', () => {
    const { store } = fixture();
    const original = JSON.stringify({ version: 1, key });
    store.setItem(CREDENTIAL_STORAGE_KEY, original);
    const client = createOpenRouter({
      compatible: { baseUrl: 'http://localhost:1234/v1', model: 'local' },
      credentialStorage: () => store,
    });
    expect(() => client.restoreCredential()).toThrow(
      expect.objectContaining({ code: 'MODEL_UNSUPPORTED' }),
    );
    client.setKey('');
    expect(client.status().connected).toBe(true);
    client.disconnect();
    client.dispose();
    expect(store.getItem(CREDENTIAL_STORAGE_KEY)).toBe(original);
  });
  it.each([
    '{broken',
    '{"version":2,"key":"synthetic-valid-key"}',
    '{"version":1,"key":"short"}',
    'x'.repeat(8193),
  ])('rejects malformed records without exposing their content', (raw) => {
    const { store } = fixture();
    store.setItem(CREDENTIAL_STORAGE_KEY, raw);
    const client = createOpenRouter({ credentialStorage: () => store });
    expect(() => client.restoreCredential()).toThrow(
      expect.objectContaining({ code: 'AUTH_INVALID' }),
    );
    expect(client.status().connected).toBe(false);
    client.disconnect();
    expect(store.getItem(CREDENTIAL_STORAGE_KEY)).toBeNull();
    client.dispose();
  });
  it('sanitizes storage errors and still retires memory/in-flight work on failed removal', () => {
    const { store } = fixture();
    const client = createOpenRouter({ credentialStorage: () => store });
    client.setKey(key);
    store.setItem = () => {
      throw new Error('PRIVATE');
    };
    expect(() => client.setKey('new-synthetic-key')).toThrow(
      expect.objectContaining({ code: 'AUTH_STORAGE_UNAVAILABLE' }),
    );
    expect(client.status().connected).toBe(true);
    store.removeItem = () => {
      throw new Error('PRIVATE');
    };
    expect(() => client.disconnect()).toThrow(
      expect.objectContaining({ code: 'AUTH_STORAGE_UNAVAILABLE' }),
    );
    expect(client.status().connected).toBe(false);
    expect(() => client.dispose()).not.toThrow();
    const denied = createOpenRouter({
      credentialStorage: () => {
        throw new Error('PRIVATE');
      },
    });
    expect(() => denied.restoreCredential()).toThrow(
      expect.objectContaining({ code: 'AUTH_STORAGE_UNAVAILABLE' }),
    );
    expect(() => denied.setKey(key)).toThrow(
      expect.objectContaining({ code: 'AUTH_STORAGE_UNAVAILABLE' }),
    );
    expect(denied.status().connected).toBe(false);
    denied.dispose();
  });
  it('persists an OAuth-issued credential but cannot repersist a late exchange after disconnect', async () => {
    const { store } = fixture();
    let finish!: (response: Response) => void;
    const client = createOpenRouter({
      oauthStorage: store,
      credentialStorage: () => store,
      fetch: vi.fn(
        async () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    async function exchange() {
      const flow = await client.beginAuthorization({
        callbackUrl: 'https://example.com/',
      });
      const authorization = new URL(flow.authorizationUrl);
      const callback = new URL(authorization.searchParams.get('callback_url')!);
      callback.searchParams.set('code', 'synthetic-code');
      return client.completeAuthorization({ callbackUrl: callback.href });
    }
    const first = exchange();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    finish(Response.json({ key }));
    await first;
    client.dispose();
    const resumed = createOpenRouter({ credentialStorage: () => store });
    expect(resumed.restoreCredential().connected).toBe(true);
    resumed.disconnect();
    resumed.dispose();
    // A separate instance models a fresh explicit OAuth connection.
    let complete!: (response: Response) => void;
    const pendingClient = createOpenRouter({
      oauthStorage: store,
      credentialStorage: () => store,
      fetch: async () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    });
    const flow = await pendingClient.beginAuthorization({
      callbackUrl: 'https://example.com/',
    });
    const callback = new URL(
      new URL(flow.authorizationUrl).searchParams.get('callback_url')!,
    );
    callback.searchParams.set('code', 'late-code');
    const pending = pendingClient.completeAuthorization({
      callbackUrl: callback.href,
    });
    const rejected = expect(pending).rejects.toMatchObject({
      code: 'CANCELLED',
    });
    pendingClient.disconnect();
    complete(Response.json({ key }));
    await rejected;
    expect(store.getItem(CREDENTIAL_STORAGE_KEY)).toBeNull();
    pendingClient.dispose();
  });
});
