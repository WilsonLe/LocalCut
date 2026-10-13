import {
  selectAISettingsTab,
  prepareOpenRouterKey,
  openAISettings,
} from './workspace-settings-helper';
import { expect, test } from '@playwright/test';
import type { Page, BrowserContext } from '@playwright/test';
import type { Project } from '../../src/editor';

const model = 'google/gemini-3.8-flash-tts';
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
function tone() {
  const bytes = Buffer.alloc(24000 * 2 * 2);
  for (let i = 0; i < 48000; i++)
    bytes.writeInt16LE(
      Math.round(Math.sin((i * 2 * Math.PI * 220) / 24000) * 12000),
      i * 2,
    );
  return bytes;
}
async function connect(
  page: Page,
  context: BrowserContext,
  base: string,
  profileName = 'OpenRouter',
  sttProvider: 'local' | 'openrouter' = 'openrouter',
  includeElevenLabs = false,
) {
  await context.route('https://openrouter.ai/api/v1/models**', (route) =>
    route.request().url().endsWith('/endpoints')
      ? route.fulfill({
          headers: cors,
          json: { data: { endpoints: [{ supports_voice_cloning: true }] } },
        })
      : route.fulfill({
          headers: cors,
          json: {
            data: [
              ...(includeElevenLabs
                ? [
                    'elevenlabs/eleven-multilingual-v2',
                    'elevenlabs/eleven-v4',
                    'elevenlabs/eleven-v3',
                  ].map((id) => ({
                    id,
                    name: id,
                    architecture: { output_modalities: ['speech'] },
                    supported_voices: ['george', 'sarah'],
                  }))
                : []),
              {
                id: model,
                name: 'Google: Gemini 3.8 Flash TTS',
                context_length: 0,
                supported_parameters: [],
                architecture: { output_modalities: ['speech'] },
                supported_voices: ['Kore', 'Puck'],
              },
              {
                id: 'fish-audio/s2.1-pro',
                name: 'Fish Audio: S2.1 Pro',
                architecture: { output_modalities: ['speech'] },
              },
            ],
          },
        }),
  );
  // Controlled remote alignment; production UI/native audio/storage remain real Chrome.
  await context.addInitScript(
    ({ profileName, sttProvider }) => {
      if (!localStorage.getItem('localcut.workspace-preferences.v1'))
        localStorage.setItem(
          'localcut.workspace-preferences.v1',
          JSON.stringify({
            version: 1,
            preferences: {
              aiProviders: JSON.stringify({
                profiles: [
                  { id: 'openrouter', name: profileName, kind: 'openrouter' },
                ],
                routes: {
                  llm: [{ providerId: 'openrouter', model: '' }],
                  tts: [{ providerId: 'openrouter', model: '' }],
                  stt: [
                    {
                      providerId: sttProvider,
                      model:
                        sttProvider === 'local'
                          ? 'whisper'
                          : 'openai/whisper-large-v3',
                    },
                  ],
                },
              }),
            },
          }),
        );
    },
    { profileName, sttProvider },
  );
  await context.route(
    'https://openrouter.ai/api/v1/audio/transcriptions',
    (route) =>
      route.fulfill({
        headers: cors,
        json: {
          segments: [
            { text: 'Hello!', start: 0.1, end: 0.9 },
            { text: 'Xin chào!', start: 1.0, end: 1.85 },
          ],
        },
      }),
  );
  await page.goto(base);
  await page
    .getByRole('button', { name: 'Workspace settings', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
  await page
    .getByRole('menuitem', { name: 'New project', exact: true })
    .click();
  await page.getByLabel('Project name', { exact: true }).fill('Speech project');
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'New project', exact: true }),
  ).not.toBeVisible();
  const closeToast = page.getByRole('button', {
    name: 'Close toast',
    exact: true,
  });
  if (await closeToast.count()) await closeToast.first().click();
  await openAISettings(page);
  const connection = page.getByRole('dialog', {
    name: 'AI connection',
    exact: true,
  });
  await prepareOpenRouterKey(page);
  await connection
    .getByLabel('OpenRouter API key')
    .fill('synthetic-speech-key');
  await connection
    .getByRole('button', { name: 'Use API key', exact: true })
    .click();
  await selectAISettingsTab(page, 'Providers');
  await expect(
    connection.getByRole('button', { name: 'Verify OpenRouter', exact: true }),
  ).toBeVisible();
  await selectAISettingsTab(page, 'TTS - Speech');
  await connection
    .getByRole('combobox', { name: 'OpenRouter tts route model', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Search models', exact: true })
    .fill('gemini');
  await page
    .getByRole('option', { name: /Gemini/ })
    .first()
    .click();
  await selectAISettingsTab(page, 'TTS - Speech');
  await expect(
    connection.getByRole('combobox', {
      name: 'OpenRouter tts route model',
      exact: true,
    }),
  ).toContainText('Gemini');
  // Speech does not require choosing a tool-capable chat model.
  await connection.getByRole('button', { name: 'Done', exact: true }).click();
  if (
    !(await page.locator('#workspace-media').isVisible()) ||
    (await page.locator('#workspace-media').getAttribute('data-collapsed')) ===
      'true'
  )
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
  const speechBounds = (await page
    .getByRole('button', { name: 'Text to speech', exact: true })
    .boundingBox())!;
  const recordBounds = (await page
    .getByRole('button', { name: 'Record screen', exact: true })
    .boundingBox())!;
  expect(Math.abs(speechBounds.y - recordBounds.y)).toBeLessThan(2);
  expect(recordBounds.x - speechBounds.x - speechBounds.width).toBeLessThan(8);
  await page
    .getByRole('button', { name: 'Text to speech', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Text to speech',
    exact: true,
  });
  await expect(dialog.getByText('Loading speech models…')).not.toBeVisible();
  await configureSpeech(page, dialog);
  return dialog;
}
async function configureSpeech(
  page: Page,
  dialog: ReturnType<Page['getByRole']>,
) {
  await expect(
    dialog.getByRole('combobox', { name: 'Phrase timing', exact: true }),
  ).toHaveCount(0);
  await expect(dialog).not.toContainText('Configured STT route');
  await expect(dialog).not.toContainText(
    'Approving sends the selected source audio',
  );
  await expect(dialog).not.toContainText(
    'Measure phrases locally for later edits.',
  );
  await dialog.getByLabel('Script', { exact: true }).fill('Hello! Xin chào!');
  await dialog.getByLabel('Speed (×)').fill('1');
  await dialog
    .getByRole('combobox', { name: 'Speech model', exact: true })
    .click();
  await page
    .getByRole('option', { name: 'Google: Gemini 3.8 Flash TTS', exact: true })
    .click();
  await dialog
    .getByRole('combobox', { name: 'Speech voice', exact: true })
    .click();
  await page.getByRole('option', { name: 'Kore · Firm', exact: true }).click();
}
async function snapshot(page: Page, base: string): Promise<Project> {
  return page.evaluate(async (base) => {
    const { createEditor } = (await import(
      base + 'editor.js'
    )) as typeof import('../../src/editor');
    const editor = await createEditor();
    try {
      const project = (await editor.projects.list()).find(
        (item) => item.name === 'Speech project',
      )!;
      return await editor.projects.snapshot(project.id);
    } finally {
      await editor.dispose();
    }
  }, base);
}
for (const base of ['/', '/LocalCut/']) {
  test(`ElevenLabs speech configuration presets persist and submit supported options ${base}`, async ({
    page,
    context,
  }, info) => {
    const requests: Record<string, unknown>[] = [];
    const mp3 = Buffer.concat(
      Array.from({ length: 80 }, () =>
        Buffer.concat([
          Buffer.from([0xff, 0xfb, 0x90, 0xc0]),
          Buffer.alloc(413),
        ]),
      ),
    );
    await context.route(
      'https://openrouter.ai/api/v1/audio/speech',
      async (route) => {
        requests.push(route.request().postDataJSON());
        await route.fulfill({
          headers: cors,
          contentType: 'audio/mpeg',
          body: mp3,
        });
      },
    );
    let dialog = await connect(
      page,
      context,
      base,
      'OpenRouter',
      'openrouter',
      true,
    );
    const eleven = 'elevenlabs/eleven-multilingual-v2';
    const chooseModel = async (id: string) => {
      await dialog
        .getByRole('combobox', { name: 'Speech model', exact: true })
        .click();
      await page.getByRole('option', { name: id, exact: true }).click();
    };
    await chooseModel(eleven);
    await dialog
      .getByRole('combobox', { name: 'Speech voice', exact: true })
      .click();
    await page.getByRole('option', { name: 'george', exact: true }).click();
    await expect(dialog.getByLabel('Delivery directions')).toHaveCount(0);
    await expect(
      dialog.getByRole('combobox', {
        name: 'Languages in script',
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(dialog.getByLabel('Seed', { exact: true })).not.toBeVisible();
    await dialog.getByLabel('Stability', { exact: true }).fill('0.6');
    await dialog.getByLabel('Similarity', { exact: true }).fill('0.8');
    await dialog.getByLabel('Speaking rate (×)', { exact: true }).fill('0.95');
    await dialog.getByText('Advanced voice settings', { exact: true }).focus();
    await page.keyboard.press('Enter');
    await dialog.getByLabel('Seed', { exact: true }).fill('0');
    await dialog.getByLabel('Style strength', { exact: true }).fill('0.1');
    await expect(
      dialog.getByLabel('Language code', { exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByRole('combobox', { name: 'Speaker boost', exact: true })
      .click();
    await page.getByRole('option', { name: 'Off', exact: true }).click();
    await dialog.getByLabel('Previous text', { exact: true }).fill('Before.');
    await dialog
      .getByRole('button', {
        name: 'Add pronunciation dictionary',
        exact: true,
      })
      .click();
    await expect(
      dialog.getByRole('button', { name: 'Generate speech', exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByLabel('Pronunciation dictionary 1', { exact: true })
      .fill('dictionary-1');
    await dialog
      .getByLabel('Dictionary 1 version', { exact: true })
      .fill('version-1');
    await dialog.getByLabel('Seed', { exact: true }).fill('4294967296');
    await expect(
      dialog.getByRole('button', { name: 'Generate speech', exact: true }),
    ).toHaveCount(0);
    await dialog.getByLabel('Seed', { exact: true }).fill('0');
    await dialog
      .getByLabel('New preset name', { exact: true })
      .fill('Eleven narrator');
    await dialog
      .getByRole('button', { name: 'Save configuration', exact: true })
      .click();
    await expect(
      dialog.getByText('Unsaved changes', { exact: true }),
    ).toHaveCount(0);
    await dialog.getByLabel('Seed', { exact: true }).fill('7');
    await dialog
      .getByRole('button', { name: 'Save preset changes', exact: true })
      .click();
    await expect(
      dialog.getByText('Unsaved changes', { exact: true }),
    ).toHaveCount(0);
    await dialog.getByLabel('Seed', { exact: true }).fill('0');
    await dialog
      .getByRole('button', { name: 'Save preset changes', exact: true })
      .click();
    expect(requests).toHaveLength(0);
    await chooseModel('elevenlabs/eleven-v4');
    await expect(
      dialog.getByLabel('Speaking rate (×)', { exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByLabel('Style strength', { exact: true }),
    ).toHaveCount(0);
    await chooseModel('elevenlabs/eleven-v3');
    await expect(dialog.getByLabel('Similarity', { exact: true })).toHaveCount(
      0,
    );
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.reload();
    await page
      .getByRole('button', { name: 'Text to speech', exact: true })
      .click();
    dialog = page.getByRole('dialog', { name: 'Text to speech', exact: true });
    await dialog
      .getByRole('combobox', { name: 'Voice preset', exact: true })
      .click();
    await page.getByLabel('Search voice presets').fill('Eleven narrator');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(dialog.getByLabel('Stability', { exact: true })).toHaveValue(
      '0.6',
    );
    await expect(
      dialog.getByLabel('Speaking rate (×)', { exact: true }),
    ).toHaveValue('0.95');
    await dialog.getByText('Advanced voice settings', { exact: true }).click();
    await expect(dialog.getByLabel('Seed', { exact: true })).toHaveValue('0');
    await expect(
      dialog.getByRole('combobox', { name: 'Speaker boost', exact: true }),
    ).toContainText('Off');
    await expect(
      dialog.getByLabel('Pronunciation dictionary 1', { exact: true }),
    ).toHaveValue('dictionary-1');
    expect(requests).toHaveLength(0);
    if (base === '/') {
      await page.setViewportSize({ width: 1366, height: 900 });
      await dialog.locator('fieldset').evaluate((element) => {
        element.parentElement!.scrollTop = 0;
      });
      await page.screenshot({
        path: info.outputPath('elevenlabs-desktop.png'),
      });
      await page.setViewportSize({ width: 375, height: 812 });
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await page.screenshot({ path: info.outputPath('elevenlabs-mobile.png') });
      await page.setViewportSize({ width: 1366, height: 900 });
    }
    await dialog.getByLabel('Script', { exact: true }).fill('Hello! Xin chào!');
    await dialog
      .getByRole('button', { name: 'Generate speech', exact: true })
      .click();
    await expect(dialog.getByLabel('Generated speech preview')).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      model: eleven,
      voice: 'george',
      input: 'Hello! Xin chào!',
      response_format: 'mp3',
      provider: {
        data_collection: 'deny',
        options: {
          elevenlabs: {
            seed: 0,
            previous_text: 'Before.',
            pronunciation_dictionary_locators: [
              {
                pronunciation_dictionary_id: 'dictionary-1',
                version_id: 'version-1',
              },
            ],
            voice_settings: {
              stability: 0.6,
              similarity_boost: 0.8,
              speed: 0.95,
              style: 0.1,
              use_speaker_boost: false,
            },
          },
        },
      },
    });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.reload();
    await page
      .getByRole('button', { name: 'Text to speech', exact: true })
      .click();
    dialog = page.getByRole('dialog', { name: 'Text to speech', exact: true });
    await expect(dialog.getByLabel('Generated speech preview')).toBeVisible();
    await expect(
      dialog.getByLabel('Speaking rate (×)', { exact: true }),
    ).toHaveValue('0.95');
    await dialog.getByText('Advanced voice settings', { exact: true }).click();
    await expect(dialog.getByLabel('Seed', { exact: true })).toHaveValue('0');
    expect(requests).toHaveLength(1);
  });
  test(`speech provider controls hide unsupported Fish options and restore Gemini ${base}`, async ({
    page,
    context,
  }, info) => {
    const dialog = await connect(page, context, base);
    await dialog
      .getByLabel('Delivery directions')
      .fill('Warm retained directions');
    await dialog
      .getByRole('combobox', { name: 'Speech model', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'Fish Audio: S2.1 Pro', exact: true })
      .click();
    for (const width of [1366, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(dialog.getByLabel('Delivery directions')).toHaveCount(0);
      await expect(
        dialog.getByText('Languages in script', { exact: true }),
      ).toHaveCount(0);
      await expect(
        dialog.getByRole('combobox', { name: 'Speech voice', exact: true }),
      ).toHaveCount(0);
      await expect(dialog.getByLabel('Speed (×)')).toBeEnabled();
      await page.screenshot({
        path: info.outputPath(`fish-controls-${width}.png`),
      });
    }
    await dialog
      .getByRole('combobox', { name: 'Speech model', exact: true })
      .click();
    await page
      .getByRole('option', {
        name: 'Google: Gemini 3.8 Flash TTS',
        exact: true,
      })
      .click();
    await expect(dialog.getByLabel('Delivery directions')).toHaveValue(
      'Warm retained directions',
    );
    await expect(
      dialog.getByRole('combobox', {
        name: 'Languages in script',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('combobox', { name: 'Speech voice', exact: true }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.setViewportSize({ width: 1366, height: 900 });
    await openAISettings(page);
    const settings = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await selectAISettingsTab(page, 'TTS - Speech');
    const picker = settings.getByRole('combobox', {
      name: 'OpenRouter tts route model',
      exact: true,
    });
    await expect(
      settings.getByRole('combobox', {
        name: 'OpenRouter TTS voice',
        exact: true,
      }),
    ).toBeVisible();
    await picker.click();
    await page
      .getByRole('combobox', { name: 'Search models', exact: true })
      .fill('fish');
    await page.getByRole('option', { name: /Fish Audio/ }).click();
    await expect(
      settings.getByRole('combobox', {
        name: 'OpenRouter TTS voice',
        exact: true,
      }),
    ).toHaveCount(0);
    await picker.click();
    await page
      .getByRole('combobox', { name: 'Search models', exact: true })
      .fill('gemini');
    await page.getByRole('option', { name: /Gemini/ }).click();
    await expect(
      settings.getByRole('combobox', {
        name: 'OpenRouter TTS voice',
        exact: true,
      }),
    ).toBeVisible();
  });

  test(`text to speech voice configurations save settings independently of scripts ${base}`, async ({
    page,
    context,
  }) => {
    const requests: Record<string, unknown>[] = [];
    await context.route(
      'https://openrouter.ai/api/v1/audio/speech',
      async (route) => {
        requests.push(route.request().postDataJSON());
        await route.fulfill({
          headers: cors,
          contentType: 'audio/pcm',
          body: tone(),
        });
      },
    );
    let dialog = await connect(page, context, base);
    await dialog.getByLabel('Script', { exact: true }).fill('');
    await dialog.getByLabel('Speed (×)').fill('1.35');
    await dialog.getByLabel('Delivery directions').fill('Warm and thoughtful');
    await dialog
      .getByRole('combobox', { name: 'Languages in script', exact: true })
      .click();
    await page.getByRole('option', { name: 'Vietnamese', exact: true }).click();
    await page.keyboard.press('Escape');
    await dialog.getByLabel('New preset name').fill('Warm narrator');
    await dialog
      .getByRole('button', { name: 'Save configuration', exact: true })
      .click();
    await expect(
      dialog.getByRole('combobox', { name: 'Voice preset', exact: true }),
    ).toContainText('Warm narrator');
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('localcut.voice-presets.v1')!),
    );
    expect(stored.presets[0]).toMatchObject({
      model,
      voice: 'Kore',
      languages: ['English', 'Vietnamese'],
      instructions: 'Warm and thoughtful',
      timing: { mode: 'speed', speed: 1.35 },
    });
    expect(stored.presets[0]).not.toHaveProperty('script');
    expect(stored.presets[0]).not.toHaveProperty('transcript');
    expect(stored.presets[0]).not.toHaveProperty('referenceId');
    expect(requests).toHaveLength(0);
    await dialog
      .getByRole('combobox', { name: 'Speech voice', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'Puck · Upbeat', exact: true })
      .click();
    await expect(
      dialog.getByRole('combobox', { name: 'Voice preset', exact: true }),
    ).toContainText('Warm narrator');
    await dialog
      .getByRole('button', { name: 'Save preset changes', exact: true })
      .click();
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('localcut.voice-presets.v1')!)
            .presets[0].voice,
      ),
    ).toBe('Puck');
    await dialog
      .getByRole('combobox', { name: 'Speech voice', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'Kore · Firm', exact: true })
      .click();
    await dialog
      .getByRole('button', { name: 'Save preset changes', exact: true })
      .click();
    await dialog
      .getByRole('button', { name: 'Save as new', exact: true })
      .click();
    await dialog.getByLabel('New preset name').fill('Short narrator');
    await dialog
      .getByRole('combobox', { name: 'Speech timing', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'Total length', exact: true })
      .click();
    await dialog.getByLabel('Total length (seconds)').fill('1.5');
    await dialog
      .getByRole('button', { name: 'Save configuration', exact: true })
      .click();
    await dialog.getByLabel('Total length (seconds)').fill('1.6');
    await expect(
      dialog.getByText('Unsaved changes', { exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Save preset changes', exact: true })
      .click();
    await dialog.getByText('Manage voice presets', { exact: false }).click();
    // Keyboard actions retain a useful successor after a row leaves the list.
    await dialog
      .getByRole('button', { name: 'Archive Warm narrator', exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await expect(
      dialog.getByRole('button', {
        name: 'Archive Short narrator',
        exact: true,
      }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      dialog.getByRole('button', { name: 'Show archived', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await dialog
      .getByRole('button', { name: 'Restore Warm narrator', exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await expect(
      dialog.getByRole('button', {
        name: 'Restore Short narrator',
        exact: true,
      }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      dialog.getByRole('button', { name: 'Show active', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await dialog.getByLabel('Search managed voices').fill('Warm');
    await dialog
      .getByRole('button', { name: 'Edit name for Warm narrator', exact: true })
      .click();
    await dialog
      .getByLabel('Rename Warm narrator', { exact: true })
      .fill('Calm narrator');
    await dialog
      .getByLabel('Rename Warm narrator', { exact: true })
      .press('Enter');
    await expect(
      dialog.getByRole('button', { name: 'Show archived', exact: true }),
    ).toBeFocused();
    await dialog.getByLabel('Search managed voices').fill('Calm');
    await dialog
      .getByRole('button', { name: 'Edit name for Calm narrator', exact: true })
      .click();
    await dialog
      .getByLabel('Rename Calm narrator', { exact: true })
      .fill('Warm narrator');
    await dialog
      .getByLabel('Rename Calm narrator', { exact: true })
      .press('Enter');
    await expect(
      dialog.getByRole('button', { name: 'Show archived', exact: true }),
    ).toBeFocused();
    await dialog.getByLabel('Search managed voices').fill('Warm');
    await expect(
      dialog.getByRole('button', { name: 'Use Short narrator', exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByRole('button', { name: 'Use Warm narrator', exact: true })
      .click();
    await expect(dialog.getByLabel('Speed (×)')).toHaveValue('1.35');
    await expect(dialog.getByLabel('Script', { exact: true })).toHaveValue('');
    if (base === '/') {
      await dialog.locator('fieldset').evaluate((element) => {
        element.parentElement!.scrollTop = 0;
      });
      await page.screenshot({
        path: 'docs/images/workspace-voice-configurations.png',
      });
      await page.setViewportSize({ width: 375, height: 812 });
      await expect(dialog).toBeVisible();
      expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(375);
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await dialog.locator('fieldset').evaluate((element) => {
        element.parentElement!.scrollTop = 0;
      });
      await page.screenshot({
        path: 'docs/images/workspace-voice-configurations-narrow.png',
      });
      await page.setViewportSize({ width: 1366, height: 900 });
    }
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Text to speech', exact: true }),
    ).toBeFocused();
    await page.reload();
    await page
      .getByRole('button', { name: 'Text to speech', exact: true })
      .click();
    dialog = page.getByRole('dialog', { name: 'Text to speech', exact: true });
    await expect(dialog.getByText('Loading speech models…')).not.toBeVisible();
    await dialog
      .getByLabel('Script', { exact: true })
      .fill('Independent new narration.');
    await dialog
      .getByRole('combobox', { name: 'Voice preset', exact: true })
      .click();
    await page.getByLabel('Search voice presets').fill('Short');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(
      dialog.getByRole('combobox', { name: 'Voice preset', exact: true }),
    ).toContainText('Short narrator');
    await expect(dialog.getByLabel('Total length (seconds)')).toHaveValue(
      '1.6',
    );
    await expect(dialog.getByLabel('Delivery directions')).toHaveValue(
      'Warm and thoughtful',
    );
    await expect(dialog.getByLabel('Script', { exact: true })).toHaveValue(
      'Independent new narration.',
    );
    expect(requests).toHaveLength(0);
    await dialog
      .getByRole('button', { name: 'Generate speech', exact: true })
      .click();
    await expect(dialog.getByLabel('Generated speech preview')).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      model,
      voice: 'Kore',
      input: 'Independent new narration.',
    });
    expect(requests[0]).not.toHaveProperty('input_references');
    await expect(
      dialog.getByLabel('Generated speech preview'),
    ).toHaveJSProperty('duration', 1.6);
    await page.evaluate(() => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'localcut.voice-presets.v1')
          throw new DOMException('Full', 'QuotaExceededError');
        write.call(this, key, value);
      };
    });
    await dialog
      .getByRole('button', { name: 'Save as new', exact: true })
      .click();
    await dialog.getByLabel('New preset name').fill('Unsaved configuration');
    await dialog
      .getByRole('button', { name: 'Save configuration', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toContainText(
      'Allow browser storage',
    );
    expect(requests).toHaveLength(1);
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('localcut.voice-presets.v1')!).presets
            .length,
      ),
    ).toBe(2);
  });

  test(`text to speech searches saved generations and saves to assets without timeline edits ${base}`, async ({
    page,
    context,
  }) => {
    const requests: Record<string, unknown>[] = [];
    await context.route(
      'https://openrouter.ai/api/v1/audio/speech',
      async (route) => {
        requests.push(route.request().postDataJSON());
        await route.fulfill({
          headers: cors,
          contentType: 'audio/pcm',
          body: tone(),
        });
      },
    );
    const dialog = await connect(page, context, base);
    const preset = dialog.getByRole('combobox', {
      name: 'Voice preset',
      exact: true,
    });
    await expect(preset).toContainText('New voice preset');
    await expect(dialog.getByLabel('New preset name')).toBeVisible();
    await expect(
      dialog.getByRole('combobox', { name: 'Speech generation', exact: true }),
    ).toBeInViewport();
    expect(await dialog.locator('details').getAttribute('open')).toBeNull();
    const lastInput = dialog
      .locator('fieldset input, fieldset textarea')
      .last();
    await expect(lastInput).toHaveAttribute('id', 'speech-script');
    const modelBounds = (await dialog
      .getByRole('combobox', { name: 'Speech model', exact: true })
      .boundingBox())!;
    const voiceBounds = (await dialog
      .getByRole('combobox', { name: 'Speech voice', exact: true })
      .boundingBox())!;
    expect(Math.abs(modelBounds.y - voiceBounds.y)).toBeLessThan(2);
    await expect(
      dialog.getByRole('combobox', { name: 'Speech voice', exact: true }),
    ).toContainText('Kore · Firm');
    await dialog
      .getByRole('combobox', { name: 'Speech timing', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'Total length', exact: true })
      .click();
    await expect(dialog.locator('#speech-duration-guidance')).toContainText(
      'for 3 words at 120–180 words/min',
    );
    await dialog.getByLabel('Total length (seconds)').fill('1.5');
    await dialog
      .getByLabel('Script', { exact: true })
      .fill('First saved narration');
    await dialog
      .getByRole('button', { name: 'Generate speech', exact: true })
      .click();
    await expect(dialog.getByLabel('Generated speech preview')).toBeVisible();
    await expect(dialog.locator('#speech-duration-guidance')).toContainText(
      'Minimum: 1.00s · Maximum: 4.00s',
    );
    await expect(dialog.getByLabel('Total length (seconds)')).toHaveAttribute(
      'min',
      '1',
    );
    await expect(dialog.getByLabel('Total length (seconds)')).toHaveAttribute(
      'max',
      '4',
    );
    const before = await snapshot(page, base);
    await dialog
      .getByRole('button', { name: 'Save to assets', exact: true })
      .click();
    await expect(
      dialog.getByRole('status').filter({ hasText: 'Saved to assets' }),
    ).toBeVisible();
    const after = await snapshot(page, base);
    expect(after.tracks).toEqual(before.tracks);
    expect(after.revision).toBe(before.revision);
    const readSaved = async () =>
      page.evaluate(async (base) => {
        const { createEditor } = (await import(
          base + 'editor.js'
        )) as typeof import('../../src/editor');
        const editor = await createEditor();
        try {
          const project = (await editor.projects.list()).find(
            (item) => item.name === 'Speech project',
          )!;
          const library = await editor.library.forProject(project.id).list();
          const assets = library.entries.filter(
            (entry) => entry.kind === 'asset',
          );
          const transcripts = JSON.parse(
            await editor.projects.exportJSON(project.id),
          ).transcripts;
          return { assets, transcripts };
        } finally {
          await editor.dispose();
        }
      }, base);
    const saved = await readSaved();
    expect(saved.assets).toHaveLength(1);
    await dialog
      .getByRole('button', { name: 'Add to timeline', exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    const reused = await readSaved();
    expect(reused.assets).toHaveLength(1);
    expect(reused.transcripts[0].speech.script).toBe('First saved narration');
    const placed = await snapshot(page, base);
    expect(placed.tracks[0]!.clips[0]!.assetId).toBe(saved.assets[0]!.assetId);
    await page.reload();
    await page
      .getByRole('button', { name: 'Text to speech', exact: true })
      .click();
    await expect(dialog.getByLabel('Generated speech preview')).toBeVisible();
    await dialog
      .getByRole('combobox', { name: 'Speech generation', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'New generation', exact: true })
      .click();
    await expect(dialog.getByLabel('Script', { exact: true })).toHaveValue('');
    await expect(dialog.getByLabel('Generated speech preview')).toHaveCount(0);
    await dialog
      .getByLabel('Script', { exact: true })
      .fill('Second saved narration');
    await dialog
      .getByRole('button', { name: 'Generate speech', exact: true })
      .click();
    await expect(dialog.getByLabel('Generated speech preview')).toBeVisible();
    expect(requests).toHaveLength(2);
    await page.reload();
    await page
      .getByRole('button', { name: 'Text to speech', exact: true })
      .click();
    await expect(dialog.getByLabel('Script', { exact: true })).toHaveValue(
      'Second saved narration',
    );
    const picker = dialog.getByRole('combobox', {
      name: 'Speech generation',
      exact: true,
    });
    await picker.click();
    await page.getByLabel('Search previous generations').fill('First saved');
    await expect(
      page.getByRole('option', { name: /Second saved/ }),
    ).toHaveCount(0);
    await page.getByRole('option', { name: /First saved narration/ }).click();
    await expect(dialog.getByLabel('Script', { exact: true })).toHaveValue(
      'First saved narration',
    );
    await expect(dialog.getByLabel('Generated speech preview')).toBeVisible();
    expect(requests).toHaveLength(2);
    // Reselecting the same saved ID must discard local draft edits every time.
    for (const draft of ['Edited saved script', 'Another local draft']) {
      await dialog.getByLabel('Script', { exact: true }).fill(draft);
      await expect(dialog.getByLabel('Generated speech preview')).toHaveCount(
        0,
      );
      await picker.click();
      await page.getByLabel('Search previous generations').fill('First saved');
      await page.getByRole('option', { name: /First saved narration/ }).click();
      await expect(dialog.getByLabel('Script', { exact: true })).toHaveValue(
        'First saved narration',
      );
      await expect(dialog.getByLabel('Generated speech preview')).toBeVisible();
      await expect(
        dialog.getByRole('status').filter({ hasText: 'Opening saved speech' }),
      ).toHaveCount(0);
      expect(requests).toHaveLength(2);
    }
    await picker.click();
    await page.getByLabel('Search previous generations').fill('Kore');
    await expect(
      page.getByRole('option', { name: /saved narration/ }),
    ).toHaveCount(2);
    await page.getByLabel('Search previous generations').fill('no such script');
    await expect(page.getByText('No matching generations.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByLabel('Search previous generations'),
    ).not.toBeVisible();
    await expect(picker).toHaveAttribute('aria-expanded', 'false');
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = (await picker.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await expect(picker).toBeInViewport();
    await expect(
      dialog.getByRole('button', { name: 'Save to assets', exact: true }),
    ).toBeInViewport();
    await picker.click();
    await expect(picker).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByLabel('Search previous generations')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByLabel('Search previous generations'),
    ).not.toBeVisible();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  });
  test(`retained speech dialog returns focus to each opener and keeps its draft ${base}`, async ({
    page,
    context,
  }) => {
    const initial = await connect(page, context, base);
    await initial.getByRole('button', { name: 'Close', exact: true }).click();
    // Reset the component instance while retaining the configured local account.
    // The first speech opening on this page must come from Commands.
    await page.reload();
    const media = page.getByRole('button', {
      name: 'Text to speech',
      exact: true,
    });
    await expect(media).toBeEnabled();
    const commands = page.getByRole('button', {
      name: 'Commands',
      exact: true,
    });
    const fromCommands = async () => {
      await commands.click();
      const palette = page.getByRole('dialog', {
        name: 'Commands',
        exact: true,
      });
      await palette
        .getByRole('combobox', { name: 'Search commands', exact: true })
        .fill('Text to speech');
      await palette
        .getByRole('option', { name: 'Text to speech', exact: true })
        .click();
    };
    const dialog = page.getByRole('dialog', {
      name: 'Text to speech',
      exact: true,
    });
    await fromCommands();
    await expect(dialog.getByLabel('Script', { exact: true })).toBeVisible();
    await dialog
      .getByLabel('Script', { exact: true })
      .fill('Keep this retained draft.');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(commands).toBeFocused();
    await media.click();
    await expect(dialog.getByLabel('Script', { exact: true })).toHaveValue(
      'Keep this retained draft.',
    );
    await page.keyboard.press('Escape');
    await expect(media).toBeFocused();
    await fromCommands();
    await expect(dialog.getByLabel('Script', { exact: true })).toHaveValue(
      'Keep this retained draft.',
    );
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(commands).toBeFocused();
  });

  test(`text to speech saves a favorite reference voice for future scripts at ${base}`, async ({
    page,
    context,
  }) => {
    const requests: Record<string, unknown>[] = [];
    // Synthetic MPEG-1 Layer III mono silence: 80 valid empty-granule frames.
    const mp3 = Buffer.concat(
      Array.from({ length: 80 }, () =>
        Buffer.concat([
          Buffer.from([0xff, 0xfb, 0x90, 0xc0]),
          Buffer.alloc(413),
        ]),
      ),
    );
    await context.route(
      'https://openrouter.ai/api/v1/audio/speech',
      async (route) => {
        if (route.request().method() === 'OPTIONS')
          return route.fulfill({ headers: cors, status: 204 });
        const request = route.request().postDataJSON();
        requests.push(request);
        await route.fulfill({
          headers: {
            ...cors,
            'content-type': request.input_references
              ? 'audio/mpeg'
              : 'audio/pcm',
          },
          body: request.input_references ? mp3 : tone(),
        });
      },
    );
    let dialog = await connect(page, context, base);
    await context.route(
      'https://openrouter.ai/api/v1/audio/transcriptions',
      (route) =>
        route.fulfill({
          headers: cors,
          json: {
            segments: [
              { text: 'Last phrase.', start: 1, end: 3 },
              { text: 'Empty span', start: 0.8, end: 0.8 },
              { text: '', start: 2, end: 3 },
              { text: 'First phrase.', start: 0.1, end: 0.9 },
            ],
          },
        }),
    );
    await expect(dialog.getByLabel('Delivery directions')).toBeVisible();
    await expect(
      dialog.getByRole('combobox', {
        name: 'Languages in script',
        exact: true,
      }),
    ).toBeVisible();
    await dialog
      .getByLabel('Delivery directions')
      .fill('Warm retained directions');
    await dialog
      .getByLabel('Script', { exact: true })
      .fill('My original favorite voice sample.');
    await dialog
      .getByRole('button', { name: 'Generate speech', exact: true })
      .click();
    await expect(dialog.getByLabel('Generated speech preview')).toBeVisible();
    await dialog.getByText('Manage voice presets', { exact: false }).click();
    await dialog
      .getByText('Save speaker reference from this take', { exact: true })
      .click();
    await dialog.getByLabel('Speaker reference name').fill('Narrator');
    await dialog
      .getByRole('button', { name: 'Save speaker reference', exact: true })
      .click();
    await expect(
      dialog.getByRole('combobox', { name: 'Voice preset', exact: true }),
    ).toContainText('Narrator');
    expect(requests).toHaveLength(1);
    await expect(dialog.getByLabel('Delivery directions')).toHaveCount(0);
    await expect(
      dialog.getByText('Languages in script', { exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole('combobox', { name: 'Speech voice', exact: true }),
    ).toHaveCount(0);
    await expect(dialog.getByLabel('Speed (×)')).toBeEnabled();
    await expect(
      dialog.getByText(/Generate sends this saved recording/),
    ).toBeVisible();
    await dialog
      .getByLabel('Script', { exact: true })
      .fill('A completely different future script.');
    await dialog.getByLabel('Speed (×)').fill('1.25');
    await dialog
      .getByRole('button', { name: 'Generate speech', exact: true })
      .click();
    await expect(dialog.getByLabel('Generated speech preview')).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      model: 'fish-audio/s2.1-pro',
      input: 'A completely different future script.',
      response_format: 'mp3',
    });
    expect(requests[1]).not.toHaveProperty('voice');
    expect(requests[1]).not.toHaveProperty('seed');
    expect(requests[1]).not.toHaveProperty('instructions');
    const measured = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const task = (await editor.tasks.list())
          .filter((t) => t.label === 'Generating speech')
          .at(-1)!;
        const result = await editor.tasks.result<
          import('../../src/workspace/speech-tasks').SpeechTaskResult
        >(task.id);
        return {
          cues: result.transcript?.cues,
          durationUs: Math.round(
            (result.audio.samples.length / result.audio.sampleRate) * 1e6,
          ),
        };
      } finally {
        await editor.dispose();
      }
    }, base);
    expect(measured.cues?.map((c) => c.text)).toEqual([
      'First phrase.',
      'Last phrase.',
    ]);
    expect(measured.cues?.[1]?.endUs).toBe(measured.durationUs);
    await dialog
      .getByRole('combobox', { name: 'Speech model', exact: true })
      .click();
    await page
      .getByRole('option', {
        name: 'Google: Gemini 3.8 Flash TTS',
        exact: true,
      })
      .click();
    await expect(dialog.getByLabel('Delivery directions')).toBeEnabled();
    await expect(
      dialog.getByRole('combobox', {
        name: 'Languages in script',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('combobox', { name: 'Speech voice', exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole('combobox', { name: 'Voice preset', exact: true })
      .click();
    await page.getByRole('option', { name: 'Narrator', exact: true }).click();
    const reference = requests[1]!.input_references as {
      type: string;
      text?: string;
      input_audio?: { data: string };
    }[];
    expect(reference[1]!.text).toBe('My original favorite voice sample.');
    const wav = Buffer.from(
      reference[0]!.input_audio!.data.split(',')[1]!,
      'base64',
    );
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt32LE(40)).toBe(48000 * 2); // Original 2s, not timing-adjusted.
    await dialog
      .getByRole('button', { name: 'Edit name for Narrator', exact: true })
      .click();
    await dialog.getByLabel('Rename Narrator', { exact: true }).press('Escape');
    await expect(
      dialog.getByRole('button', {
        name: 'Edit name for Narrator',
        exact: true,
      }),
    ).toBeFocused();
    await dialog
      .getByRole('button', { name: 'Edit name for Narrator', exact: true })
      .click();
    await dialog
      .getByLabel('Rename Narrator', { exact: true })
      .fill('Documentary');
    await dialog
      .getByRole('button', { name: 'Save name for Narrator', exact: true })
      .click();
    await dialog
      .getByRole('button', { name: 'Archive Documentary', exact: true })
      .click();
    await dialog
      .getByRole('combobox', { name: 'Voice preset', exact: true })
      .click();
    await expect(
      page.getByRole('option', { name: 'Documentary', exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole('option', { name: 'New voice preset', exact: true })
      .click();
    dialog = await reopenSpeech(page);
    await dialog.getByText('Manage voice presets', { exact: false }).click();
    await dialog
      .getByRole('button', { name: 'Show archived', exact: true })
      .click();
    await dialog
      .getByRole('button', { name: 'Restore Documentary', exact: true })
      .click();
    await dialog
      .getByRole('button', { name: 'Show active', exact: true })
      .click();
    await dialog
      .getByRole('combobox', { name: 'Voice preset', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'Documentary', exact: true })
      .click();
    const other = await context.newPage();
    await other.goto(base);
    await other.evaluate(() => {
      const key = 'localcut.voice-presets.v1';
      const record = JSON.parse(localStorage.getItem(key)!);
      record.presets[0].name = 'Updated in another tab';
      localStorage.setItem(key, JSON.stringify(record));
    });
    await expect(
      dialog.getByRole('button', {
        name: 'Edit name for Updated in another tab',
        exact: true,
      }),
    ).toBeVisible();
    await other.close();
    if (base === '/') {
      await dialog.evaluate((element) => {
        element.scrollTop = 0;
      });
      await page.screenshot({
        path: 'docs/images/workspace-voice-presets.png',
      });
      await page.setViewportSize({ width: 375, height: 812 });
      await dialog.evaluate((element) => {
        element.scrollTop = 0;
      });
      expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(375);
      await page.screenshot({
        path: 'docs/images/workspace-voice-presets-narrow.png',
      });
      await page.setViewportSize({ width: 1366, height: 900 });
    }
    expect(requests).toHaveLength(2);
    // Delete queue artifacts: a saved favorite owns an independent reference.
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.evaluate(async () => {
      for (const { name } of await indexedDB.databases()) {
        if (!name?.endsWith('-tasks-v1')) continue;
        await new Promise<void>((resolve, reject) => {
          const open = indexedDB.open(name);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction(
              ['tasks', 'inputs', 'results'],
              'readwrite',
            );
            for (const store of ['tasks', 'inputs', 'results'])
              tx.objectStore(store).clear();
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => {
              db.close();
              reject(tx.error);
            };
          };
          open.onerror = () => reject(open.error);
        });
      }
    });
    await page.reload();
    await page
      .getByRole('button', { name: 'Text to speech', exact: true })
      .click();
    dialog = page.getByRole('dialog', { name: 'Text to speech', exact: true });
    await expect(dialog.getByText('Loading speech models…')).not.toBeVisible();
    await dialog
      .getByRole('combobox', { name: 'Voice preset', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'Updated in another tab', exact: true })
      .click();
    await dialog
      .getByLabel('Script', { exact: true })
      .fill('Another future script after reload.');
    await dialog
      .getByRole('button', { name: 'Generate speech', exact: true })
      .click();
    await expect(dialog.getByLabel('Generated speech preview')).toBeVisible();
    expect(requests).toHaveLength(3);
    expect(requests[2]!.input_references).toEqual(reference);
    // Storage failures preserve the old preset and do not trigger synthesis.
    await dialog.getByText('Manage voice presets', { exact: false }).click();
    await page.evaluate(() => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'localcut.voice-presets.v1')
          throw new DOMException('Full', 'QuotaExceededError');
        write.call(this, key, value);
      };
    });
    await dialog
      .getByText('Save speaker reference from this take', { exact: true })
      .click();
    await dialog.getByLabel('Speaker reference name').fill('Unsaved');
    await dialog
      .getByRole('button', { name: 'Save speaker reference', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toContainText(
      'Allow browser storage',
    );
    await expect(
      dialog.getByRole('button', {
        name: 'Edit name for Unsaved',
        exact: true,
      }),
    ).toHaveCount(0);
    expect(requests).toHaveLength(3);
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('localcut-voice-references-v1', 1);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('references', 'readwrite');
          tx.objectStore('references').clear();
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
        open.onerror = () => reject(open.error);
      });
    });
    await dialog
      .getByLabel('Script', { exact: true })
      .fill('A script with a missing voice reference.');
    await dialog
      .getByRole('button', { name: 'Generate speech', exact: true })
      .click();
    await expect(
      dialog
        .getByRole('alert')
        .filter({ hasText: 'voice recording is unavailable' }),
    ).toBeVisible();
    expect(requests).toHaveLength(3);
    await context.route('https://openrouter.ai/api/v1/models**', (route) =>
      route.fulfill({ headers: cors, json: { data: [] } }),
    );
    dialog = await reopenSpeech(page);
    await dialog
      .getByRole('combobox', { name: 'Voice preset', exact: true })
      .click();
    await page
      .getByRole('option', {
        name: 'Updated in another tab (unavailable)',
        exact: true,
      })
      .click();
    await expect(
      dialog.getByRole('alert').filter({ hasText: 'current connection' }),
    ).toBeVisible();
    expect(requests).toHaveLength(3);
  });
  test(
    '@journey ' +
      [
        `text to speech validates timing before spending and opens from Commands at ${base}`,
        `text to speech uses multilingual settings, preserves pitch and imports exact duration at ${base}`,
      ].join(' | '),
    async ({ page, context }) => {
      await test.step(`text to speech validates timing before spending and opens from Commands at ${base}`, async () => {
        let calls = 0;
        await context.route(
          'https://openrouter.ai/api/v1/audio/speech',
          async (route) => {
            calls++;
            await route.fulfill({
              headers: cors,
              contentType: 'audio/pcm',
              body: tone(),
            });
          },
        );
        const dialog = await connect(page, context, base);
        await dialog.getByLabel('Speed (×)').fill('0');
        await dialog
          .getByRole('button', { name: 'Generate speech', exact: true })
          .click();
        await expect(dialog.getByRole('alert')).toContainText('Choose a speed');
        expect(calls).toBe(0);
        await dialog
          .getByRole('button', { name: 'Close', exact: true })
          .click();
        await page
          .getByRole('button', { name: 'Collapse chat', exact: true })
          .click();
        await page
          .getByRole('button', { name: 'Commands', exact: true })
          .click();
        const palette = page.getByRole('dialog', {
          name: 'Commands',
          exact: true,
        });
        await palette.getByRole('combobox').fill('Text to speech');
        await palette
          .getByRole('option', { name: 'Text to speech', exact: true })
          .click();
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByText('Loading speech models…'),
        ).not.toBeVisible();
        await expect(dialog.getByLabel('Script', { exact: true })).toHaveValue(
          'Hello! Xin chào!',
        );
        expect(calls).toBe(0);
      });
      await page
        .getByRole('dialog', { name: 'Text to speech', exact: true })
        .getByRole('button', { name: 'Close', exact: true })
        .click();
      const expandChat = page.getByRole('button', {
        name: 'Expand chat',
        exact: true,
      });
      if (await expandChat.isVisible()) await expandChat.click();
      await page
        .getByRole('button', { name: 'Text to speech', exact: true })
        .click();
      await test.step(`text to speech uses multilingual settings, preserves pitch and imports exact duration at ${base}`, async () => {
        const requests: Record<string, unknown>[] = [];
        await context.route(
          'https://openrouter.ai/api/v1/audio/speech',
          async (route) => {
            requests.push(
              route.request().postDataJSON() as Record<string, unknown>,
            );
            await route.fulfill({
              headers: cors,
              contentType: 'audio/pcm',
              body: tone(),
            });
          },
        );
        const dialog = page.getByRole('dialog', {
          name: 'Text to speech',
          exact: true,
        });
        await configureSpeech(page, dialog);
        await dialog
          .getByRole('combobox', { name: 'Languages in script' })
          .click();
        await page.getByLabel('Search speech languages').fill('Vietnamese');
        await page
          .getByRole('option', { name: 'Vietnamese', exact: true })
          .click();
        await page.keyboard.press('Escape');
        await dialog
          .getByRole('combobox', { name: 'Languages in script' })
          .click();
        await page
          .getByLabel('Search speech languages')
          .fill('English (Australia)');
        await page
          .getByRole('option', { name: 'English (Australia)', exact: true })
          .click();
        await page.keyboard.press('Escape');
        await dialog
          .getByLabel('Delivery directions')
          .fill('Warm and friendly');
        await dialog
          .getByRole('button', { name: 'Generate speech', exact: true })
          .click();
        await expect(
          dialog.getByLabel('Generated speech preview'),
        ).toBeVisible();
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({
          model,
          voice: 'Kore',
          input: 'Hello! Xin chào!',
          response_format: 'pcm',
          instructions: expect.stringContaining('English, Vietnamese'),
        });
        expect(JSON.stringify(requests[0])).not.toContain('Speech project');
        await dialog.getByLabel('Speed (×)').fill('1.25');
        await dialog
          .getByRole('button', { name: 'Adjust timing', exact: true })
          .click();
        await expect(
          dialog.getByText('1.60 seconds · 1.25×', { exact: true }),
        ).toBeVisible();
        expect(requests).toHaveLength(1);
        await dialog.getByRole('combobox', { name: 'Speech timing' }).click();
        await page
          .getByRole('option', { name: 'Total length', exact: true })
          .click();
        await dialog.getByLabel('Total length (seconds)').fill('1.25');
        await dialog
          .getByRole('button', { name: 'Adjust timing', exact: true })
          .click();
        const preview = dialog.getByLabel('Generated speech preview');
        await expect(preview).toBeVisible();
        const acoustic = await preview.evaluate(
          async (element: HTMLAudioElement) => {
            const context = new AudioContext();
            try {
              const decoded = await context.decodeAudioData(
                await (await fetch(element.src)).arrayBuffer(),
              );
              const samples = decoded.getChannelData(0);
              let crossings = 0;
              for (
                let i = decoded.sampleRate / 10;
                i < samples.length - decoded.sampleRate / 10;
                i++
              )
                if (samples[i]! <= 0 && samples[i + 1]! > 0) crossings++;
              return {
                duration: decoded.duration,
                hz: crossings / (decoded.duration - 0.2),
              };
            } finally {
              await context.close();
            }
          },
        );
        expect(acoustic.duration).toBeCloseTo(1.25, 3);
        expect(acoustic.hz).toBeGreaterThan(215);
        expect(acoustic.hz).toBeLessThan(225);
        expect(requests).toHaveLength(1);
        if (
          process.env.LOCALCUT_SPEECH_CAPTURE === '1' &&
          base === '/LocalCut/'
        ) {
          await page.setViewportSize({ width: 1440, height: 1000 });
          await expect(
            dialog.getByRole('button', { name: 'Add to timeline' }),
          ).toBeInViewport();
          await page.screenshot({ path: 'docs/images/workspace-speech.png' });
          await page.setViewportSize({ width: 390, height: 844 });
          await dialog
            .getByRole('button', { name: 'Add to timeline' })
            .click({ trial: true });
          await expect(
            dialog.getByRole('button', { name: 'Add to timeline' }),
          ).toBeInViewport();
          await page.screenshot({
            path: 'docs/images/workspace-speech-narrow.png',
          });
          await page.setViewportSize({ width: 1280, height: 720 });
        }
        await dialog
          .getByRole('button', { name: 'Add to timeline', exact: true })
          .click();
        await expect(dialog).not.toBeVisible();
        const project = await snapshot(page, base);
        expect(project.tracks[0]!.clips[0]).toMatchObject({
          kind: 'audio',
          startUs: 0,
          durationUs: 1250000,
        });
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect
          .poll(async () => (await snapshot(page, base)).tracks.length)
          .toBe(0);
        await page.getByRole('button', { name: 'Redo', exact: true }).click();
        await expect
          .poll(
            async () =>
              (await snapshot(page, base)).tracks[0]?.clips[0]?.durationUs,
          )
          .toBe(1250000);
        const metadata = await page.evaluate(
          async ({ base, id }) => {
            const { createEditor } = (await import(
              base + 'editor.js'
            )) as typeof import('../../src/editor');
            const editor = await createEditor();
            try {
              return JSON.parse(await editor.projects.exportJSON(id))
                .transcripts[0];
            } finally {
              await editor.dispose();
            }
          },
          { base, id: project.id },
        );
        expect(project.tracks[0]!.clips[0]!.transcriptId).toBe(metadata.id);
        expect(metadata.speech.script).toBe('Hello! Xin chào!');
        expect(metadata.speech.voice).toBe('Kore');
        expect(metadata.speech.measuredCues[0].timeUs).toBe(62500);
        expect(metadata.cues[0].timeUs).toBe(0);
        expect(metadata.cues[0].endUs).toBe(metadata.cues[1].timeUs);
        expect(metadata.cues[1].endUs).toBeLessThanOrEqual(1250000);
        // Native export actually consumes the generated asset, not just the dialog preview.
        const exported = await page.evaluate(
          async ({ base, projectId }) => {
            const { createEditor } = (await import(
              base + 'editor.js'
            )) as typeof import('../../src/editor');
            const editor = await createEditor();
            let result;
            try {
              result = await editor.exports.start(projectId, { format: 'webm' })
                .completion;
              const context = new AudioContext();
              try {
                const decoded = await context.decodeAudioData(
                  await result.file.arrayBuffer(),
                );
                return {
                  duration: decoded.duration,
                  peak: Math.max(...decoded.getChannelData(0).slice(0, 48000)),
                };
              } finally {
                await context.close();
              }
            } finally {
              await result?.dispose();
              await editor.dispose();
            }
          },
          { base, projectId: project.id },
        );
        expect(exported.duration).toBeGreaterThan(1.2);
        expect(exported.duration).toBeLessThan(1.4);
        expect(exported.peak).toBeGreaterThan(0.2);
        await page.reload();
        await page
          .getByRole('button', { name: 'Open project', exact: true })
          .click();
        await page
          .getByRole('main', { name: 'Projects', exact: true })
          .getByRole('button')
          .filter({ has: page.getByText('Speech project', { exact: true }) })
          .click();
        await expect(
          page.getByRole('button', { name: 'Speech.wav', exact: true }).first(),
        ).toBeVisible();
        expect(
          (await snapshot(page, base)).tracks[0]!.clips[0]!.durationUs,
        ).toBe(1250000);
        await expect(
          page.getByRole('button', { name: 'Text to speech', exact: true }),
        ).toBeVisible();
      });
    },
  );
  test(`text to speech cancels late audio, rejects provider errors and retries explicitly at ${base}`, async ({
    page,
    context,
  }) => {
    let release!: () => void;
    let started = false,
      calls = 0;
    await context.route(
      'https://openrouter.ai/api/v1/audio/speech',
      async (route) => {
        calls++;
        if (calls === 1) {
          started = true;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        if (calls === 2)
          await route.fulfill({
            headers: cors,
            status: 402,
            json: { error: 'private echoed provider body' },
          });
        else
          await route
            .fulfill({ headers: cors, contentType: 'audio/pcm', body: tone() })
            .catch(() => undefined);
      },
    );
    const dialog = await connect(page, context, base);
    await dialog
      .getByRole('button', { name: 'Generate speech', exact: true })
      .click();
    await expect.poll(() => started).toBe(true);
    await expect(dialog.getByRole('status')).toHaveText('Generating speech…');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    release();
    await expect(dialog.getByRole('status')).not.toBeVisible();
    await expect(
      dialog.getByLabel('Generated speech preview'),
    ).not.toBeVisible();
    await dialog
      .getByRole('button', { name: 'Generate speech', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toContainText('credits');
    expect(await page.locator('body').innerText()).not.toContain(
      'private echoed',
    );
    expect(calls).toBe(2);
    await dialog
      .getByRole('button', { name: 'Generate speech', exact: true })
      .click();
    await expect(dialog.getByLabel('Generated speech preview')).toBeVisible();
    expect(calls).toBe(3);
    await dialog.getByRole('combobox', { name: 'Speech timing' }).click();
    await page
      .getByRole('option', { name: 'Total length', exact: true })
      .click();
    await dialog.getByLabel('Total length (seconds)').fill('0.1');
    await dialog
      .getByRole('button', { name: 'Adjust timing', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toContainText('duration from');
    await expect(
      dialog.getByRole('button', { name: 'Add to timeline', exact: true }),
    ).not.toBeVisible();
    expect((await snapshot(page, base)).tracks).toHaveLength(0);
    expect(calls).toBe(3);
  });
}

for (const base of ['/', '/LocalCut/']) {
  test(`text to speech queues retries persists dismissal and escalates refresh interruption ${base}`, async ({
    page,
    context,
  }) => {
    let calls = 0;
    const sessionIds: string[] = [];
    let release!: () => void;
    await context.route(
      'https://openrouter.ai/api/v1/audio/speech',
      async (route) => {
        sessionIds.push(route.request().headers()['x-session-id']!);
        calls++;
        if (calls === 1)
          return route.fulfill({
            headers: cors,
            status: 429,
            json: { error: 'rate limit' },
          });
        if (calls === 2 || calls === 3)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        await route
          .fulfill({ headers: cors, contentType: 'audio/pcm', body: tone() })
          .catch(() => {});
      },
    );
    let dialog = await connect(page, context, base, 'Studio');
    expect(
      await page.evaluate(
        () =>
          JSON.parse(
            JSON.parse(
              localStorage.getItem('localcut.workspace-preferences.v1')!,
            ).preferences.aiProviders,
          ).profiles[0].name,
      ),
    ).toBe('Studio');

    await dialog
      .getByRole('button', { name: 'Generate speech', exact: true })
      .click();
    await expect.poll(() => calls).toBe(2);
    expect(sessionIds[0]).toMatch(/^[a-f\d-]{36}$/);
    expect(sessionIds[1]).toBe(sessionIds[0]);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    release();
    await page.getByRole('button', { name: 'Task queue', exact: true }).click();
    let queue = page.getByRole('dialog', { name: 'Task queue', exact: true });
    await expect(
      queue
        .getByRole('row', { name: 'Generating speech', exact: true })
        .getByRole('status'),
    ).toContainText('completed');
    await queue.getByRole('button', { name: 'Close', exact: true }).click();
    await page
      .getByRole('button', { name: 'Text to speech', exact: true })
      .click();
    await expect(dialog.getByLabel('Generated speech preview')).toBeVisible();
    expect(calls).toBe(2);
    await page.reload();
    await page
      .getByRole('button', { name: 'Open project', exact: true })
      .click();
    await page
      .getByRole('main', { name: 'Projects', exact: true })
      .getByRole('button')
      .filter({ has: page.getByText('Speech project', { exact: true }) })
      .click();
    const expand = page.getByRole('button', {
      name: 'Expand media',
      exact: true,
    });
    if (await expand.isVisible()) await expand.click();
    await page
      .getByRole('button', { name: 'Text to speech', exact: true })
      .click();
    dialog = page.getByRole('dialog', { name: 'Text to speech', exact: true });
    await expect(dialog.getByLabel('Generated speech preview')).toBeVisible();
    expect(calls).toBe(2);
    await dialog
      .getByRole('button', { name: 'Regenerate speech', exact: true })
      .click();
    await expect.poll(() => calls).toBe(3);
    await page.reload();
    release();
    await page
      .getByRole('button', { name: 'Open project', exact: true })
      .click();
    await page
      .getByRole('main', { name: 'Projects', exact: true })
      .getByRole('button')
      .filter({ has: page.getByText('Speech project', { exact: true }) })
      .click();
    if (await expand.isVisible()) await expand.click();
    await page.getByRole('button', { name: 'Task queue', exact: true }).click();
    queue = page.getByRole('dialog', { name: 'Task queue', exact: true });
    const interrupted = queue
      .getByRole('row', { name: 'Generating speech', exact: true })
      .filter({ hasText: 'interrupted' });
    await expect(interrupted).toContainText('outcome is unknown');
    expect(calls).toBe(3);
    await interrupted
      .getByRole('button', { name: 'Retry task', exact: true })
      .click();
    await expect(interrupted).not.toBeVisible();
    await expect(
      queue
        .getByRole('row', { name: 'Generating speech', exact: true })
        .getByRole('status')
        .filter({ hasText: 'completed' }),
    ).toHaveCount(2);
    expect(calls).toBe(4);
    expect(sessionIds[2]).not.toBe(sessionIds[0]);
    expect(sessionIds[3]).toBe(sessionIds[2]);
  });
}

async function reopenSpeech(page: Page) {
  await page.reload();
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await page
    .getByRole('main', { name: 'Projects', exact: true })
    .getByRole('button')
    .filter({ has: page.getByText('Speech project', { exact: true }) })
    .click();
  const expand = page.getByRole('button', {
    name: 'Expand media',
    exact: true,
  });
  if (await expand.isVisible()) await expand.click();
  await page
    .getByRole('button', { name: 'Text to speech', exact: true })
    .click();
  return page.getByRole('dialog', { name: 'Text to speech', exact: true });
}
for (const base of ['/', '/LocalCut/']) {
  test(`speech uses configured STT without phrase timing options and blocks unprepared local generation ${base}`, async ({
    page,
    context,
  }, info) => {
    let synthesis = 0;
    const alignmentModels: string[] = [];
    await context.route(
      'https://openrouter.ai/api/v1/audio/speech',
      (route) => {
        synthesis++;
        return route.fulfill({
          headers: cors,
          contentType: 'audio/pcm',
          body: tone(),
        });
      },
    );
    let dialog = await connect(page, context, base, 'OpenRouter', 'local');
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(
        dialog.getByText('Phrase timing', { exact: true }),
      ).toHaveCount(0);
      await expect(dialog).not.toContainText('Configured STT route');
      await expect(
        dialog.getByRole('button', {
          name: 'Prepare transcription (68 MB)',
          exact: true,
        }),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`speech-no-timing-options-${width}.png`),
      });
    }
    await page.setViewportSize({ width: 1280, height: 844 });
    await dialog
      .getByRole('button', { name: 'Generate speech', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toContainText(
      'Prepare transcription',
    );
    expect(synthesis).toBe(0);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await openAISettings(page);
    await selectAISettingsTab(page, 'STT - Transcription');
    const settings = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await settings
      .getByRole('combobox', { name: 'Transcription service', exact: true })
      .click();
    await page.getByRole('option', { name: 'OpenRouter', exact: true }).click();
    await settings.getByRole('button', { name: 'Done', exact: true }).click();
    await context.route(
      'https://openrouter.ai/api/v1/audio/transcriptions',
      (route) => {
        alignmentModels.push(
          /name="model"\r\n\r\n([^\r]+)/.exec(
            route.request().postData() ?? '',
          )?.[1] ?? '',
        );
        return route.fulfill({
          headers: cors,
          json: { segments: [{ text: 'Hello!', start: 0.1, end: 0.9 }] },
        });
      },
    );
    await page
      .getByRole('button', { name: 'Text to speech', exact: true })
      .click();
    dialog = page.getByRole('dialog', { name: 'Text to speech', exact: true });
    await expect(dialog.getByText('Loading speech models…')).not.toBeVisible();
    await configureSpeech(page, dialog);
    expect(synthesis).toBe(0);
    expect(alignmentModels).toHaveLength(0);
    await expect(
      dialog.getByRole('button', {
        name: 'Prepare transcription (68 MB)',
        exact: true,
      }),
    ).toHaveCount(0);
    await dialog
      .getByRole('button', { name: 'Generate speech', exact: true })
      .click();
    await expect(
      dialog.getByRole('button', { name: 'Add to timeline', exact: true }),
    ).toBeEnabled();
    expect(synthesis).toBe(1);
    expect(alignmentModels).toEqual(['openai/whisper-1']);
    await expect(dialog).not.toContainText('timed phrases saved');
    await expect(dialog).not.toContainText('Provider charges may apply');
    const input = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const task = (await editor.tasks.list()).find(
          (item) => item.label === 'Generating speech',
        )!;
        return (await editor.tasks.input(
          task.id,
        )) as import('../../src/workspace/speech-tasks').SpeechTaskInput;
      } finally {
        await editor.dispose();
      }
    }, base);
    expect(input.timingProvider).toBe('configured');
    expect(JSON.parse(input.timingRoute!).routes).toEqual([
      { providerId: 'openrouter', model: 'openai/whisper-1' },
    ]);
  });
  test(`restored legacy local speech retry keeps its route with remote STT configured ${base}`, async ({
    page,
    context,
  }) => {
    let synthesis = 0,
      alignment = 0;
    await context.route(
      'https://openrouter.ai/api/v1/audio/speech',
      (route) => {
        synthesis++;
        return route.fulfill({
          headers: cors,
          contentType: 'audio/pcm',
          body: tone(),
        });
      },
    );
    const dialog = await connect(page, context, base);
    await context.route(
      'https://openrouter.ai/api/v1/audio/transcriptions',
      (route) => {
        alignment++;
        return route.fulfill({
          headers: cors,
          json: { text: 'Untimed output' },
        });
      },
    );
    await dialog
      .getByRole('button', { name: 'Generate speech', exact: true })
      .click();
    await expect(
      dialog.getByRole('button', { name: 'Retry timing', exact: true }),
    ).toBeVisible();
    expect(synthesis).toBe(1);
    expect(alignment).toBe(1);
    const taskId = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const task = (await editor.tasks.list()).find(
          (item) => item.label === 'Generating speech',
        )!;
        const input = (await editor.tasks.input(
          task.id,
        )) as import('../../src/workspace/speech-tasks').SpeechTaskInput;
        // Emulate an unfinished pre-change local take in this test's own sidecar.
        // Current AI settings remain remote; restoration must retain old authority.
        input.timingProvider = 'local';
        delete input.timingRoute;
        await new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('localcut-tasks-v1', 1);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction('inputs', 'readwrite');
            tx.objectStore('inputs').put(input, task.id);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => {
              db.close();
              reject(tx.error);
            };
          };
          open.onerror = () => reject(open.error);
        });
        return task.id;
      } finally {
        await editor.dispose();
      }
    }, base);
    await page.reload();
    await page
      .getByRole('button', { name: 'Text to speech', exact: true })
      .click();
    await dialog
      .getByRole('button', { name: 'Retry timing', exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          async ({ base, taskId }) => {
            const { createEditor } = (await import(
              base + 'editor.js'
            )) as typeof import('../../src/editor');
            const editor = await createEditor();
            try {
              return (await editor.tasks.get(taskId))?.error?.code;
            } finally {
              await editor.dispose();
            }
          },
          { base, taskId },
        ),
      )
      .toBe('MODEL_REQUIRED');
    await expect(
      dialog.getByRole('button', { name: 'Retry timing', exact: true }),
    ).toBeVisible();
    expect(synthesis).toBe(1);
    expect(alignment).toBe(1);
  });
  test(`text to speech retains measured phrases and retries alignment without regenerating ${base}`, async ({
    page,
    context,
  }) => {
    let synthesis = 0,
      alignment = 0;
    await context.route(
      'https://openrouter.ai/api/v1/audio/speech',
      (route) => {
        synthesis++;
        return route.fulfill({
          headers: cors,
          contentType: 'audio/pcm',
          body: tone(),
        });
      },
    );
    const dialog = await connect(page, context, base);
    await context.route(
      'https://openrouter.ai/api/v1/audio/transcriptions',
      (route) => {
        alignment++;
        return route.fulfill({
          headers: cors,
          json:
            alignment <= 2
              ? { segments: [{ text: 'Invalid phrase', start: 1, end: 0.5 }] }
              : {
                  segments: [
                    { text: 'Hello!', start: 0.1, end: 0.9 },
                    { text: 'Xin chào!', start: 1.0, end: 1.85 },
                  ],
                },
        });
      },
    );
    await dialog
      .getByRole('button', { name: 'Generate speech', exact: true })
      .click();
    await expect(
      dialog.getByRole('button', {
        name: 'Retry timing',
        exact: true,
      }),
    ).toBeVisible();
    expect(synthesis).toBe(1);
    expect(alignment).toBe(1);
    await expect(dialog.getByRole('alert')).toContainText(
      'Speech audio is saved, but phrase timing failed',
    );
    await dialog
      .getByRole('button', { name: 'Retry timing', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toContainText(
      'Speech audio is saved, but phrase timing failed',
    );
    await expect(
      dialog.getByRole('button', { name: 'Retry timing', exact: true }),
    ).toBeEnabled();
    expect(synthesis).toBe(1);
    expect(alignment).toBe(2);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Task queue', exact: true }).click();
    const queue = page.getByRole('dialog', { name: 'Task queue', exact: true });
    const failed = queue.getByRole('row', {
      name: 'Generating speech',
      exact: true,
    });
    await expect(failed).toContainText('failed');
    await failed
      .getByRole('button', { name: 'Retry task', exact: true })
      .click();
    await expect(failed.getByRole('status')).toContainText('completed');
    expect(synthesis).toBe(1);
    expect(alignment).toBe(3);
    await queue.getByRole('button', { name: 'Close', exact: true }).click();
    await page
      .getByRole('button', { name: 'Text to speech', exact: true })
      .click();
    await expect(dialog.getByLabel('Generated speech preview')).toBeVisible();
    const before = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const task = (await editor.tasks.list()).find(
          (item) => item.label === 'Generating speech',
        )!;
        const result = await editor.tasks.result<
          import('../../src/workspace/speech-tasks').SpeechTaskResult
        >(task.id);
        return result.transcript;
      } finally {
        await editor.dispose();
      }
    }, base);
    expect(before?.cues).toHaveLength(2);
    expect(before?.cues[0]?.timeUs).toBe(100000);
    await expect(dialog).not.toContainText('timed phrases saved');
    await expect(dialog).not.toContainText('editing padding');
    // An older completed result has audio/WAV but no annotation. Adding timing
    // must preserve that completed result rather than replacing it with raw PCM.
    await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const task = (await editor.tasks.list()).find(
          (item) => item.label === 'Generating speech',
        )!;
        const result = await editor.tasks.result<
          import('../../src/workspace/speech-tasks').SpeechTaskResult
        >(task.id);
        delete result.transcript;
        await editor.tasks.saveCheckpoint(task.id, result);
      } finally {
        await editor.dispose();
      }
    }, base);
    await page.reload();
    await page
      .getByRole('button', { name: 'Text to speech', exact: true })
      .click();
    await dialog
      .getByRole('button', { name: 'Retry timing', exact: true })
      .click();
    await expect(
      dialog.getByRole('button', { name: 'Add to timeline', exact: true }),
    ).toBeEnabled();
    await expect(dialog.getByLabel('Generated speech preview')).toBeVisible();
    expect(synthesis).toBe(1);
    expect(alignment).toBe(4);
    await page.reload();
    await page
      .getByRole('button', { name: 'Text to speech', exact: true })
      .click();
    await expect(dialog.getByLabel('Generated speech preview')).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Add to timeline', exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    const saved = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const project = (await editor.projects.list())[0]!;
        return JSON.parse(await editor.projects.exportJSON(project.id))
          .transcripts[0];
      } finally {
        await editor.dispose();
      }
    }, base);
    expect(
      saved.speech.measuredCues.map((cue: import('../../src/editor').Cue) => ({
        timeUs: cue.timeUs,
        endUs: cue.endUs,
        text: cue.text,
      })),
    ).toEqual(
      before?.cues.map((cue) => ({
        timeUs: cue.timeUs,
        endUs: cue.endUs,
        text: cue.text,
      })),
    );
    expect(saved.cues[0].timeUs).toBe(20000);
    expect(saved.cues[0].endUs).toBe(saved.cues[1].timeUs);
    expect(synthesis).toBe(1);
    expect(alignment).toBe(4);
  });
  test(`restored speech cancels its saved pending task ${base}`, async ({
    page,
    context,
  }) => {
    const releases: (() => void)[] = [];
    let calls = 0;
    await context.route(
      'https://openrouter.ai/api/v1/audio/speech',
      async (route) => {
        calls++;
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        await route
          .fulfill({ headers: cors, contentType: 'audio/pcm', body: tone() })
          .catch(() => {});
      },
    );
    let dialog = await connect(page, context, base);
    await dialog
      .getByRole('button', { name: 'Generate speech', exact: true })
      .click();
    await expect.poll(() => calls).toBe(1);
    await dialog
      .getByRole('combobox', { name: 'Speech generation', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'New generation', exact: true })
      .click();
    await dialog.getByLabel('Script', { exact: true }).fill('Second script');
    await dialog
      .getByRole('button', { name: 'Generate speech', exact: true })
      .click();
    await expect(
      dialog.getByRole('status').filter({ hasText: /queued/i }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(async (base) => {
          const { TaskQueue } = await import(base + 'editor.js');
          const queue = new TaskQueue('localcut');
          try {
            return (await queue.list()).filter(
              (task: { label: string; state: string }) =>
                task.label === 'Generating speech' && task.state === 'queued',
            ).length;
          } finally {
            await queue.dispose();
          }
        }, base),
      )
      .toBe(1);
    dialog = await reopenSpeech(page);
    releases[0]!();
    await expect.poll(() => calls).toBe(2);
    await expect(
      dialog.getByText('Loading speech models…', { exact: true }),
    ).not.toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: 'Cancel', exact: true }),
    ).not.toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Task queue', exact: true }).click();
    const queue = page.getByRole('dialog', { name: 'Task queue', exact: true });
    await expect(
      queue
        .getByRole('row', { name: 'Generating speech', exact: true })
        .filter({ hasText: 'cancelled' }),
    ).toHaveCount(1);
    releases[1]!();
    expect(calls).toBe(2);
  });
  test(`failed initial speech timing restores its take for local correction ${base}`, async ({
    page,
    context,
  }) => {
    let calls = 0;
    await context.route(
      'https://openrouter.ai/api/v1/audio/speech',
      (route) => {
        calls++;
        return route.fulfill({
          headers: cors,
          contentType: 'audio/pcm',
          body: tone(),
        });
      },
    );
    let dialog = await connect(page, context, base, 'Studio');
    expect(
      await page.evaluate(
        () =>
          JSON.parse(
            JSON.parse(
              localStorage.getItem('localcut.workspace-preferences.v1')!,
            ).preferences.aiProviders,
          ).profiles[0].name,
      ),
    ).toBe('Studio');

    await dialog
      .getByRole('combobox', { name: 'Speech timing', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'Total length', exact: true })
      .click();
    await dialog
      .getByLabel('Total length (seconds)', { exact: true })
      .fill('0.1');
    await dialog
      .getByRole('button', { name: 'Generate speech', exact: true })
      .click();
    await expect(
      dialog.getByRole('button', { name: 'Adjust timing', exact: true }),
    ).toBeVisible();
    await expect(dialog.locator('#speech-duration-guidance')).toContainText(
      'Minimum: 1.00s · Maximum: 4.00s for this 2.00s take',
    );
    expect(calls).toBe(1);
    dialog = await reopenSpeech(page);
    await expect(
      dialog.getByRole('button', { name: 'Adjust timing', exact: true }),
    ).toBeVisible();
    await expect(dialog.locator('#speech-duration-guidance')).toContainText(
      'Minimum: 1.00s · Maximum: 4.00s for this 2.00s take',
    );
    await dialog
      .getByLabel('Total length (seconds)', { exact: true })
      .fill('1.25');
    await dialog
      .getByRole('button', { name: 'Adjust timing', exact: true })
      .click();
    await expect(dialog.getByLabel('Generated speech preview')).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Add to timeline', exact: true }),
    ).toBeEnabled();
    expect(calls).toBe(1);
  });
}
