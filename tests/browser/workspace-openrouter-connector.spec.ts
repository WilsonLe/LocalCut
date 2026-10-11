import { expect, test } from '@playwright/test';
import { openAISettings } from './workspace-settings-helper';
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
for (const base of ['/', '/LocalCut/']) {
  test(`OpenRouter connector removes, re-adds, replaces credentials and reconnects without changing routes ${base}`, async ({
    page,
    context,
  }, info) => {
    let exchanges = 0;
    let deny = true;
    let paid = 0;
    await context.route('https://openrouter.ai/api/v1/**', async (route) => {
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({ headers: cors, body: '' });
      if (route.request().url().endsWith('/models'))
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
      if (route.request().url().endsWith('/auth/keys')) {
        exchanges++;
        return route.fulfill({
          headers: cors,
          json: { key: 'synthetic-reconnected' },
        });
      }
      paid++;
      return route.abort();
    });
    await context.route('https://openrouter.ai/auth?*', async (route) => {
      const auth = new URL(route.request().url());
      const callback = new URL(auth.searchParams.get('callback_url')!);
      expect(callback.hash).toBe('');
      expect(callback.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(auth.searchParams.has('state')).toBe(false);
      if (deny) callback.searchParams.set('error', 'access_denied');
      else callback.searchParams.set('code', 'synthetic-code');
      await route.fulfill({
        contentType: 'text/html',
        body: `<a href="${callback.href.replaceAll('&', '&amp;')}">Return to LocalCut</a>`,
      });
    });
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    const config = () =>
      page.evaluate(() =>
        JSON.parse(
          JSON.parse(localStorage.getItem('localcut.workspace-preferences.v1')!)
            .preferences.aiProviders,
        ),
      );
    const credential = () =>
      page.evaluate(() =>
        localStorage.getItem('localcut.openrouter-credential.v1'),
      );
    await page.goto(base);
    await openAISettings(page);
    await dialog
      .getByRole('button', { name: 'Remove OpenRouter', exact: true })
      .click();
    await expect(
      dialog.getByRole('button', { name: 'Add OpenRouter', exact: true }),
    ).toBeVisible();
    expect((await config()).profiles).toEqual([]);
    await page.reload();
    await openAISettings(page);
    await expect(
      dialog.getByRole('button', {
        name: 'Connect with OpenRouter',
        exact: true,
      }),
    ).toHaveCount(0);
    await dialog
      .getByRole('button', { name: 'Add OpenRouter', exact: true })
      .click();
    await dialog
      .getByLabel('OpenRouter API key', { exact: true })
      .fill('synthetic-original');
    await dialog
      .getByRole('button', { name: 'Use API key', exact: true })
      .click();
    await expect(
      dialog.getByText('Key connected', { exact: true }),
    ).toBeVisible();
    await dialog.getByText('STT · Transcription', { exact: true }).click();
    await dialog
      .getByRole('button', { name: 'OpenRouter', exact: true })
      .click();
    await expect(dialog.getByLabel('OpenRouter stt route model')).toHaveValue(
      'openai/whisper-1',
    );
    await dialog
      .getByRole('button', { name: 'Move OpenRouter up in stt', exact: true })
      .click();
    const original = await config();
    expect(
      original.routes.stt.map((r: { providerId: string }) => r.providerId),
    ).toEqual(['openrouter', 'local']);
    await dialog.getByText('Replace API key', { exact: true }).click();
    await dialog
      .getByLabel('OpenRouter API key', { exact: true })
      .fill('synthetic-replacement');
    await dialog
      .getByRole('button', { name: 'Use API key', exact: true })
      .click();
    await expect.poll(credential).toContain('synthetic-replacement');
    expect(await config()).toEqual(original);
    await dialog
      .getByRole('button', { name: 'Reconnect OpenRouter', exact: true })
      .click();
    await page
      .getByRole('link', { name: 'Return to LocalCut', exact: true })
      .click();
    await expect(
      dialog.getByText('Key connected', { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByRole('alert')).toContainText('cancelled');
    expect(exchanges).toBe(0);
    expect(await credential()).toContain('synthetic-replacement');
    await page.reload();
    await openAISettings(page);
    await expect(
      dialog.getByText('Key connected', { exact: true }),
    ).toBeVisible();
    deny = false;
    await dialog
      .getByRole('button', { name: 'Reconnect OpenRouter', exact: true })
      .click();
    await page
      .getByRole('link', { name: 'Return to LocalCut', exact: true })
      .click();
    await expect(
      dialog.getByText('Key connected', { exact: true }),
    ).toBeVisible();
    expect(exchanges).toBe(1);
    expect(new URL(page.url()).search).toBe('');
    expect(await credential()).toContain('synthetic-reconnected');
    expect(await config()).toEqual(original);
    expect(paid).toBe(0);
    await page.screenshot({ path: info.outputPath('connector-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: info.outputPath('connector-mobile.png') });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Workspace settings', exact: true }),
    ).toBeFocused();
  });
}
