/* global File, crypto */
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const assets = new URL('./assets/', import.meta.url);
const base = new URL(process.argv[2] || 'http://127.0.0.1:4196/LocalCut/');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
  page.on('pageerror', (e) => console.error(e.message));
  await page.goto(base.href);
  const images = await Promise.all(
    [1, 2, 3].map(async (n) =>
      Array.from(await readFile(new URL(`landscape-${n}.jpg`, assets))),
    ),
  );
  const video = Array.from(
    await readFile(process.argv[3] || '.artifacts/brand-showcase/sample.mp4'),
  );
  const id = await page.evaluate(
    async ({ images, video, basePath }) => {
      const { createEditor } = await import(basePath + 'src/editor/index.ts');
      const editor = await createEditor();
      const p = await editor.projects.create('Desert daydream', {
        width: 1920,
        height: 1080,
        frameRate: { num: 30, den: 1 },
      });
      const assets = [];
      for (let i = 0; i < 3; i++)
        assets.push(
          await editor.assets.import(
            new File(
              [new Uint8Array(images[i])],
              ['Golden hour.jpg', 'Quiet coast.jpg', 'Last light.jpg'][i],
              { type: 'image/jpeg' },
            ),
          ).completion,
        );
      const movie = await editor.assets.import(
        new File([new Uint8Array(video)], 'Desert session.mp4', {
          type: 'video/mp4',
        }),
      ).completion;
      await editor.commands.apply({
        projectId: p.id,
        requestId: crypto.randomUUID(),
        expectedRevision: p.revision,
        operations: [
          { type: 'addTrack', track: { id: 'visuals', kind: 'video' } },
          { type: 'addTrack', track: { id: 'sound', kind: 'audio' } },
          {
            type: 'insertClip',
            trackId: 'visuals',
            clip: {
              id: 'movie',
              kind: 'video',
              sourceInUs: 0,
              sourceOutUs: 5000000,
              assetId: movie.id,
              startUs: 15000000,
              durationUs: 5000000,
              width: 1920,
              height: 1080,
            },
          },
          ...assets.map((a, i) => ({
            type: 'insertClip',
            trackId: 'visuals',
            clip: {
              id: `shot-${i}`,
              kind: 'image',
              assetId: a.id,
              startUs: i * 5000000,
              durationUs: 5000000,
              width: 1600,
              height: 1000,
            },
          })),
        ],
      });

      await editor.commands.apply({
        projectId: p.id,
        expectedRevision: p.revision + 1,
        requestId: crypto.randomUUID(),
        operations: [
          {
            type: 'separateAudio',
            clipId: 'movie',
            audioClipId: 'sound-clip',
            trackId: 'sound',
          },
        ],
      });
      await editor.dispose();
      return p.id;
    },
    { images, video, basePath: base.pathname },
  );
  await page.goto(`${base.href}#/project/${id}`);
  await page.locator('[data-clip-id="shot-0"]').waitFor();
  await page.waitForTimeout(1200);
  console.log((await page.locator('body').innerText()).slice(0, 1700));
  const shot = async (name, locator = page) =>
    locator.screenshot({ path: new URL(name + '.png', assets).pathname });
  if (
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .isVisible()
  )
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
  await shot('editor');
  await shot('media');
  await page.locator('[data-clip-id="movie"]').dblclick();
  const form = page.getByRole('dialog', {
    name: 'Clip properties',
    exact: true,
  });
  for (const name of ['Color', 'Blending', 'Mask', 'Chroma key', 'Audio']) {
    await form.getByText(name, { exact: true }).click();
    if (name === 'Color') {
      await form
        .getByRole('combobox', { name: 'Color preset', exact: true })
        .click();
      await page
        .getByRole('option', { name: 'Cinematic', exact: true })
        .click();
    }
    if (name === 'Audio') {
      await form.getByLabel('Bass (dB)', { exact: true }).fill('2');
      await form.getByLabel('Treble (dB)', { exact: true }).fill('3');
      await form.getByLabel('Noise reduction', { exact: true }).fill('0.35');
      await form.getByLabel('Fade in (seconds)', { exact: true }).fill('0.3');
      await form.getByLabel('Fade out (seconds)', { exact: true }).fill('0.6');
    }
    if (name === 'Chroma key')
      await form.getByLabel('Enable chroma key', { exact: true }).check();
    if (name === 'Mask') {
      await form
        .getByRole('combobox', { name: 'Mask shape', exact: true })
        .click();
      await page.getByRole('option', { name: 'Ellipse', exact: true }).click();
    }
    const details = form
      .locator('details')
      .filter({
        has: page
          .locator('summary')
          .filter({ hasText: new RegExp('^' + name + '$') }),
      })
      .first();
    await details.scrollIntoViewIfNeeded();
    await shot(name.toLowerCase().replaceAll(' ', '-'), details);
    await form.getByText(name, { exact: true }).click();
  }
  await page.keyboard.press('Escape');
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  };
  await page.route('https://openrouter.ai/api/v1/models', (route) =>
    route.fulfill({
      headers: cors,
      json: {
        data: [
          {
            id: 'demo/visual',
            name: 'Showcase demo',
            context_length: 512000,
            supported_parameters: ['tools', 'tool_choice'],
            architecture: { input_modalities: ['text', 'image', 'video'] },
          },
        ],
      },
    }),
  );
  await page.route(
    'https://openrouter.ai/api/v1/chat/completions',
    async (route) => {
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({ headers: cors });
      const b = route.request().postDataJSON();
      const label = {
        summary:
          'Warm dunes at golden hour, with soft shadows and a wide open sky.',
        subjects: ['dunes', 'sky'],
        scene: 'desert landscape',
        style: 'cinematic',
        tags: ['golden hour', 'warm', 'landscape'],
        sound: 'none',
      };
      const part = b.messages.at(-1).content;
      const sceneId =
        Array.isArray(part) && part.length > 1
          ? /"sceneId":"(scene-\d+)"/.exec(String(part[0].text))?.[1]
          : undefined;
      const content =
        b.tools?.length === 0
          ? 'Cinematic desert cut'
          : b.tools
            ? 'I can shape the story with warm color, gentle fades and a smooth speed ramp. Your indexed media is ready to explore.'
            : JSON.stringify(sceneId ? { sceneId, label } : label);
      await route.fulfill({
        headers: cors,
        contentType: 'text/event-stream',
        body:
          'data: ' +
          JSON.stringify({
            choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }],
            model: 'demo/visual',
          }) +
          '\n\ndata: [DONE]\n\n',
      });
    },
  );
  await page
    .getByRole('button', { name: 'Workspace settings', exact: true })
    .click();
  await page
    .getByRole('menuitem', { name: 'AI settings', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'AI connection',
    exact: true,
  });
  await dialog
    .getByRole('button', { name: 'Add provider', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Provider type', exact: true })
    .click();
  await page.getByRole('option', { name: 'OpenRouter', exact: true }).click();
  await page.getByLabel('Account name', { exact: true }).fill('');
  await page
    .getByRole('button', { name: 'Add OpenRouter account', exact: true })
    .click();
  await dialog
    .getByRole('group', { name: 'OpenRouter connection', exact: true })
    .getByRole('button', { name: 'I have an API key', exact: true })
    .click();
  await dialog
    .getByLabel('OpenRouter API key', { exact: true })
    .fill('synthetic-showcase-only');
  await dialog
    .getByRole('button', { name: 'Use API key', exact: true })
    .click();
  await dialog.getByRole('combobox', { name: 'AI model', exact: true }).click();
  await page
    .getByRole('option', { name: 'Showcase demo · demo/visual', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  const action = async (name) => {
    await page
      .getByRole('button', {
        name: 'Asset details for Golden hour.jpg',
        exact: true,
      })
      .hover();
    await page
      .getByRole('button', { name: 'Actions for Golden hour.jpg', exact: true })
      .click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  };
  console.log('Provider connected');
  await action('Index');
  console.log('Index requested');
  await page
    .getByText('Indexed', { exact: true })
    .first()
    .waitFor({ timeout: 30000 });
  await shot('media');
  await action('View index results');
  await shot(
    'index',
    page.getByRole('dialog', { name: 'Asset index', exact: true }),
  );
  await page.keyboard.press('Escape');
  await page
    .getByRole('textbox', { name: 'Describe your edit' })
    .fill(
      'Make a cinematic cut with warm color, smooth motion and clean audio.',
    );
  await page
    .getByRole('button', { name: 'Send edit request', exact: true })
    .click();
  await page
    .getByText('Your indexed media is ready to explore.', { exact: false })
    .last()
    .waitFor();
  await shot('chat');
} catch (error) {
  const failed = browser.contexts()[0]?.pages()[0];
  if (failed) {
    console.error(await failed.locator('body').innerText());
    await failed.screenshot({
      path: '.artifacts/brand-showcase/capture-error.png',
    });
  }
  throw error;
} finally {
  await browser.close();
}
