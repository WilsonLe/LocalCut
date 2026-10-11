import { fulfillChatTitle } from './chat-title-fixture';
import {
  prepareOpenRouterKey,
  openAISettings,
} from './workspace-settings-helper';
import { expect, test } from '@playwright/test';
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'POST,GET,OPTIONS',
};
for (const base of ['/', '/LocalCut/']) {
  test(`successive provider popover creations keep distinct accounts ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    await openAISettings(page);
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await dialog.getByText('Providers & services', { exact: true }).click();
    for (const name of ['OpenRouter work', 'OpenRouter personal']) {
      await dialog
        .getByRole('button', { name: 'Add provider', exact: true })
        .click();
      await page
        .getByRole('combobox', { name: 'Provider type', exact: true })
        .click();
      await page
        .getByRole('option', { name: 'OpenRouter', exact: true })
        .click();
      await expect(
        page.getByLabel('Account name', { exact: true }),
      ).toHaveValue('');
      await page.getByLabel('Account name', { exact: true }).fill(name);
      await page
        .getByRole('button', { name: 'Add OpenRouter account', exact: true })
        .click();
      await expect(
        dialog.getByRole('group', { name: `${name} connection`, exact: true }),
      ).toBeVisible();
    }
    const profiles = await page.evaluate(
      () =>
        JSON.parse(
          JSON.parse(localStorage.getItem('localcut.workspace-preferences.v1')!)
            .preferences.aiProviders,
        ).profiles as { id: string; name: string }[],
    );
    expect(profiles.map((profile) => profile.name)).toEqual([
      'OpenRouter work',
      'OpenRouter personal',
    ]);
    expect(new Set(profiles.map((profile) => profile.id)).size).toBe(2);
  });
  test(`provider endpoints and service ordering survive reload without credentials ${base}`, async ({
    page,
  }, testInfo) => {
    const remote: string[] = [];
    page.on('request', (r) => {
      if (r.url().startsWith('https:')) remote.push(r.url());
    });
    await page.goto(base);
    await openAISettings(page);
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await dialog.getByText('Providers & services', { exact: true }).click();
    await dialog
      .getByRole('button', { name: 'Add provider', exact: true })
      .click();
    await page.getByLabel('Name', { exact: true }).fill('Local server');
    await page
      .getByLabel('API base URL', { exact: true })
      .fill('http://localhost:1234/v1');
    await page.getByText('Speech to text', { exact: true }).click();
    await page
      .getByLabel('Transcription model', { exact: true })
      .fill('whisper-1');
    await page
      .getByRole('button', { name: 'Connect endpoint', exact: true })
      .click();
    await expect(
      dialog.getByLabel('Local server llm route model'),
    ).toBeEnabled();
    await dialog.getByLabel('Local server llm route model').fill('test-model');
    await dialog.getByLabel('Local server llm route model').press('Tab');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(
      dialog.getByRole('combobox', { name: 'LLM provider 1', exact: true }),
    ).toContainText('Local server');
    await expect(dialog.getByText('OpenRouter', { exact: true })).toHaveCount(
      0,
    );
    await expect(dialog).toContainText('STT · Transcription');
    await expect(dialog).toContainText('Local Whisper');
    await dialog.getByText('STT · Transcription', { exact: true }).click();
    await dialog
      .getByRole('button', { name: 'Move Local server up in stt', exact: true })
      .click();
    await expect(
      dialog.getByRole('combobox', { name: 'STT provider 1', exact: true }),
    ).toContainText('Local server');
    await expect(
      dialog.getByRole('combobox', { name: 'STT provider 2', exact: true }),
    ).toContainText('Local Whisper');
    await page.screenshot({
      path: testInfo.outputPath('provider-services.png'),
    });
    const saved = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('localcut.workspace-preferences.v1')!)
          .preferences.aiProviders as string,
    );
    expect(saved).toContain('http://localhost:1234/v1');
    expect(saved).not.toMatch(/apiKey|accessToken|refreshToken|callback/);
    expect(remote).toEqual([]);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page.reload();
    await openAISettings(page);
    await dialog.getByText('Providers & services', { exact: true }).click();
    await expect(
      dialog.getByRole('combobox', { name: 'LLM provider 1', exact: true }),
    ).toContainText('Local server');
    await expect(dialog.getByText('OpenRouter', { exact: true })).toHaveCount(
      0,
    );
    await dialog
      .getByRole('button', { name: 'STT · Transcription', exact: true })
      .click();
    await expect(
      dialog.getByRole('combobox', { name: 'STT provider 1', exact: true }),
    ).toContainText('Local server');
    await expect(
      dialog.getByRole('combobox', { name: 'STT provider 2', exact: true }),
    ).toContainText('Local Whisper');
    await expect(
      dialog.getByRole('combobox', { name: 'AI model', exact: true }),
    ).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByLabel('API base URL', { exact: true })).toHaveValue(
      'http://localhost:1234/v1',
    );
    await expect(
      page.getByLabel('API key (optional for local servers)', {
        exact: true,
      }),
    ).toHaveValue('');
  });
  for (const outage of [false, true]) {
    test(`backup catalog enables chat and speech after reload with ${outage ? 'primary outage' : 'disconnected primary'} ${base}`, async ({
      page,
      context,
    }) => {
      let chatRequests = 0,
        speechRequests = 0,
        timingRequests = 0;
      await context.route('https://openrouter.ai/api/v1/models*', (route) =>
        route.fulfill({ status: 503, headers: cors, body: 'unavailable' }),
      );
      await context.route(
        'https://backup.example.test/v1/chat/completions',
        async (route) => {
          expect(route.request().postDataJSON().model).toBe('backup');
          if (await fulfillChatTitle(route)) return;
          chatRequests++;
          return route.fulfill({
            headers: { ...cors, 'content-type': 'text/event-stream' },
            body: 'data: {"choices":[{"index":0,"delta":{"content":"backup success"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
          });
        },
      );
      await context.route(
        'https://backup.example.test/v1/audio/speech',
        (route) => {
          speechRequests++;
          expect(route.request().postDataJSON()).toMatchObject({
            model: 'tts',
            voice: 'voice',
            input: 'Hello backup',
          });
          const pcm = Buffer.alloc(24000 * 2);
          for (let i = 0; i < 24000; i++)
            pcm.writeInt16LE(
              Math.round(Math.sin((i * 2 * Math.PI * 220) / 24000) * 10000),
              i * 2,
            );
          return route.fulfill({
            headers: { ...cors, 'content-type': 'audio/pcm' },
            body: pcm,
          });
        },
      );
      await context.route(
        'https://backup.example.test/v1/audio/transcriptions',
        (route) => {
          timingRequests++;
          return route.fulfill({
            headers: cors,
            json: {
              segments: [{ text: 'Hello backup', start: 0.1, end: 0.9 }],
            },
          });
        },
      );
      await page.goto(base);
      await page.evaluate(() =>
        localStorage.setItem(
          'localcut.workspace-preferences.v1',
          JSON.stringify({
            version: 1,
            preferences: {
              aiProviders: JSON.stringify({
                profiles: [
                  { id: 'openrouter', name: 'OpenRouter', kind: 'openrouter' },
                  {
                    id: 'backup',
                    name: 'Backup',
                    kind: 'compatible',
                    baseUrl: 'https://backup.example.test/v1',
                    model: 'backup',
                    speechModel: 'tts',
                    transcriptionModel: 'whisper',
                    voices: ['voice'],
                  },
                ],
                routes: {
                  llm: [
                    { providerId: 'openrouter', model: 'primary' },
                    { providerId: 'backup', model: 'backup' },
                  ],
                  tts: [
                    {
                      providerId: 'openrouter',
                      model: 'google/gemini-3.8-flash-tts',
                      voice: 'Kore',
                    },
                    { providerId: 'backup', model: 'tts', voice: 'voice' },
                  ],
                  stt: [{ providerId: 'backup', model: 'whisper' }],
                },
              }),
            },
          }),
        ),
      );
      await page.reload();
      await openAISettings(page);
      const dialog = page.getByRole('dialog', {
        name: 'AI connection',
        exact: true,
      });
      if (outage) {
        await prepareOpenRouterKey(page);
        await dialog
          .getByLabel('OpenRouter API key', { exact: true })
          .fill('synthetic');
        await dialog
          .getByRole('button', { name: 'Use API key', exact: true })
          .click();
        await expect(dialog.getByRole('alert')).toContainText('unavailable');
      }
      await dialog.getByText('Providers & services', { exact: true }).click();
      await dialog
        .getByRole('button', { name: 'Connect', exact: true })
        .click();
      await page
        .getByLabel('API key (optional for local servers)', { exact: true })
        .fill('synthetic');
      await page
        .getByRole('button', { name: 'Connect endpoint', exact: true })
        .click();
      await expect(dialog.getByLabel('Backup llm route model')).toHaveValue(
        'backup',
      );
      await expect(dialog.getByLabel('Backup llm route model')).toBeEnabled();
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
      await page
        .getByRole('button', { name: 'Workspace settings', exact: true })
        .click();
      await page
        .getByRole('menuitem', { name: 'Project', exact: true })
        .click();
      await page
        .getByRole('menuitem', { name: 'New project', exact: true })
        .click();
      await page
        .getByLabel('Project name', { exact: true })
        .fill('Backup project');
      await page
        .getByRole('button', { name: 'Create project', exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: 'Add text', exact: true }),
      ).toBeEnabled();
      await page
        .getByLabel('Describe your edit', { exact: true })
        .fill('Hello');
      await page
        .getByRole('button', { name: 'Send edit request', exact: true })
        .click();
      await expect(
        page.getByText('backup success', { exact: true }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'Expand media', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Text to speech', exact: true })
        .click();
      const speech = page.getByRole('dialog', {
        name: 'Text to speech',
        exact: true,
      });
      await expect(
        speech.getByText('Loading speech models…'),
      ).not.toBeVisible();
      await speech
        .getByRole('combobox', { name: 'Speech model', exact: true })
        .click();
      await page.getByRole('option', { name: 'tts', exact: true }).click();
      await speech
        .getByRole('combobox', { name: 'Speech voice', exact: true })
        .click();
      await page.getByRole('option', { name: 'voice', exact: true }).click();
      await speech.getByLabel('Script', { exact: true }).fill('Hello backup');
      await speech
        .getByRole('combobox', { name: 'Phrase timing', exact: true })
        .click();
      await page
        .getByRole('option', { name: 'Configured STT route', exact: true })
        .click();
      await expect(speech).toContainText('STT providers in order: Backup');
      await speech
        .getByRole('button', { name: 'Generate speech', exact: true })
        .click();
      await expect(
        speech.getByLabel('Generated speech preview', { exact: true }),
      ).toBeVisible();
      expect([chatRequests, speechRequests, timingRequests]).toEqual([1, 1, 1]);
      const routes = await page.evaluate(
        () =>
          JSON.parse(
            JSON.parse(
              localStorage.getItem('localcut.workspace-preferences.v1')!,
            ).preferences.aiProviders,
          ).routes,
      );
      expect(routes.llm).toEqual([
        { providerId: 'openrouter', model: 'primary' },
        { providerId: 'backup', model: 'backup' },
      ]);
      expect(routes.tts).toEqual([
        {
          providerId: 'openrouter',
          model: 'google/gemini-3.8-flash-tts',
          voice: 'Kore',
        },
        { providerId: 'backup', model: 'tts', voice: 'voice' },
      ]);
    });
  }
  test(`production service router fails over once and does not replay partial output ${base}`, async ({
    page,
    context,
  }) => {
    let firstRequests = 0,
      backupRequests = 0,
      partial = false;
    await context.route(
      'https://first.example.test/v1/chat/completions',
      (route) => {
        firstRequests++;
        return route.fulfill(
          partial
            ? {
                headers: { ...cors, 'content-type': 'text/event-stream' },
                body: 'data: {"choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\n',
              }
            : { status: 503, headers: cors, body: 'unavailable' },
        );
      },
    );
    await context.route(
      'https://backup.example.test/v1/chat/completions',
      (route) => {
        backupRequests++;
        return route.fulfill({
          headers: { ...cors, 'content-type': 'text/event-stream' },
          body: 'data: {"choices":[{"index":0,"delta":{"content":"backup success"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        });
      },
    );
    await page.goto(base);
    const run = () =>
      page.evaluate(async (path) => {
        const ai = (await import(
          path + 'ai.js'
        )) as typeof import('../../src/ai');
        const a = ai.createOpenAICompatible({
          baseUrl: 'https://first.example.test/v1',
          model: 'first',
        });
        const b = ai.createOpenAICompatible({
          baseUrl: 'https://backup.example.test/v1',
          model: 'backup',
        });
        a.setKey('synthetic-test-key');
        b.setKey('synthetic-test-key');
        const router = ai.createServiceRouter(
          [
            { id: 'a', name: 'First', client: a },
            { id: 'b', name: 'Backup', client: b },
          ],
          {
            llm: [
              { providerId: 'a', model: 'first' },
              { providerId: 'b', model: 'backup' },
            ],
            tts: [],
            stt: [{ providerId: 'local', model: 'whisper' }],
          },
        );
        const texts: string[] = [];
        try {
          for await (const e of router.stream(
            {
              model: 'first',
              messages: [{ role: 'user', content: 'Hi' }],
              tools: [],
              maxOutputTokens: 100,
            },
            new AbortController().signal,
          ))
            if (e.type === 'text') texts.push(e.text);
          return { texts, error: '' };
        } catch (e) {
          return { texts, error: e instanceof ai.AiError ? e.code : 'unknown' };
        } finally {
          router.dispose();
          a.dispose();
          b.dispose();
        }
      }, base);
    expect(await run()).toEqual({ texts: ['backup success'], error: '' });
    expect([firstRequests, backupRequests]).toEqual([1, 1]);
    partial = true;
    expect(await run()).toEqual({
      texts: ['partial'],
      error: 'RESPONSE_INCOMPLETE',
    });
    expect([firstRequests, backupRequests]).toEqual([2, 1]);
  });
}
for (const base of ['/', '/LocalCut/']) {
  test(`ChatGPT pasted callback verifies identity and restores saved tokens ${base}`, async ({
    page,
    context,
  }, testInfo) => {
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
      kid: 'synthetic-key',
    };
    let authParams = new URLSearchParams();
    let exchanges = 0;
    const catalogCredentials: string[] = [];
    await context.route(
      'https://auth.openai.com/api/accounts/authorize**',
      (route) => {
        authParams = new URL(route.request().url()).searchParams;
        return route.fulfill({ body: 'Synthetic sign-in complete' });
      },
    );
    await context.route(
      'https://auth.openai.com/.well-known/jwks.json',
      (route) => route.fulfill({ headers: cors, json: { keys: [jwk] } }),
    );
    await context.route(
      'https://auth.openai.com/api/accounts/oauth/token',
      async (route) => {
        exchanges++;
        const fields = new URLSearchParams(route.request().postData()!);
        expect(fields.get('client_id')).toBe('oaiapp_localcut_test');
        expect(fields.get('redirect_uri')).toBe(
          'http://127.0.0.1:1455/auth/callback',
        );
        const encode = (v: unknown) =>
          Buffer.from(JSON.stringify(v)).toString('base64url');
        const data = `${encode({ alg: 'RS256', kid: 'synthetic-key' })}.${encode({ iss: 'https://auth.openai.com', aud: 'oaiapp_localcut_test', sub: 'test-subject', exp: Math.floor(Date.now() / 1000) + 3600, nonce: authParams.get('nonce') })}`;
        const signature = Buffer.from(
          await crypto.subtle.sign(
            'RSASSA-PKCS1-v1_5',
            keys.privateKey,
            new TextEncoder().encode(data),
          ),
        ).toString('base64url');
        await route.fulfill({
          headers: cors,
          json: {
            access_token: 'synthetic-access',
            refresh_token: 'synthetic-refresh',
            id_token: `${data}.${signature}`,
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'chatgpt.tokens.use.direct resource.invoke offline_access',
          },
        });
      },
    );
    await context.route('https://api.openai.com/v1/models', (route) => {
      catalogCredentials.push(route.request().headers().authorization!);
      return route.fulfill({
        headers: cors,
        json: {
          models: [
            {
              slug: 'chatgpt-test',
              display_name: 'ChatGPT test',
              visibility: 'list',
            },
          ],
        },
      });
    });
    await context.route('https://api.openai.com/v1/responses', (route) => {
      const body = route.request().postDataJSON() as {
        store: boolean;
        stream: boolean;
      };
      expect(body.store).toBe(false);
      expect(body.stream).toBe(true);
      return route.fulfill({
        headers: { ...cors, 'content-type': 'text/event-stream' },
        body: 'data: {"type":"response.output_text.delta","delta":"ChatGPT result"}\n\ndata: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"ChatGPT result"}]}]}}\n\n',
      });
    });
    await page.goto(base);
    await openAISettings(page);
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await dialog.getByText('Providers & services', { exact: true }).click();
    await dialog
      .getByRole('button', { name: 'Add provider', exact: true })
      .click();
    await page
      .getByRole('combobox', { name: 'Provider type', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'ChatGPT plan', exact: true })
      .click();
    const help = page.getByRole('button', {
      name: 'ChatGPT connection help',
      exact: true,
    });
    await expect(dialog).not.toContainText('After signing in, copy the full');
    await help.click();
    await expect(page.getByRole('tooltip')).toContainText(
      'After signing in, copy the full 127.0.0.1 callback URL',
    );
    await page.keyboard.press('Escape');
    const popupPromise = context.waitForEvent('page');
    await page
      .getByRole('button', { name: 'Continue with ChatGPT', exact: true })
      .click();
    const popup = await popupPromise;
    await expect(popup.getByText('Synthetic sign-in complete')).toBeVisible();
    expect(authParams.get('client_id')).toBe('dynamic_agent_client');
    const callback = new URL('http://127.0.0.1:1455/auth/callback');
    callback.searchParams.set('code', 'synthetic-one-use-code');
    callback.searchParams.set('state', authParams.get('state')!);
    callback.searchParams.set('client_id', 'oaiapp_localcut_test');
    await page.getByLabel('Callback URL', { exact: true }).fill(callback.href);
    await page
      .getByRole('button', { name: 'Complete sign-in', exact: true })
      .click();
    await expect(
      dialog.getByRole('combobox', { name: 'AI model', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Callback URL', { exact: true })).toHaveCount(
      0,
    );
    const saved = await page.evaluate(() =>
      localStorage.getItem('localcut.chatgpt-credentials.v1'),
    );
    expect(saved).toContain('synthetic-access');
    expect(saved).not.toContain('synthetic-one-use-code');
    expect(
      await page.evaluate(async (path) => {
        const ai = (await import(
          path + 'ai.js'
        )) as typeof import('../../src/ai');
        const client = ai.createChatGPT();
        client.restore();
        const result: string[] = [];
        try {
          for await (const e of client.stream(
            {
              model: 'chatgpt-test',
              messages: [{ role: 'user', content: 'Hi' }],
              tools: [],
              maxOutputTokens: 100,
            },
            new AbortController().signal,
          ))
            if (e.type === 'text') result.push(e.text);
          return result;
        } finally {
          client.dispose();
        }
      }, base),
    ).toEqual(['ChatGPT result']);
    await page.screenshot({
      path: testInfo.outputPath('chatgpt-connection.png'),
    });
    await popup.close();
    await dialog
      .getByRole('button', { name: 'Add provider', exact: true })
      .click();
    await page.getByLabel('Account name', { exact: true }).fill('ChatGPT work');
    const secondPopupPromise = context.waitForEvent('page');
    await page
      .getByRole('button', { name: 'Continue with ChatGPT', exact: true })
      .click();
    const secondPopup = await secondPopupPromise;
    await expect(
      secondPopup.getByText('Synthetic sign-in complete'),
    ).toBeVisible();
    callback.searchParams.set('state', authParams.get('state')!);
    await page.getByLabel('Callback URL', { exact: true }).fill(callback.href);
    await page
      .getByRole('button', { name: 'Complete sign-in', exact: true })
      .click();
    await expect(
      dialog.getByRole('button', { name: 'Verify ChatGPT work', exact: true }),
    ).toBeVisible();
    await secondPopup.close();
    await test.step('a third ChatGPT account preserves both previous identities', async () => {
      await dialog
        .getByRole('button', { name: 'Add provider', exact: true })
        .click();
      await expect(
        page.getByLabel('Account name', { exact: true }),
      ).toHaveValue('');
      await page
        .getByLabel('Account name', { exact: true })
        .fill('ChatGPT sandbox');
      const popupPromise = context.waitForEvent('page');
      await page
        .getByRole('button', { name: 'Continue with ChatGPT', exact: true })
        .click();
      const popup = await popupPromise;
      await expect(popup.getByText('Synthetic sign-in complete')).toBeVisible();
      callback.searchParams.set('state', authParams.get('state')!);
      await page
        .getByLabel('Callback URL', { exact: true })
        .fill(callback.href);
      await page
        .getByRole('button', { name: 'Complete sign-in', exact: true })
        .click();
      for (const name of ['ChatGPT', 'ChatGPT work', 'ChatGPT sandbox']) {
        await expect(
          dialog.getByRole('button', { name: `Verify ${name}`, exact: true }),
        ).toBeVisible();
      }
      const ids = await page.evaluate(
        () =>
          JSON.parse(
            JSON.parse(
              localStorage.getItem('localcut.workspace-preferences.v1')!,
            ).preferences.aiProviders,
          )
            .profiles.filter(
              (profile: { kind: string }) => profile.kind === 'chatgpt',
            )
            .map((profile: { id: string }) => profile.id) as string[],
      );
      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(3);
      await popup.close();
      await dialog
        .getByRole('button', {
          name: 'Disconnect ChatGPT sandbox',
          exact: true,
        })
        .click();
      await dialog
        .getByRole('button', {
          name: 'Disconnect ChatGPT sandbox',
          exact: true,
        })
        .click();
    });
    const sibling = await context.newPage();
    await sibling.goto(base);
    const accountKey = await page.evaluate(() =>
      Object.keys(localStorage).find((key) =>
        key.startsWith('localcut.chatgpt-credentials.v1:'),
      )!,
    );
    const workCredential = JSON.parse(
      (await page.evaluate((key) => localStorage.getItem(key), accountKey))!,
    ) as Record<string, unknown>;
    const writeFromSibling = async (value: string | null) => {
      await page.evaluate((key) => {
        const state = window as typeof window & {
          providerStorageEvent?: Promise<void>;
        };
        state.providerStorageEvent = new Promise<void>((resolve) => {
          const changed = (event: StorageEvent) => {
            if (event.key !== key) return;
            window.removeEventListener('storage', changed);
            resolve();
          };
          window.addEventListener('storage', changed);
        });
      }, accountKey);
      await sibling.evaluate(
        ({ key, value }) => {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        },
        { key: accountKey, value },
      );
      await page.evaluate(async () => {
        const state = window as typeof window & {
          providerStorageEvent?: Promise<void>;
        };
        await state.providerStorageEvent;
        delete state.providerStorageEvent;
      });
    };
    const workVerify = dialog.getByRole('button', {
      name: 'Verify ChatGPT work',
      exact: true,
    });
    const personalVerify = dialog.getByRole('button', {
      name: 'Verify ChatGPT',
      exact: true,
    });
    const restoreWork = async () => {
      await dialog
        .getByRole('button', { name: 'Connect', exact: true })
        .click();
      await page
        .locator('[data-slot=popover-content]')
        .getByRole('button', { name: 'Connect', exact: true })
        .last()
        .click();
      await expect(workVerify).toBeVisible();
    };
    await test.step('same-session rotation preserves the connected account; replacement and removal retire only it', async () => {
      await writeFromSibling(
        JSON.stringify({ ...workCredential, accessToken: 'synthetic-rotated' }),
      );
      await expect(workVerify).toBeVisible();
      await workVerify.click();
      await expect(
        dialog.getByRole('img', { name: 'ChatGPT work verified', exact: true }),
      ).toBeVisible();
      expect(catalogCredentials.at(-1)).toBe('Bearer synthetic-rotated');
      const replacement = JSON.stringify({
        ...workCredential,
        sessionId: 'synthetic-replacement',
        accessToken: 'synthetic-replaced',
      });
      await writeFromSibling(replacement);
      await expect(workVerify).toHaveCount(0);
      await expect(personalVerify).toBeVisible();
      await restoreWork();
      await writeFromSibling(null);
      await expect(workVerify).toHaveCount(0);
      await expect(personalVerify).toBeVisible();
      await writeFromSibling(replacement);
      await restoreWork();
    });
    await sibling.close();
    await dialog
      .getByRole('button', { name: 'Disconnect ChatGPT', exact: true })
      .click();
    expect(
      await page.evaluate(() =>
        localStorage.getItem('localcut.chatgpt-credentials.v1'),
      ),
    ).toBeNull();
    expect(
      await page.evaluate(
        () =>
          Object.keys(localStorage).filter((key) =>
            key.startsWith('localcut.chatgpt-credentials.v1:'),
          ).length,
      ),
    ).toBe(1);
    await page.reload();
    await openAISettings(page);
    await dialog.getByText('Providers & services', { exact: true }).click();
    await dialog
      .getByRole('button', { name: 'Connect', exact: true })
      .last()
      .click();
    await page
      .locator('[data-slot=popover-content]')
      .getByRole('button', { name: 'Connect', exact: true })
      .last()
      .click();
    await expect(
      dialog.getByRole('combobox', { name: 'AI model', exact: true }),
    ).toBeVisible();
    expect(exchanges).toBe(3);
    await dialog
      .getByRole('button', { name: 'Disconnect ChatGPT work', exact: true })
      .click();
    expect(
      await page.evaluate(
        () =>
          Object.keys(localStorage).filter((key) =>
            key.startsWith('localcut.chatgpt-credentials.v1'),
          ).length,
      ),
    ).toBe(0);
  });
}

for (const base of ['/', '/LocalCut/']) {
  test(`native audio extraction routes OpenRouter STT and persists exact source cues ${base}`, async ({
    page,
    context,
  }) => {
    const requests: string[] = [];
    await context.route(
      'https://stt-first.example.test/v1/audio/transcriptions',
      (route) => {
        requests.push('first');
        return route.fulfill({
          status: 503,
          headers: cors,
          body: 'private failure body',
        });
      },
    );
    await context.route(
      'https://openrouter.ai/api/v1/audio/transcriptions',
      (route) => {
        requests.push('backup');
        const body = route.request().postDataBuffer()!;
        expect(body.toString()).toContain('verbose_json');
        expect(body.toString()).toContain('audio.wav');
        expect(body.toString()).toContain('whisper-1');
        expect(body.byteLength).toBeGreaterThan(21000);
        return route.fulfill({
          headers: { ...cors, 'content-type': 'application/json' },
          body: JSON.stringify({
            segments: [
              { text: 'Hello', start: 0, end: 0.2 },
              { text: 'world', start: 0.25, end: 0.65 },
            ],
          }),
        });
      },
    );
    await page.goto(base);
    const result = await page.evaluate(async (path) => {
      const api = (await import(
        path + 'editor.js'
      )) as typeof import('../../src/editor');
      const ai = (await import(
        path + 'ai.js'
      )) as typeof import('../../src/ai');
      const namespace = 'test-' + crypto.randomUUID();
      let editor = await api.createEditor({ namespace });
      const data = new ArrayBuffer(44 + 96000),
        view = new DataView(data);
      const ascii = (offset: number, s: string) => {
        for (let i = 0; i < s.length; i++)
          view.setUint8(offset + i, s.charCodeAt(i));
      };
      ascii(0, 'RIFF');
      view.setUint32(4, data.byteLength - 8, true);
      ascii(8, 'WAVE');
      ascii(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, 48000, true);
      view.setUint32(28, 96000, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      ascii(36, 'data');
      view.setUint32(40, 96000, true);
      for (let i = 0; i < 48000; i++)
        view.setInt16(
          44 + i * 2,
          Math.sin((i * 2 * Math.PI * 440) / 48000) * 16000,
          true,
        );
      const asset = await editor.assets.import(
        new File([data], 'source.wav', { type: 'audio/wav' }),
      ).completion;
      const first = ai.createOpenAICompatible({
        baseUrl: 'https://stt-first.example.test/v1',
        transcriptionModel: 'whisper-1',
      });
      const backup = ai.createOpenRouter();
      first.setKey('synthetic');
      backup.setKey('synthetic');
      const router = ai.createServiceRouter(
        [
          { id: 'first', name: 'First STT', client: first },
          { id: 'backup', name: 'Backup STT', client: backup },
        ],
        {
          llm: [],
          tts: [],
          stt: [
            { providerId: 'first', model: 'whisper-1' },
            { providerId: 'backup', model: 'openai/whisper-1' },
          ],
        },
      );
      try {
        const transcript = await editor.transcription.transcribe(asset.id, {
          startUs: 120003,
          endUs: 800007,
          language: 'en',
          provider: router.transcribe,
        }).completion;
        await editor.dispose();
        editor = await api.createEditor({ namespace });
        const saved = await editor.transcription.transcript(transcript.id);
        if (!saved) throw new Error('Transcript did not survive reload.');
        const rejected = await editor.transcription
          .transcribe(asset.id, {
            startUs: 120003,
            endUs: 800007,
            provider: async () => ({
              ...saved,
              id: crypto.randomUUID(),
              assetId: 'foreign',
            }),
          })
          .completion.then(
            () => '',
            (e: { code: string }) => e.code,
          );
        return {
          cues: saved.cues.map(({ timeUs, endUs, text }) => ({
            timeUs,
            endUs,
            text,
          })),
          model: saved.model,
          revision: saved.revision,
          rejected,
        };
      } finally {
        router.dispose();
        first.dispose();
        backup.dispose();
        await editor.dispose();
      }
    }, base);
    expect(requests).toEqual(['first', 'backup']);
    expect(result).toEqual({
      cues: [
        { timeUs: 120003, endUs: 320003, text: 'Hello' },
        { timeUs: 370003, endUs: 770003, text: 'world' },
      ],
      model: 'openai/whisper-1',
      revision: 'provider:backup',
      rejected: 'INVALID_DOCUMENT',
    });
  });
}
