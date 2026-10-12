import {
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
async function connect(page: Page, context: BrowserContext, base: string) {
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
  await context.addInitScript(() => {
    if (!localStorage.getItem('localcut.workspace-preferences.v1'))
      localStorage.setItem(
        'localcut.workspace-preferences.v1',
        JSON.stringify({
          version: 1,
          preferences: {
            aiProviders: JSON.stringify({
              profiles: [
                { id: 'openrouter', name: 'OpenRouter', kind: 'openrouter' },
              ],
              routes: {
                llm: [{ providerId: 'openrouter', model: '' }],
                tts: [{ providerId: 'openrouter', model: '' }],
                stt: [
                  {
                    providerId: 'openrouter',
                    model: 'openai/whisper-large-v3',
                  },
                ],
              },
            }),
          },
        }),
      );
  });
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
  await expect(
    connection.getByRole('button', { name: 'Verify OpenRouter', exact: true }),
  ).toBeVisible();
  await connection
    .getByRole('button', { name: 'TTS · Speech', exact: true })
    .click();
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
  await dialog
    .getByRole('combobox', { name: 'Phrase timing', exact: true })
    .click();
  await page
    .getByRole('option', { name: 'Configured STT route', exact: true })
    .click();
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
  await page.getByRole('option', { name: 'Kore', exact: true }).click();
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
    await dialog
      .getByLabel('Script', { exact: true })
      .fill('My original favorite voice sample.');
    await dialog
      .getByRole('button', { name: 'Generate speech', exact: true })
      .click();
    await expect(dialog.getByLabel('Generated speech preview')).toBeVisible();
    await dialog.getByText('Manage voice presets', { exact: true }).click();
    await dialog.getByLabel('New preset name').fill('Narrator');
    await dialog
      .getByRole('button', { name: 'Save this voice', exact: true })
      .click();
    await expect(
      dialog.getByRole('combobox', { name: 'Voice preset', exact: true }),
    ).toContainText('Narrator');
    expect(requests).toHaveLength(1);
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
      .getByRole('option', { name: 'Custom settings', exact: true })
      .click();
    dialog = await reopenSpeech(page);
    await dialog.getByText('Manage voice presets', { exact: true }).click();
    await dialog
      .getByRole('button', { name: 'Restore Documentary', exact: true })
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
      dialog.getByLabel('Rename Updated in another tab', { exact: true }),
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
      .getByRole('combobox', { name: 'Phrase timing', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'Configured STT route', exact: true })
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
    await dialog.getByText('Manage voice presets', { exact: true }).click();
    await page.evaluate(() => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'localcut.voice-presets.v1')
          throw new DOMException('Full', 'QuotaExceededError');
        write.call(this, key, value);
      };
    });
    await dialog.getByLabel('New preset name').fill('Unsaved');
    await dialog
      .getByRole('button', { name: 'Save this voice', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toContainText(
      'Allow browser storage',
    );
    await expect(
      dialog.getByLabel('Rename Unsaved', { exact: true }),
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
    let release!: () => void;
    await context.route(
      'https://openrouter.ai/api/v1/audio/speech',
      async (route) => {
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
    let dialog = await connect(page, context, base);
    await dialog
      .getByRole('button', { name: 'Generate speech', exact: true })
      .click();
    await expect.poll(() => calls).toBe(2);
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
    await dialog
      .getByRole('combobox', { name: 'Phrase timing', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'Local Whisper', exact: true })
      .click();
    await dialog
      .getByRole('button', { name: 'Generate speech', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toContainText(
      'Prepare phrase timing',
    );
    expect(synthesis).toBe(0);
    await dialog
      .getByRole('combobox', { name: 'Phrase timing', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'Configured STT route', exact: true })
      .click();
    await context.route(
      'https://openrouter.ai/api/v1/audio/transcriptions',
      (route) => {
        alignment++;
        return route.fulfill({
          headers: cors,
          json:
            alignment === 1
              ? { text: 'Untimed output' }
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
        name: 'Measure phrase timing',
        exact: true,
      }),
    ).toBeVisible();
    expect(synthesis).toBe(1);
    expect(alignment).toBe(1);
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
    expect(alignment).toBe(2);
    await queue.getByRole('button', { name: 'Close', exact: true }).click();
    await page
      .getByRole('button', { name: 'Text to speech', exact: true })
      .click();
    await expect(dialog).toContainText('2 timed phrases saved');
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
    expect(before?.cues[0]?.timeUs).toBe(100000);
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
      .getByRole('button', { name: 'Measure phrase timing', exact: true })
      .click();
    await expect(dialog).toContainText('2 timed phrases saved');
    expect(synthesis).toBe(1);
    expect(alignment).toBe(3);
    await page.reload();
    await page
      .getByRole('button', { name: 'Text to speech', exact: true })
      .click();
    await expect(dialog).toContainText('2 timed phrases saved');
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
    expect(alignment).toBe(3);
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
      .getByRole('button', { name: 'Queue another script', exact: true })
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
    let dialog = await connect(page, context, base);
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
    await expect(dialog).toContainText('Original: 2.00s');
    expect(calls).toBe(1);
    dialog = await reopenSpeech(page);
    await expect(
      dialog.getByRole('button', { name: 'Adjust timing', exact: true }),
    ).toBeVisible();
    await expect(dialog).toContainText('Original: 2.00s');
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
