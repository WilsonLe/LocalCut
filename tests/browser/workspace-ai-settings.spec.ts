import { expect, test } from '@playwright/test';
import {
  openAISettings,
  prepareOpenRouterKey,
  selectAISettingsTab,
  confirmProviderDisconnect,
} from './workspace-settings-helper';
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
for (const base of ['/', '/LocalCut/']) {
  test(`single OpenRouter settings preserve sections and keyboard focus on desktop and phone ${base}`, async ({
    page,
  }, info) => {
    await page.goto(base);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await openAISettings(page);
      const dialog = page.getByRole('dialog', {
        name: 'AI connection',
        exact: true,
      });
      await expect(
        dialog.getByRole('group', {
          name: 'OpenRouter connection',
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        dialog.getByRole('button', { name: 'Add provider', exact: true }),
      ).toHaveCount(0);
      await expect(
        dialog.getByRole('combobox', { name: 'Provider type', exact: true }),
      ).toHaveCount(0);
      await expect(dialog).not.toContainText('ChatGPT');
      await expect(dialog).not.toContainText('OpenAI-compatible');
      await prepareOpenRouterKey(page);
      const input = dialog.getByLabel('OpenRouter API key', { exact: true });
      await input.fill('synthetic-draft');
      for (const name of [
        'LLM - Chat',
        'TTS - Speech',
        'STT - Transcription',
      ] as const) {
        await selectAISettingsTab(page, name);
        await expect(dialog).not.toContainText('Backup provider');
        await expect(
          dialog.getByRole('button', { name: /Move .* (up|down)/ }),
        ).toHaveCount(0);
      }
      await expect(
        dialog.getByRole('combobox', {
          name: 'Transcription service',
          exact: true,
        }),
      ).toContainText('Local Whisper');
      await selectAISettingsTab(page, 'Providers');
      await expect(input).toHaveValue('synthetic-draft');
      await input.focus();
      await input.press('Tab');
      await expect
        .poll(() =>
          dialog.evaluate((el) => el.contains(document.activeElement)),
        )
        .toBe(true);
      const bounds = (await dialog.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: info.outputPath(`single-openrouter-${width}.png`),
      });
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
      await page.reload();
    }
  });
  test(`single OpenRouter migrates accounts and backup services, restores one key and disconnects across tabs ${base}`, async ({
    page,
    context,
  }, info) => {
    const requests: string[] = [];
    await context.route('https://**/*', (route) => {
      const url = route.request().url();
      requests.push(url);
      if (!url.startsWith('https://openrouter.ai/api/v1/'))
        return route.abort();
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({ headers: cors, body: '' });
      if (url.endsWith('/models'))
        return route.fulfill({
          headers: cors,
          json: {
            data: [
              {
                id: 'test/model',
                name: 'Test model',
                context_length: 128000,
                supported_parameters: ['tools', 'tool_choice'],
              },
            ],
          },
        });
      return route.abort();
    });
    await page.goto(base);
    await page.evaluate(() => {
      localStorage.setItem(
        'localcut.workspace-preferences.v1',
        JSON.stringify({
          version: 1,
          preferences: {
            aiProviders: JSON.stringify({
              profiles: [
                {
                  id: 'endpoint',
                  kind: 'compatible',
                  name: 'Old endpoint',
                  baseUrl: 'https://endpoint.example.test/v1',
                },
                { id: 'one', kind: 'openrouter', name: 'Work' },
                { id: 'two', kind: 'openrouter', name: 'Personal' },
                { id: 'chatgpt', kind: 'chatgpt', name: 'ChatGPT' },
              ],
              routes: {
                llm: [
                  { providerId: 'two', model: 'test/model' },
                  { providerId: 'one', model: 'backup' },
                ],
                tts: [
                  {
                    providerId: 'two',
                    model: 'google/gemini-3.8-flash-tts',
                    voice: 'Kore',
                  },
                  { providerId: 'one', model: 'backup-tts' },
                ],
                stt: [
                  { providerId: 'local', model: 'whisper' },
                  { providerId: 'two', model: 'remote' },
                ],
              },
            }),
          },
        }),
      );
      for (const id of ['one', 'two'])
        localStorage.setItem(
          `localcut.openrouter-credential.v1:${id}`,
          JSON.stringify({ version: 1, key: `synthetic-${id}-key` }),
        );
      localStorage.setItem(
        'localcut.chatgpt-credentials.v1',
        JSON.stringify({ accessToken: 'synthetic-token' }),
      );
      sessionStorage.setItem('localcut.chatgpt-pkce.v1', 'synthetic-pending');
      localStorage.setItem('unrelated-user-record', 'keep');
    });
    await page.reload();
    await openAISettings(page);
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await expect(
      dialog.getByRole('button', { name: 'Verify OpenRouter', exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('group', { name: /connection$/ }),
    ).toHaveCount(1);
    const state = await page.evaluate(() => ({
      config: JSON.parse(
        JSON.parse(localStorage.getItem('localcut.workspace-preferences.v1')!)
          .preferences.aiProviders,
      ),
      retired: localStorage.getItem('localcut.openrouter-credential.v1:one'),
      token: localStorage.getItem('localcut.chatgpt-credentials.v1'),
      pending: sessionStorage.getItem('localcut.chatgpt-pkce.v1'),
      retained: localStorage.getItem('localcut.openrouter-credential.v1:two'),
      unrelated: localStorage.getItem('unrelated-user-record'),
    }));
    expect(state.config.profiles).toEqual([
      { id: 'two', name: 'OpenRouter', kind: 'openrouter' },
    ]);
    expect(state.config.routes.llm).toEqual([
      { providerId: 'two', model: 'test/model' },
    ]);
    expect(state.config.routes.tts).toEqual([
      {
        providerId: 'two',
        model: 'google/gemini-3.8-flash-tts',
        voice: 'Kore',
      },
    ]);
    expect(state.config.routes.stt).toEqual([
      { providerId: 'local', model: 'whisper' },
    ]);
    expect(state.retired).toBeNull();
    expect(state.token).toBeNull();
    expect(state.pending).toBeNull();
    expect(state.retained).toContain('synthetic-two-key');
    expect(state.unrelated).toBe('keep');
    await selectAISettingsTab(page, 'LLM - Chat');
    await expect(
      dialog.getByRole('combobox', { name: 'AI model', exact: true }),
    ).toContainText('Test model');
    await expect(
      dialog.getByRole('combobox', {
        name: 'Add backup provider',
        exact: true,
      }),
    ).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath('single-openrouter-chat.png'),
    });
    await selectAISettingsTab(page, 'STT - Transcription');
    const service = dialog.getByRole('combobox', {
      name: 'Transcription service',
      exact: true,
    });
    await service.click();
    await page.getByRole('option', { name: 'OpenRouter', exact: true }).click();
    await expect(dialog).toContainText('A failed request stops');
    await service.click();
    await page
      .getByRole('option', { name: 'Local Whisper', exact: true })
      .click();
    await selectAISettingsTab(page, 'Providers');
    const other = await context.newPage();
    await other.goto(base);
    await openAISettings(other);
    await dialog
      .getByRole('button', { name: 'Disconnect OpenRouter', exact: true })
      .click();
    const confirm = page.getByRole('dialog', {
      name: 'Disconnect OpenRouter?',
      exact: true,
    });
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: 'Verify OpenRouter', exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Disconnect OpenRouter', exact: true })
      .click();
    await confirmProviderDisconnect(page);
    await expect(
      dialog.getByRole('button', { name: 'I have an API key', exact: true }),
    ).toBeVisible();
    await expect(
      other.getByRole('button', { name: 'Verify OpenRouter', exact: true }),
    ).toHaveCount(0);
    expect(
      requests.every((url) =>
        url.startsWith('https://openrouter.ai/api/v1/models'),
      ),
    ).toBe(true);
    await other.close();
  });
}
