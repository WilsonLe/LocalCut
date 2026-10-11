import { openAISettings } from './workspace-settings-helper';
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
const model = 'test/visual-chat';
const label = {
  summary: 'A red image on a plain background',
  subjects: ['red shape'],
  scene: 'plain background',
  style: 'graphic',
  tags: ['red', 'graphic'],
  sound: 'none',
};
async function catalog(context: BrowserContext, audio = false) {
  await context.route('https://openrouter.ai/api/v1/models', (route) =>
    route.fulfill({
      headers: cors,
      json: {
        data: [
          {
            id: model,
            name: 'Visual chat',
            context_length: 32000,
            supported_parameters: ['tools', 'tool_choice'],
            architecture: {
              input_modalities: [
                'text',
                'image',
                'video',
                ...(audio ? ['audio'] : []),
              ],
            },
          },
        ],
      },
    }),
  );
}
async function connect(page: Page) {
  await openAISettings(page);
  const dialog = page.getByRole('dialog', {
    name: 'AI connection',
    exact: true,
  });
  await dialog
    .getByLabel('OpenRouter API key', { exact: true })
    .fill('synthetic-indexing-key');
  await dialog
    .getByRole('button', { name: 'Use API key', exact: true })
    .click();
  await expect(
    dialog.getByText('Key connected', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('combobox', { name: 'AI model', exact: true }).click();
  await page
    .getByRole('option', { name: 'Visual chat · ' + model, exact: true })
    .click();
  return dialog;
}
async function settings(page: Page) {
  await openAISettings(page);
  return page.getByRole('dialog', { name: 'AI connection', exact: true });
}
async function image(page: Page) {
  const bytes = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(128, 72),
      ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'red';
    ctx.fillRect(0, 0, 128, 72);
    return [
      ...new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer()),
    ];
  });
  await page.getByLabel('Import media', { exact: true }).setInputFiles({
    name: 'red.png',
    mimeType: 'image/png',
    buffer: Buffer.from(bytes),
  });
  await expect(page.locator('.media-item')).toHaveCount(1);
}
for (const base of ['/', '/LocalCut/']) {
  test(`mobile media keeps indexing alive while closed ${base}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await catalog(context);
    let release = () => {};
    const labeling = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested = false;
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ headers: cors });
          return;
        }
        requested = true;
        const part = route.request().postDataJSON().messages.at(-1).content;
        const prompt = Array.isArray(part)
          ? String(part[0]?.text)
          : String(part);
        const sceneId =
          Array.isArray(part) && part.length > 1
            ? /"sceneId":"(scene-\d+)"/.exec(prompt)?.[1]
            : undefined;
        await labeling;
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: JSON.stringify(sceneId ? { sceneId, label } : label) }, finish_reason: 'stop' }], model })}\n\ndata: [DONE]\n\n`,
        });
      },
    );
    try {
      await page.goto(base);
      await page
        .getByRole('button', { name: 'Workspace settings', exact: true })
        .click();
      await page
        .getByRole('menuitem', { name: 'Project', exact: true })
        .click();
      await page
        .getByRole('menuitem', { name: 'New project', exact: true })
        .click();
      await page
        .getByLabel('Project name', { exact: true })
        .fill('Mobile indexing');
      await page
        .getByRole('button', { name: 'Create project', exact: true })
        .click();
      await page
        .getByRole('navigation', { name: 'Workspace sections' })
        .getByRole('button', { name: 'Chat', exact: true })
        .click();
      const connection = await connect(page);
      await connection
        .getByRole('checkbox', { name: 'Allow asset indexing' })
        .check();
      await connection
        .getByRole('button', { name: 'Done', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Expand media', exact: true })
        .click();
      await image(page);
      await page.getByRole('button', { name: 'Index', exact: true }).click();
      await expect.poll(() => requested).toBe(true);
      await page
        .getByRole('button', { name: 'Close media', exact: true })
        .click();
      await expect(
        page.getByRole('complementary', { name: 'Media library', exact: true }),
      ).toBeHidden();
      release();
      await expect(
        page.locator('.media-item').getByRole('button', {
          name: 'Reindex',
          exact: true,
          includeHidden: true,
        }),
      ).toBeEnabled();
      await page
        .getByRole('button', { name: 'Expand media', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Index history for red.png' })
        .click();
      const history = page.getByRole('dialog', {
        name: 'Asset index',
        exact: true,
      });
      await expect(
        history.getByText(label.summary, { exact: true }).first(),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(390);
      await history.getByRole('button', { name: 'Close', exact: true }).focus();
      await page.keyboard.press('Escape');
      await expect(history).toBeHidden();
      await expect(
        page.getByRole('complementary', { name: 'Media library', exact: true }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'Asset details for red.png' })
        .focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(
        page.getByRole('tooltip', { name: /^red\.png / }),
      ).toContainText('red.png');
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('complementary', { name: 'Media library', exact: true }),
      ).toBeHidden();
      await expect(
        page.getByRole('button', { name: 'Expand media', exact: true }),
      ).toBeFocused();
    } finally {
      release();
    }
  });

  test(`workspace indexing consent, retry, retained labels and Klip context ${base}`, async ({
    page,
    context,
  }) => {
    await catalog(context);
    let malformed = true;
    const bodies: Record<string, unknown>[] = [];
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ headers: cors });
          return;
        }
        const body = route.request().postDataJSON();
        bodies.push(body);
        const messages = body.messages as { content: unknown }[];
        const part = messages.at(-1)!.content;
        const prompt = Array.isArray(part)
          ? String(part[0]?.text)
          : String(part);
        const sceneId =
          Array.isArray(part) && part.length > 1
            ? /"sceneId":"(scene-\d+)"/.exec(prompt)?.[1]
            : undefined;
        const reply = body.tools
          ? 'I can use the indexed red scene.'
          : malformed && sceneId
            ? '{malformed'
            : JSON.stringify(sceneId ? { sceneId, label } : label);
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: reply }, finish_reason: 'stop' }], model })}\n\ndata: [DONE]\n\n`,
        });
      },
    );
    await page.goto(base);
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
    await page
      .getByRole('menuitem', { name: 'New project', exact: true })
      .click();
    await page
      .getByLabel('Project name', { exact: true })
      .fill('Indexing workspace');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Open project', exact: true }),
    ).toContainText('Indexing workspace');
    await expect(
      page.getByRole('button', { name: 'Import media', exact: true }).first(),
    ).toBeEnabled();
    await image(page);
    await expect(
      page.getByRole('button', { name: 'Index', exact: true }),
    ).toHaveCount(0);
    let dialog = await connect(page);
    await expect(
      dialog.getByRole('checkbox', { name: 'Allow asset indexing' }),
    ).not.toBeChecked();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Index', exact: true }),
    ).toHaveCount(0);
    expect(bodies).toEqual([]);
    dialog = await settings(page);
    await dialog
      .getByRole('checkbox', { name: 'Allow asset indexing' })
      .check();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Index', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Retry indexing', exact: true }),
    ).toBeVisible();
    malformed = false;
    await page
      .getByRole('button', { name: 'Retry indexing', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Reindex', exact: true }),
    ).toBeEnabled();
    expect(bodies).toHaveLength(3);
    expect(JSON.stringify(bodies)).not.toContain('synthetic-indexing-key');
    expect(JSON.stringify(bodies)).not.toContain('red.png');
    await page
      .getByRole('button', { name: 'Index history for red.png' })
      .click();
    const index = page.getByRole('dialog', {
      name: 'Asset index',
      exact: true,
    });
    await expect(
      index.getByText(label.summary, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      index.getByRole('img', { name: 'Indexed representative frame' }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath('asset-index.png'),
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await page
      .getByRole('textbox', { name: 'Describe your edit' })
      .fill('Find the red graphic');
    await page.getByRole('button', { name: 'Send edit request' }).click();
    await expect(
      page.getByText('I can use the indexed red scene.'),
    ).toBeVisible();
    expect(JSON.stringify(bodies.at(-1))).toContain('assetIndex');
    expect(JSON.stringify(bodies.at(-1))).not.toContain('data:image');
    expect(JSON.stringify(bodies.at(-1))).toContain('search_asset_index');
    await page.getByRole('button', { name: 'Reindex', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Reindex', exact: true }),
    ).toBeEnabled();
    await page
      .getByRole('button', { name: 'Index history for red.png' })
      .click();
    await expect(
      index.getByRole('button', { name: 'Run 2 · complete' }),
    ).toBeVisible();
    await index
      .getByRole('button', { name: 'Delete this run', exact: true })
      .click();
    await expect(
      index.getByRole('button', { name: 'Run 2 · complete' }),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    dialog = await settings(page);
    await dialog
      .getByRole('checkbox', { name: 'Allow asset indexing' })
      .uncheck();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Reindex', exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole('textbox', { name: 'Describe your edit' })
      .fill('Describe available footage');
    await page.getByRole('button', { name: 'Send edit request' }).click();
    await expect(
      page.getByText('I can use the indexed red scene.'),
    ).toBeVisible();
    expect(JSON.stringify(bodies.at(-1))).not.toContain('assetIndex');
    expect(JSON.stringify(bodies.at(-1))).not.toContain('search_asset_index');
    await page.reload();
    dialog = await settings(page);
    await expect(
      dialog.getByRole('checkbox', { name: 'Allow asset indexing' }),
    ).not.toBeChecked();
    await dialog
      .getByRole('checkbox', { name: 'Allow asset indexing' })
      .check();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page.reload();
    await settings(page);
    await expect(
      page.getByRole('checkbox', { name: 'Allow asset indexing' }),
    ).toBeChecked();
  });
}

for (const base of ['/', '/LocalCut/']) {
  test(`workspace indexing audio card and incompatible model ${base}`, async ({
    page,
    context,
  }) => {
    await catalog(context);
    const bodies: Record<string, unknown>[] = [];
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ headers: cors });
          return;
        }
        const body = route.request().postDataJSON();
        bodies.push(body);
        const part = body.messages.at(-1).content;
        const sceneId =
          Array.isArray(part) && part.length > 1
            ? /"sceneId":"(scene-\d+)"/.exec(part[0].text)?.[1]
            : undefined;
        const audioLabel = {
          ...label,
          summary: 'A steady tone',
          subjects: ['tone'],
          tags: ['tone'],
          sound: 'A steady tone',
        };
        const reply = JSON.stringify(
          sceneId ? { sceneId, label: audioLabel } : audioLabel,
        );
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ choices: [{ delta: { content: reply }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
        });
      },
    );
    await page.goto(base);
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
    await page
      .getByRole('menuitem', { name: 'New project', exact: true })
      .click();
    await page
      .getByRole('textbox', { name: 'Project name' })
      .fill('Audio indexing');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Import media', exact: true }).first(),
    ).toBeEnabled();
    const bytes = Buffer.alloc(44 + 48000 * 2);
    bytes.write('RIFF', 0);
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(48000, 24);
    bytes.writeUInt32LE(96000, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36);
    bytes.writeUInt32LE(96000, 40);
    for (let i = 0; i < 48000; i++)
      bytes.writeInt16LE(
        Math.round(Math.sin((i * Math.PI * 880) / 48000) * 3000),
        44 + i * 2,
      );
    await page.getByLabel('Import media', { exact: true }).setInputFiles({
      name: 'tone.wav',
      mimeType: 'audio/wav',
      buffer: bytes,
    });
    await expect(page.locator('.media-item')).toHaveCount(1);
    // Simulate interruption after deterministic analysis, before the first label.
    await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const project = (await editor.projects.list()).find(
          (p) => p.name === 'Audio indexing',
        )!;
        const snapshot = await editor.projects.snapshot(project.id);
        const assetId = snapshot.tracks
          .flatMap((t) => t.clips)
          .find((c) => c.assetId)?.assetId;
        if (!assetId) throw new Error('Expected an imported audio asset');
        const run = await editor.assets.analyze(assetId).completion;
        if (run.status !== 'analyzed')
          throw new Error('Expected a local checkpoint');
      } finally {
        await editor.dispose();
      }
    }, base);
    await page.reload();
    await page
      .getByRole('button', { name: 'Open project', exact: true })
      .click();
    await page
      .getByRole('main', { name: 'Projects', exact: true })
      .getByRole('button', { name: /Audio indexing/ })
      .click();
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    let dialog = await connect(page);
    await dialog
      .getByRole('checkbox', { name: 'Allow asset indexing' })
      .check();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.locator('.media-item')).not.toContainText(
      'Choose a chat model supporting audio inputs to index this asset.',
    );
    await page
      .getByRole('button', { name: 'Asset details for tone.wav' })
      .focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('tooltip', { name: /^tone\.wav / }),
    ).toContainText(
      'Choose a chat model supporting audio inputs to index this asset.',
    );
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .focus();
    await expect(
      page.getByRole('button', { name: 'Index', exact: true }),
    ).toHaveCount(0);
    expect(bodies).toHaveLength(0);
    await catalog(context, true);
    dialog = await settings(page);
    await dialog
      .getByRole('combobox', { name: 'AI model', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Refresh models', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Refresh models', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('option', { name: 'Visual chat · ' + model, exact: true })
      .click();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page
      .getByRole('button', { name: 'Retry indexing', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Reindex', exact: true }),
    ).toBeVisible();
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[0])).toContain('input_audio');
    expect(JSON.stringify(bodies[0])).not.toContain('image_url');
    await page
      .getByRole('button', { name: 'Index history for tone.wav' })
      .click();
    const audio = page.getByLabel('Indexed audio excerpt');
    await expect(audio).toBeVisible();
    await expect
      .poll(() => audio.evaluate((el) => (el as HTMLAudioElement).duration))
      .toBe(1);
  });
}
