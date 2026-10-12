import { expect, test } from '@playwright/test';
import {
  openAISettings,
  selectAISettingsTab,
  prepareOpenRouterKey,
} from './workspace-settings-helper';

for (const base of ['/', '/LocalCut/']) {
  test(`TTS connector catalog voices and compact dropdown options ${base}`, async ({
    page,
    context,
  }, testInfo) => {
    let paid = 0;
    const first = 'google/gemini-3.8-flash-tts';
    const second = 'google/gemini-3.8-flash-lite-tts';
    let fail = false;
    await context.route('https://openrouter.ai/api/v1/**', async (route) => {
      const headers = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization,content-type',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
      };
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({ headers, body: '' });
      if (new URL(route.request().url()).pathname.endsWith('/models')) {
        if (fail) return route.fulfill({ headers, status: 503, body: '' });
        return route.fulfill({
          headers,
          json: {
            data: [
              {
                id: first,
                name: 'Gemini Flash',
                architecture: { output_modalities: ['speech'] },
                supported_voices: ['Zephyr', 'Kore'],
              },
              {
                id: second,
                name: 'Gemini Lite',
                architecture: { output_modalities: ['speech'] },
                supported_voices: ['Puck'],
              },
            ],
          },
        });
      }
      paid++;
      return route.abort();
    });
    await page.goto(base);
    await openAISettings(page);
    await prepareOpenRouterKey(page);
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await dialog
      .getByLabel('OpenRouter API key')
      .fill('synthetic-dropdown-key');
    await dialog
      .getByRole('button', { name: 'Use API key', exact: true })
      .click();
    await selectAISettingsTab(page, 'LLM - Chat');
    await dialog
      .getByRole('combobox', { name: 'LLM provider 1', exact: true })
      .click();
    await expect(
      page.getByRole('option', { name: 'OpenRouter', exact: true }),
    ).toBeVisible();
    expect(
      await page
        .locator('[data-slot=combobox-empty]')
        .evaluate((el) => el.getBoundingClientRect().height),
    ).toBe(0);
    await page.keyboard.press('Escape');
    await dialog
      .getByRole('tab', { name: 'TTS - Speech', exact: true })
      .click();
    await selectAISettingsTab(page, 'TTS - Speech');
    const model = dialog.getByRole('combobox', {
      name: 'OpenRouter tts route model',
      exact: true,
    });
    const voice = dialog.getByRole('combobox', {
      name: 'OpenRouter TTS voice',
      exact: true,
    });
    await model.click();
    const popup = page.locator('[data-slot="combobox-content"]');
    await expect(
      page.getByRole('option', { name: /Gemini Flash/ }),
    ).toBeVisible();
    expect(
      await popup
        .locator('[data-slot="combobox-empty"]')
        .evaluate((el) => el.getBoundingClientRect().height),
    ).toBe(0);
    const search = page.getByRole('combobox', {
      name: 'Search models',
      exact: true,
    });
    await search.fill('no such model');
    await expect(
      page.getByText('No matching models.', { exact: true }),
    ).toBeVisible();
    await search.fill('Flash');
    await search.press('ArrowDown');
    await search.press('Enter');
    await voice.click();
    const select = page.locator('[data-slot="select-content"]');
    const option = page.getByRole('option', { name: 'Zephyr', exact: true });
    await expect(option).toBeVisible();
    const top =
      (await option.boundingBox())!.y - (await select.boundingBox())!.y;
    expect(top).toBeLessThanOrEqual(2);
    await page.screenshot({
      path: testInfo.outputPath('tts-voice-dropdown-desktop.png'),
    });
    await option.click();
    await expect(voice).toContainText('Zephyr');
    await voice.focus();
    await voice.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(voice).toBeFocused();
    await model.click();
    await page.getByRole('option', { name: /Gemini Lite/ }).click();
    await expect(voice).toContainText('Choose a voice');
    await voice.click();
    await expect(
      page.getByRole('option', { name: 'Zephyr', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('option', { name: 'Puck', exact: true }).click();
    fail = true;
    await model.click();
    await page
      .getByRole('button', { name: 'Refresh models', exact: true })
      .click();
    await expect(
      dialog.getByText('Could not load models. Try refreshing.', {
        exact: true,
      }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    fail = false;
    await model.click();
    await page
      .getByRole('button', { name: 'Refresh models', exact: true })
      .click();
    await expect(
      dialog.getByText('Could not load models. Try refreshing.', {
        exact: true,
      }),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await voice.click();
    await expect(select).toBeVisible();
    const bounds = (await select.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: testInfo.outputPath('tts-voice-dropdown-narrow.png'),
    });
    await page.keyboard.press('Escape');
    await dialog
      .getByRole('combobox', { name: 'Add TTS provider', exact: true })
      .click();
    await expect(
      page.getByText('All available providers are already added.', {
        exact: true,
      }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page.reload();
    await openAISettings(page);
    await dialog
      .getByRole('tab', { name: 'TTS - Speech', exact: true })
      .click();
    await expect(voice).toContainText('Puck');
    expect(paid).toBe(0);
  });
}
