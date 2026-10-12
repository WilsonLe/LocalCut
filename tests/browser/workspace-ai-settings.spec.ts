import {
  prepareOpenRouterKey,
  openAISettings,
} from './workspace-settings-helper';
import { expect, test } from '@playwright/test';

for (const base of ['/', '/LocalCut/']) {
  test(`AI settings tabs preserve input and keyboard focus on desktop and phone ${base}`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(base);
    await openAISettings(page);
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect
      .poll(async () => (await dialog.boundingBox())!.width)
      .toBeGreaterThanOrEqual(760);
    await expect(dialog.getByRole('tab')).toHaveText([
      'Providers',
      'LLM - Chat',
      'TTS - Speech',
      'STT - Transcription',
    ]);
    await expect(
      dialog.getByRole('tabpanel', { name: 'Providers', exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Add provider', exact: true })
      .click();
    const name = page.getByLabel('Name', { exact: true });
    await name.fill('Unsaved provider');
    await page.keyboard.press('Escape');
    await expect(name).not.toBeVisible();
    await expect(dialog).toBeVisible();
    await prepareOpenRouterKey(page);
    const key = dialog.getByLabel('OpenRouter API key', { exact: true });
    await key.fill('synthetic-unsaved-key');
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(key).toHaveCount(0);
    await dialog
      .getByRole('button', { name: 'I have an API key', exact: true })
      .click();
    await expect(key).toHaveValue('');
    await expect(key).toBeFocused();
    await dialog
      .getByRole('button', { name: 'Add provider', exact: true })
      .click();
    await page
      .getByRole('combobox', { name: 'Provider type', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'OpenAI-compatible endpoint', exact: true })
      .click();
    await expect(name).toHaveValue('');
    await page.keyboard.press('Escape');
    await key.fill('synthetic-retained-draft');
    const providers = dialog.getByRole('tab', {
      name: 'Providers',
      exact: true,
    });
    await providers.focus();
    await providers.press('ArrowRight');
    const chat = dialog.getByRole('tab', { name: 'LLM - Chat', exact: true });
    await expect(chat).toBeFocused();
    await chat.press('Enter');
    await expect(chat).toHaveAttribute('aria-selected', 'true');
    await expect(key).toBeHidden();
    await chat.press('End');
    const service = dialog.getByRole('tab', {
      name: 'STT - Transcription',
      exact: true,
    });
    await expect(service).toBeFocused();
    await service.press('Enter');
    await expect(
      dialog.getByRole('combobox', {
        name: 'STT provider 1',
        exact: true,
      }),
    ).toBeVisible();
    await service.press('Home');
    await providers.press('Enter');
    await expect(key).toHaveValue('synthetic-retained-draft');
    await expect(dialog.getByRole('tabpanel')).toHaveCount(1);
    await page.screenshot({
      path: testInfo.outputPath('ai-settings-desktop.png'),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      dialog.getByRole('heading', { name: 'AI connection', exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Close', exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Done', exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      )
      .toBe(true);
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: testInfo.outputPath('ai-settings-phone.png'),
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await service.click();
    await expect(service).toHaveAttribute('aria-selected', 'true');
    await providers.click();
    await expect(key).toHaveValue('synthetic-retained-draft');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Workspace settings', exact: true }),
    ).toBeFocused();
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'Appearance', exact: true })
      .click();
    await page
      .getByRole('combobox', { name: 'Interface size', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'Large (125%)', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Close appearance', exact: true })
      .click();
    await openAISettings(page);
    await expect(dialog).toBeVisible();
    const largeBounds = (await dialog.boundingBox())!;
    expect(largeBounds.y).toBeGreaterThanOrEqual(0);
    expect(largeBounds.y + largeBounds.height).toBeLessThanOrEqual(844);
    expect(largeBounds.x).toBeGreaterThanOrEqual(0);
    expect(largeBounds.x + largeBounds.width).toBeLessThanOrEqual(390);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  });
}

for (const base of ['/', '/LocalCut/']) {
  test(`searchable service providers isolate multiple OpenRouter accounts and account management ${base}`, async ({
    page,
    context,
  }, info) => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    };
    let paid = 0;
    let exchanges = 0;
    const verified: string[] = [];
    const discoveryAccounts: string[] = [];
    await context.route('https://openrouter.ai/api/v1/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({ headers: cors, body: '' });
      if (
        new URL(route.request().url()).searchParams.get('output_modalities') ===
        'transcription'
      ) {
        const account = route.request().headers().authorization ?? '';
        discoveryAccounts.push(account);
        return route.fulfill({
          headers: cors,
          json: {
            data: [
              {
                id: 'openai/whisper-1',
                name: account.includes('secondary')
                  ? 'Work Whisper'
                  : 'Personal Whisper',
              },
            ],
          },
        });
      }
      if (path.endsWith('/models'))
        return route.fulfill({
          headers: cors,
          json: {
            data: [
              {
                id: 'test/model',
                name: 'Test model',
                context_length: 512000,
                supported_parameters: ['tools', 'tool_choice'],
              },
              {
                id: 'test/small',
                name: 'Small context model',
                context_length: 256000,
                supported_parameters: ['tools', 'tool_choice'],
              },
            ],
          },
        });
      if (path.endsWith('/auth/keys')) {
        exchanges++;
        return route.fulfill({
          headers: cors,
          json: { key: 'synthetic-secondary-account' },
        });
      }
      if (path.endsWith('/key')) {
        verified.push(route.request().headers().authorization ?? '');
        return route.fulfill({
          headers: cors,
          json: { data: { is_free_tier: true } },
        });
      }
      paid++;
      return route.abort();
    });
    await context.route('https://openrouter.ai/auth?*', (route) => {
      const auth = new URL(route.request().url());
      const callback = new URL(auth.searchParams.get('callback_url')!);
      callback.searchParams.set('code', 'synthetic-second-account-code');
      return route.fulfill({
        contentType: 'text/html',
        body: `<a href="${callback.href.replaceAll('&', '&amp;')}">Return to LocalCut</a>`,
      });
    });
    await page.goto(base);
    await openAISettings(page);
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await dialog.getByRole('tab', { name: 'LLM - Chat', exact: true }).click();
    const addLLM = dialog.getByRole('combobox', {
      name: 'Add LLM provider',
      exact: true,
    });
    await expect(
      dialog
        .getByRole('tabpanel', { name: 'LLM - Chat', exact: true })
        .getByText(
          'No connected providers. Connect a provider in the Providers tab.',
          {
            exact: true,
          },
        ),
    ).toBeVisible();
    await addLLM.click();
    await expect(
      page.getByText(
        'No connected providers for this service. Connect a provider in the Providers tab.',
        { exact: true },
      ),
    ).toBeVisible();
    await page
      .getByRole('combobox', {
        name: 'Search connected providers',
        exact: true,
      })
      .fill('OpenRouter');
    await expect(
      page.getByRole('option', { name: 'OpenRouter', exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await prepareOpenRouterKey(page);
    await dialog
      .getByLabel('OpenRouter API key', { exact: true })
      .fill('synthetic-first-account');
    await dialog
      .getByRole('button', { name: 'Use API key', exact: true })
      .click();
    await expect(
      dialog.getByRole('button', { name: 'Verify OpenRouter', exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Verify OpenRouter', exact: true })
      .click();
    await expect(
      dialog.getByRole('img', { name: 'OpenRouter verified', exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Add provider', exact: true })
      .click();
    await expect(
      dialog.getByLabel('LLM model (must support tools)', { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole('combobox', { name: 'Provider type', exact: true })
      .click();
    await page.getByRole('option', { name: 'OpenRouter', exact: true }).click();
    await page
      .getByLabel('Account name', { exact: true })
      .fill('OpenRouter work');
    await page
      .getByRole('button', { name: 'Add OpenRouter account', exact: true })
      .click();
    await dialog
      .getByRole('button', { name: 'Log in and generate a key', exact: true })
      .click();
    await page
      .getByRole('link', { name: 'Return to LocalCut', exact: true })
      .click();
    await dialog.getByRole('tab', { name: 'Providers', exact: true }).click();
    await expect(
      dialog.getByRole('button', {
        name: 'Verify OpenRouter work',
        exact: true,
      }),
    ).toBeVisible();
    expect(exchanges).toBe(1);
    await dialog
      .getByRole('button', { name: 'Verify OpenRouter work', exact: true })
      .click();
    await expect.poll(() => verified.length).toBe(2);
    expect(verified).toEqual([
      'Bearer synthetic-first-account',
      'Bearer synthetic-secondary-account',
    ]);
    // Search all three services, and ensure the primary route cannot be duplicated.
    for (const [service, title] of [
      ['LLM', 'LLM - Chat'],
      ['TTS', 'TTS - Speech'],
      ['STT', 'STT - Transcription'],
    ] as const) {
      await dialog.getByRole('tab', { name: title, exact: true }).click();
      await dialog
        .getByRole('combobox', {
          name:
            service === 'LLM'
              ? 'Add backup provider'
              : `Add ${service} provider`,
          exact: true,
        })
        .click();
      const search = page.getByRole('combobox', {
        name: 'Search connected providers',
        exact: true,
      });
      await search.fill('no such account');
      await expect(
        page.getByText('No matching providers.', { exact: true }),
      ).toBeVisible();
      await search.fill('WORK');
      await expect(
        page.getByRole('option', { name: 'OpenRouter work', exact: true }),
      ).toBeVisible();
      await search.press('ArrowDown');
      await search.press('Enter');
      await expect(
        dialog.getByRole('combobox', {
          name: `${service} provider 2`,
          exact: true,
        }),
      ).toContainText('OpenRouter work');
      if (service === 'LLM') {
        await expect(
          dialog.getByRole('heading', {
            name: 'Primary provider',
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          dialog.getByRole('heading', {
            name: 'Backup provider 1',
            exact: true,
          }),
        ).toBeVisible();
        await page.screenshot({
          path: info.outputPath('ai-chat-backups-desktop.png'),
        });
        await dialog
          .getByLabel('OpenRouter work llm route model', { exact: true })
          .fill('test/small');
        await dialog
          .getByLabel('OpenRouter work llm route model', { exact: true })
          .press('Tab');
        await dialog
          .getByRole('button', {
            name: 'Move OpenRouter work up in llm',
            exact: true,
          })
          .click();
        await expect(
          dialog.getByRole('combobox', { name: 'LLM provider 1', exact: true }),
        ).toContainText('OpenRouter work');
        await dialog
          .getByRole('button', {
            name: 'Move OpenRouter work down in llm',
            exact: true,
          })
          .click();
        await expect(
          dialog.getByRole('combobox', { name: 'LLM provider 2', exact: true }),
        ).toContainText('OpenRouter work');
        await dialog
          .getByRole('button', {
            name: 'Remove OpenRouter work from llm',
            exact: true,
          })
          .click();
        await expect(
          dialog.getByRole('heading', {
            name: 'Backup provider 1',
            exact: true,
          }),
        ).toHaveCount(0);
        await dialog
          .getByRole('combobox', { name: 'Add backup provider', exact: true })
          .click();
        await page
          .getByRole('option', { name: 'OpenRouter work', exact: true })
          .click();
        await dialog
          .getByLabel('OpenRouter work llm route model', { exact: true })
          .fill('test/small');
        await dialog
          .getByLabel('OpenRouter work llm route model', { exact: true })
          .press('Tab');
      }
      if (service === 'STT') {
        // OpenRouter itself remains available alongside the selected local/second account routes.
        await dialog
          .getByRole('combobox', { name: 'Add STT provider', exact: true })
          .click();
        await page
          .getByRole('option', { name: 'OpenRouter', exact: true })
          .click();
      }
    }
    for (const account of ['OpenRouter work', 'OpenRouter']) {
      await dialog
        .getByRole('combobox', {
          name: `${account} stt route model`,
          exact: true,
        })
        .click();
      await expect(
        page.getByRole('option', {
          name: `${account === 'OpenRouter work' ? 'Work' : 'Personal'} Whisper · openai/whisper-1`,
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByRole('combobox', { name: 'Search models', exact: true })
        .press('Escape');
    }
    expect(discoveryAccounts).toEqual([
      'Bearer synthetic-secondary-account',
      'Bearer synthetic-first-account',
    ]);
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog.getByRole('tab', { name: 'Providers', exact: true }).click();
    await page.screenshot({
      path: info.outputPath('provider-accounts-mobile.png'),
    });
    await dialog
      .getByRole('button', { name: 'Disconnect OpenRouter', exact: true })
      .click();
    await dialog.getByRole('tab', { name: 'LLM - Chat', exact: true }).click();
    await expect(
      dialog.getByRole('combobox', { name: 'LLM provider 1', exact: true }),
    ).toContainText('Disconnected');
    await dialog.getByRole('tab', { name: 'Providers', exact: true }).click();
    await expect(
      dialog.getByRole('button', {
        name: 'Verify OpenRouter work',
        exact: true,
      }),
    ).toBeVisible();
    await dialog.getByRole('tab', { name: 'LLM - Chat', exact: true }).click();
    const models = dialog.getByRole('combobox', {
      name: 'AI model',
      exact: true,
    });
    await models.click();
    await expect(
      page.getByRole('option', {
        name: 'Test model · test/model',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('option', {
        name: 'Small context model · test/small',
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole('combobox', { name: 'Search models', exact: true })
      .press('Escape');
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('combobox', { name: 'LLM provider 1', exact: true })
      .click();
    await expect(
      page.getByRole('option', { name: 'OpenRouter', exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.reload();
    await openAISettings(page);
    await dialog.getByRole('tab', { name: 'Providers', exact: true }).click();
    await expect(
      dialog.getByRole('button', {
        name: 'Verify OpenRouter work',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Verify OpenRouter', exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByRole('button', { name: 'Disconnect OpenRouter', exact: true })
      .click();
    const saved = await page.evaluate(() => ({
      config: JSON.parse(
        JSON.parse(localStorage.getItem('localcut.workspace-preferences.v1')!)
          .preferences.aiProviders,
      ),
      credentialKeys: Object.keys(localStorage).filter((key) =>
        key.startsWith('localcut.openrouter-credential.v1'),
      ),
    }));
    expect(saved.config.profiles.map((p: { name: string }) => p.name)).toEqual([
      'OpenRouter work',
    ]);
    expect(saved.config.routes.llm).toHaveLength(1);
    expect(saved.config.routes.tts).toHaveLength(1);
    expect(
      saved.config.routes.stt.map((r: { providerId: string }) => r.providerId),
    ).toContain('local');
    expect(saved.credentialKeys).toHaveLength(1);
    expect(saved.credentialKeys[0]).toContain(':');
    expect(JSON.stringify(saved.config)).not.toContain('synthetic-');
    expect(paid).toBe(0);
  });
}
