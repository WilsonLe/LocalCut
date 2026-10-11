import { openAISettings } from './workspace-settings-helper';
import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';

async function toggleAnimation(trigger: Locator) {
  const result = await trigger.evaluate(async (element) => {
    const id = element.getAttribute('aria-controls');
    (element as HTMLButtonElement).click();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const panel = document.getElementById(
      id ?? element.getAttribute('aria-controls')!,
    )!;
    const animation = panel
      .getAnimations()
      .find((animation) => animation.playState === 'running');
    const state = {
      panelId: panel.id,
      expanded: element.getAttribute('aria-expanded') === 'true',
    };
    if (!animation) return { ...state, animated: false, between: false };
    const duration = Number(animation.effect!.getComputedTiming().duration);
    animation.currentTime = duration / 2;
    const height = panel.getBoundingClientRect().height;
    const between = height > 0 && height < panel.scrollHeight;
    animation.finish();
    return { ...state, animated: duration > 0, between };
  });
  // Finishing the sampled CSS animation still leaves Base UI's completion
  // callback pending. Wait for its committed panel state before sending keys.
  await expect
    .poll(() =>
      trigger.evaluate((_, id) => {
        const panel = document.getElementById(id);
        return !panel || panel.hidden;
      }, result.panelId),
    )
    .toBe(!result.expanded);
  return { animated: result.animated, between: result.between };
}

for (const base of ['/', '/LocalCut/']) {
  test(`spacious AI settings animate disclosures and preserve input on desktop and phone ${base}`, async ({
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
    await expect(
      dialog.getByRole('heading', {
        name: 'Providers & services',
        exact: true,
      }),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Add provider', exact: true })
      .click();
    const name = dialog.getByLabel('Name', { exact: true });
    await name.fill('Unsaved provider');
    const keyPanel = dialog.getByRole('button', {
      name: 'Use an API key instead',
      exact: true,
    });
    const key = dialog.getByLabel('OpenRouter API key', { exact: true });
    await key.fill('synthetic-unsaved-key');
    expect(await toggleAnimation(keyPanel)).toEqual({
      animated: true,
      between: true,
    });
    await expect(key).not.toBeVisible();
    await keyPanel.focus();
    await keyPanel.press('Space');
    await expect(key).toHaveValue('synthetic-unsaved-key');
    await expect(key).toBeVisible();
    await expect(name).toHaveValue('Unsaved provider');
    const service = dialog.getByRole('button', {
      name: 'STT · Transcription',
      exact: true,
    });
    await service.scrollIntoViewIfNeeded();
    expect(await toggleAnimation(service)).toEqual({
      animated: true,
      between: true,
    });
    await expect(
      dialog.getByRole('textbox', { name: 'Local Whisper stt route model' }),
    ).toBeDisabled();
    expect(await toggleAnimation(service)).toEqual({
      animated: true,
      between: true,
    });
    await service.focus();
    await service.press('Enter');
    await expect(service).toHaveAttribute('aria-expanded', 'true');
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
    await keyPanel.scrollIntoViewIfNeeded();
    const noMotion = await keyPanel.evaluate(async (element) => {
      const panel = document.getElementById(
        element.getAttribute('aria-controls')!,
      )!;
      (element as HTMLButtonElement).click();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      return {
        property: getComputedStyle(panel).transitionProperty,
        animations: panel.getAnimations().length,
      };
    });
    expect(noMotion).toEqual({ property: 'none', animations: 0 });
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
    await context.route('https://openrouter.ai/api/v1/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({ headers: cors, body: '' });
      if (path.endsWith('/models'))
        return route.fulfill({
          headers: cors,
          json: {
            data: [
              {
                id: 'test/model',
                name: 'Test model',
                context_length: 32000,
                supported_parameters: ['tools'],
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
    const addLLM = dialog.getByRole('combobox', {
      name: 'Add LLM provider',
      exact: true,
    });
    await expect(
      dialog
        .getByRole('region', { name: 'LLM · Chat', exact: true })
        .getByText('No connected providers. Connect a provider above.', {
          exact: true,
        }),
    ).toBeVisible();
    await addLLM.click();
    await expect(
      page.getByText(
        'No connected providers for this service. Connect a provider above.',
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
      dialog.getByText('Credentials verified with provider.', { exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Add provider', exact: true })
      .click();
    await expect(
      dialog.getByLabel('LLM model (must support tools)', { exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByRole('combobox', { name: 'Provider type', exact: true })
      .click();
    await page.getByRole('option', { name: 'OpenRouter', exact: true }).click();
    await dialog
      .getByLabel('Account name', { exact: true })
      .fill('OpenRouter work');
    await dialog
      .getByRole('button', { name: 'Add OpenRouter account', exact: true })
      .click();
    await dialog
      .getByRole('button', { name: 'Connect with OpenRouter', exact: true })
      .click();
    await page
      .getByRole('link', { name: 'Return to LocalCut', exact: true })
      .click();
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
      ['LLM', 'LLM · Chat'],
      ['TTS', 'TTS · Speech'],
      ['STT', 'STT · Transcription'],
    ] as const) {
      const section = dialog.getByRole('button', { name: title, exact: true });
      if ((await section.getAttribute('aria-expanded')) !== 'true')
        await section.click();
      await dialog
        .getByRole('combobox', { name: `Add ${service} provider`, exact: true })
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
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog
      .getByRole('button', { name: 'Provider connections', exact: true })
      .click();
    await expect(
      dialog.getByRole('button', {
        name: 'Verify OpenRouter work',
        exact: true,
      }),
    ).toBeHidden();
    await dialog
      .getByRole('button', { name: 'Provider connections', exact: true })
      .click();
    await page.screenshot({
      path: info.outputPath('provider-accounts-mobile.png'),
    });
    await dialog
      .getByRole('button', { name: 'Disconnect OpenRouter', exact: true })
      .click();
    await expect(
      dialog.getByRole('combobox', { name: 'LLM provider 1', exact: true }),
    ).toContainText('Disconnected');
    await expect(
      dialog.getByRole('button', {
        name: 'Verify OpenRouter work',
        exact: true,
      }),
    ).toBeVisible();
    await dialog
      .getByRole('combobox', { name: 'LLM provider 1', exact: true })
      .click();
    await expect(
      page.getByRole('option', { name: 'OpenRouter', exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.reload();
    await openAISettings(page);
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
      .getByRole('button', { name: 'Remove OpenRouter', exact: true })
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
