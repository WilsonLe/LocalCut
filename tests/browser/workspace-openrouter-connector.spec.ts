import { expect, test } from '@playwright/test';
import { openAISettings } from './workspace-settings-helper';
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
for (const base of ['/', '/LocalCut/']) {
  test(`OpenRouter connector removes and re-adds with compact connected management ${base}`, async ({
    page,
    context,
  }, info) => {
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
                context_length: 512000,
                supported_parameters: ['tools'],
              },
            ],
          },
        });
      paid++;
      return route.abort();
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
      dialog.getByRole('combobox', { name: 'AI model', exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText('Key connected', { exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByText('Replace API key', { exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole('button', { name: 'Reconnect OpenRouter', exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByLabel('OpenRouter API key', { exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByRole('button', { name: 'STT · Transcription', exact: true })
      .click();
    await dialog
      .getByRole('combobox', { name: 'Add STT provider', exact: true })
      .click();
    await page.getByRole('option', { name: 'OpenRouter', exact: true }).click();
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
    const connections = dialog.getByRole('button', {
      name: 'Provider connections',
      exact: true,
    });
    await connections.click();
    await expect(
      dialog.getByRole('button', { name: 'Remove OpenRouter', exact: true }),
    ).toBeHidden();
    await connections.click();
    await expect(
      dialog.getByRole('button', { name: 'Remove OpenRouter', exact: true }),
    ).toBeVisible();
    await page.reload();
    await openAISettings(page);
    await expect(
      dialog.getByRole('combobox', { name: 'AI model', exact: true }),
    ).toBeVisible();
    expect(await config()).toEqual(original);
    expect(await credential()).toContain('synthetic-original');
    expect(paid).toBe(0);
    await page.screenshot({ path: info.outputPath('connector-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: info.outputPath('connector-mobile.png') });
    await dialog
      .getByRole('button', { name: 'Remove OpenRouter', exact: true })
      .click();
    expect(await credential()).toBeNull();
    expect((await config()).routes.stt).toEqual([
      { providerId: 'local', model: 'whisper' },
    ]);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Workspace settings', exact: true }),
    ).toBeFocused();
  });
}
