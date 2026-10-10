import { openAISettings } from './workspace-settings-helper';
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
    route.fulfill({
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
  await connection
    .getByLabel('OpenRouter API key')
    .fill('synthetic-speech-key');
  await connection
    .getByRole('button', { name: 'Use API key', exact: true })
    .click();
  await expect(
    connection.getByText('Key connected', { exact: true }),
  ).toBeVisible();
  // Speech does not require choosing a tool-capable chat model.
  await connection.getByRole('button', { name: 'Done', exact: true }).click();
  await page
    .getByRole('button', { name: 'Text to speech', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Text to speech',
    exact: true,
  });
  await expect(dialog.getByText('Loading speech models…')).not.toBeVisible();
  await dialog.getByLabel('Script', { exact: true }).fill('Hello! Xin chào!');
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
  return dialog;
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
  test(`text to speech uses multilingual settings, preserves pitch and imports exact duration at ${base}`, async ({
    page,
    context,
  }) => {
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
    const dialog = await connect(page, context, base);
    await dialog.getByRole('combobox', { name: 'Languages in script' }).click();
    await page.getByLabel('Search speech languages').fill('Vietnamese');
    await page.getByRole('option', { name: 'Vietnamese', exact: true }).click();
    await page.keyboard.press('Escape');
    await dialog.getByRole('combobox', { name: 'Languages in script' }).click();
    await page
      .getByLabel('Search speech languages')
      .fill('English (Australia)');
    await page
      .getByRole('option', { name: 'English (Australia)', exact: true })
      .click();
    await page.keyboard.press('Escape');
    await dialog.getByLabel('Delivery directions').fill('Warm and friendly');
    await dialog
      .getByRole('button', { name: 'Generate speech', exact: true })
      .click();
    await expect(dialog.getByLabel('Generated speech preview')).toBeVisible();
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
    if (process.env.LOCALCUT_SPEECH_CAPTURE === '1' && base === '/LocalCut/') {
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
    expect((await snapshot(page, base)).tracks[0]!.clips[0]!.durationUs).toBe(
      1250000,
    );
    await expect(
      page.getByRole('button', { name: 'Text to speech', exact: true }),
    ).toBeVisible();
  });
  test(`text to speech validates timing before spending and opens from Commands at ${base}`, async ({
    page,
    context,
  }) => {
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
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page
      .getByRole('button', { name: 'Collapse chat', exact: true })
      .click();
    await page.getByRole('button', { name: 'Commands', exact: true }).click();
    const palette = page.getByRole('dialog', { name: 'Commands', exact: true });
    await palette.getByRole('combobox').fill('Text to speech');
    await palette
      .getByRole('option', { name: 'Text to speech', exact: true })
      .click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Loading speech models…')).not.toBeVisible();
    await expect(dialog.getByLabel('Script', { exact: true })).toHaveValue('');
    expect(calls).toBe(0);
  });
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
