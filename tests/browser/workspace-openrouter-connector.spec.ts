import { expect, test } from '@playwright/test';
import {
  addOpenRouter,
  prepareOpenRouterKey,
  openAISettings,
} from './workspace-settings-helper';
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
for (const base of ['/', '/LocalCut/']) {
  test(`provider empty state reveals OpenRouter key or login choices on desktop and phone ${base}`, async ({
    page,
    context,
  }, info) => {
    let requests = 0;
    await context.route('https://openrouter.ai/**', (route) => {
      requests++;
      return route.abort();
    });
    await page.goto(base);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await openAISettings(page);
      const dialog = page.getByRole('dialog', {
        name: 'AI connection',
        exact: true,
      });
      await expect(
        dialog.getByText('No AI providers added', { exact: true }),
      ).toBeVisible();
      await expect(dialog.getByText('OpenRouter', { exact: true })).toHaveCount(
        0,
      );
      await expect(
        dialog.getByLabel('OpenRouter API key', { exact: true }),
      ).toHaveCount(0);
      await page.screenshot({
        path: info.outputPath(`providers-empty-${width}.png`),
      });
      await addOpenRouter(page);
      await expect(
        dialog.getByText('Do you already have an API key?', { exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByRole('button', {
          name: 'Log in and generate a key',
          exact: true,
        }),
      ).toBeVisible();
      const choice = dialog.getByRole('button', {
        name: 'I have an API key',
        exact: true,
      });
      const input = dialog.getByLabel('OpenRouter API key', { exact: true });
      await expect(input).toHaveCount(0);
      await page.screenshot({
        path: info.outputPath(`openrouter-choice-${width}.png`),
      });
      await choice.focus();
      await choice.press('Enter');
      await expect(input).toBeFocused();
      await input.fill('synthetic-draft');
      await dialog.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(input).toHaveCount(0);
      await expect(choice).toBeFocused();
      await choice.click();
      await expect(input).toHaveValue('');
      await expect
        .poll(() => dialog.evaluate((el) => el.scrollWidth <= el.clientWidth))
        .toBe(true);
      await dialog
        .getByRole('button', { name: 'Disconnect OpenRouter', exact: true })
        .click();
      await expect(
        dialog.getByText('No AI providers added', { exact: true }),
      ).toBeVisible();
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
      await page.reload();
    }
    expect(requests).toBe(0);
  });
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
      if (
        route
          .request()
          .url()
          .endsWith('/models?output_modalities=transcription')
      )
        return route.fulfill({
          headers: cors,
          json: {
            data: [
              { id: 'openai/whisper-1', name: 'Whisper' },
              { id: 'openai/whisper-large-v3', name: 'Whisper Large V3' },
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
          JSON.parse(
            localStorage.getItem('localcut.workspace-preferences.v1') ?? '{}',
          ).preferences?.aiProviders ?? 'null',
        ),
      );
    const credential = () =>
      page.evaluate(() =>
        localStorage.getItem('localcut.openrouter-credential.v1'),
      );
    await page.goto(base);
    await openAISettings(page);
    await expect(
      dialog.getByText('No AI providers added', { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Add provider', exact: true }),
    ).toBeVisible();
    expect(await config()).toBeNull();
    await page.reload();
    await openAISettings(page);
    await expect(
      dialog.getByRole('button', {
        name: 'Log in and generate a key',
        exact: true,
      }),
    ).toHaveCount(0);
    await prepareOpenRouterKey(page);
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
    await expect(dialog.getByLabel('OpenRouter stt route model')).toContainText(
      'openai/whisper-1',
    );
    await dialog
      .getByRole('combobox', {
        name: 'OpenRouter stt route model',
        exact: true,
      })
      .click();
    await page
      .getByRole('combobox', { name: 'Search models', exact: true })
      .fill('large');
    await page
      .getByRole('option', {
        name: 'Whisper Large V3 · openai/whisper-large-v3',
        exact: true,
      })
      .click();
    expect((await config()).routes.stt[1].model).toBe(
      'openai/whisper-large-v3',
    );
    await expect(
      dialog.getByText('Remote transcription sends selected audio', {
        exact: false,
      }),
    ).toHaveCount(0);
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
      dialog.getByRole('button', {
        name: 'Disconnect OpenRouter',
        exact: true,
      }),
    ).toBeHidden();
    await connections.click();
    await expect(
      dialog.getByRole('button', {
        name: 'Disconnect OpenRouter',
        exact: true,
      }),
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
      .getByRole('button', { name: 'Disconnect OpenRouter', exact: true })
      .click();
    expect(await credential()).toBeNull();
    // A disconnected account can be forgotten through the same control.
    await dialog
      .getByRole('button', { name: 'Disconnect OpenRouter', exact: true })
      .click();
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
