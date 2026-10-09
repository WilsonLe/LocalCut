import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Project } from '../../src/core/model';

async function createProject(page: Page, name: string) {
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill(name);
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'New project', exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'New project', exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel('Import media', { exact: true })).toBeAttached();
}

async function snapshot(
  page: Page,
  base: string,
  name: string,
): Promise<Project> {
  return page.evaluate(
    async ({ base, name }) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const project = (await editor.projects.list()).find(
          (item) => item.name === name,
        );
        if (!project) throw new Error('UI project was not persisted: ' + name);
        return await editor.projects.snapshot(project.id);
      } finally {
        await editor.dispose();
      }
    },
    { base, name },
  );
}

async function redPng(page: Page) {
  const bytes = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(128, 72);
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, 128, 72);
    return [
      ...new Uint8Array(
        await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(),
      ),
    ];
  });
  return { name: 'red.png', mimeType: 'image/png', buffer: Buffer.from(bytes) };
}

function toneWav(frames = 24000) {
  const sampleRate = 48000;
  const bytes = Buffer.alloc(44 + frames * 4);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 4, 28);
  bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 4, 40);
  for (let frame = 0; frame < frames; frame++) {
    const value = Math.round(
      Math.sin((frame * 2 * Math.PI * 440) / sampleRate) * 3000,
    );
    bytes.writeInt16LE(value, 44 + frame * 4);
    bytes.writeInt16LE(value, 46 + frame * 4);
  }
  return { name: 'tone.wav', mimeType: 'audio/wav', buffer: bytes };
}

async function greenVideo(page: Page) {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 72;
    const context = canvas.getContext('2d')!;
    const paint = () => {
      context.fillStyle = '#00ff00';
      context.fillRect(0, 0, 128, 72);
    };
    paint();
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp9',
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error('Fixture recording failed'));
    });
    recorder.start();
    const interval = setInterval(paint, 30);
    try {
      await new Promise((resolve) => setTimeout(resolve, 400));
      recorder.stop();
      await stopped;
      return [
        ...new Uint8Array(
          await new Blob(chunks, { type: 'video/webm' }).arrayBuffer(),
        ),
      ];
    } finally {
      clearInterval(interval);
      for (const track of stream.getTracks()) track.stop();
    }
  });
  return {
    name: 'green.webm',
    mimeType: 'video/webm',
    buffer: Buffer.from(bytes),
  };
}

async function previewPixel(page: Page) {
  return page
    .getByLabel('Video preview', { exact: true })
    .evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      return [
        ...canvas
          .getContext('2d')!
          .getImageData(
            Math.floor(canvas.width / 2),
            Math.floor(canvas.height / 2),
            1,
            1,
          ).data,
      ];
    });
}

async function downloadedVideo(page: Page, data: Buffer, type: string) {
  return page.evaluate(
    async ({ base64, type }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type }));
      const video = document.createElement('video');
      video.muted = true;
      try {
        const loaded = new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () =>
            reject(new Error('Saved export did not decode'));
        });
        video.src = url;
        await loaded;
        const sought = new Promise<void>((resolve) => {
          video.onseeked = () => resolve();
        });
        video.currentTime = 0.4;
        await sought;
        const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
        const context = canvas.getContext('2d')!;
        context.drawImage(video, 0, 0);
        return {
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          pixel: [
            ...context.getImageData(
              Math.floor(canvas.width / 2),
              Math.floor(canvas.height / 2),
              1,
              1,
            ).data,
          ],
        };
      } finally {
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
      }
    },
    { base64: data.toString('base64'), type },
  );
}

for (const base of ['/', '/LocalCut/']) {
  test(`workspace edits, restores and saves real exports ${base}`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    const remote: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (
        !request.url().startsWith('http://127.0.0.1:') &&
        !request.url().startsWith('blob:')
      )
        remote.push(request.url());
    });
    await page.goto(base);
    const name = 'Workspace export ' + base;
    await createProject(page, name);
    await page
      .getByLabel('Import media', { exact: true })
      .setInputFiles(await redPng(page));
    const clipButton = page.getByRole('button', {
      name: 'red.png',
      exact: true,
    });
    await expect(clipButton).toBeVisible();
    await expect.poll(() => previewPixel(page)).toEqual([255, 0, 0, 255]);
    await page
      .getByRole('button', { name: 'Play preview', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Pause preview', exact: true }),
    ).toBeVisible();
    const playingHead = page.getByRole('slider', {
      name: 'Playhead position',
      exact: true,
    });
    await expect
      .poll(async () => Number(await playingHead.inputValue()))
      .toBeGreaterThan(50_000);
    await playingHead.press('Home');
    await expect(
      page.getByRole('button', { name: 'Play preview', exact: true }),
    ).toBeVisible();
    await expect(playingHead).toHaveValue('0');
    await page.waitForTimeout(150);
    await expect(playingHead).toHaveValue('0');
    await clipButton.click();
    await page
      .getByRole('button', { name: 'Clip properties', exact: true })
      .click();
    await page.getByLabel('Start (seconds)', { exact: true }).fill('0.25');
    await page.getByLabel('Duration (seconds)', { exact: true }).fill('0.5');
    await page
      .getByRole('button', { name: 'Apply properties', exact: true })
      .click();
    await expect
      .poll(async () => {
        const clip = (await snapshot(page, base, name)).tracks[0]?.clips[0];
        return [clip?.startUs, clip?.durationUs];
      })
      .toEqual([250000, 500000]);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await snapshot(page, base, name)).tracks[0]?.clips[0]?.startUs,
      )
      .toBe(0);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await snapshot(page, base, name)).tracks[0]?.clips[0]?.startUs,
      )
      .toBe(250000);
    const playhead = page.getByRole('slider', {
      name: 'Playhead position',
      exact: true,
    });
    const bounds = await playhead.boundingBox();
    if (!bounds) throw new Error('Playhead has no interaction surface');
    await playhead.click({
      position: { x: bounds.width / 2, y: bounds.height / 2 },
    });
    await expect.poll(() => previewPixel(page)).toEqual([255, 0, 0, 255]);

    await page.reload();
    await page
      .getByRole('button', { name: 'Open project', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: 'Open project', exact: true })
      .getByRole('button')
      .filter({ has: page.getByText(name, { exact: true }) })
      .click();
    await expect(
      page.getByRole('button', { name: 'red.png', exact: true }),
    ).toBeVisible();
    const restored = await snapshot(page, base, name);
    expect(restored.tracks[0]!.clips[0]!).toMatchObject({
      startUs: 250000,
      durationUs: 500000,
    });
    for (const format of ['mp4', 'webm']) {
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      const dialog = page.getByRole('dialog', {
        name: 'Export video',
        exact: true,
      });
      await dialog
        .getByRole('combobox', { name: 'Format', exact: true })
        .click();
      await page
        .getByRole('option', {
          name: format === 'mp4' ? 'MP4' : 'WebM',
          exact: true,
        })
        .click();
      await dialog
        .getByRole('button', { name: 'Export video', exact: true })
        .click();
      const save = dialog.getByRole('button', {
        name: 'Save video',
        exact: true,
      });
      await expect(save).toBeVisible({ timeout: 60000 });
      const downloading = page.waitForEvent('download');
      await save.click();
      const download = await downloading;
      expect(download.suggestedFilename().endsWith('.' + format)).toBe(true);
      const path = await download.path();
      if (!path) throw new Error('No saved export file');
      const exported = await downloadedVideo(
        page,
        await readFile(path),
        'video/' + format,
      );
      expect(exported.duration).toBeGreaterThanOrEqual(0.74);
      expect(exported.duration).toBeLessThan(0.9);
      expect(exported.pixel[0]).toBeGreaterThan(240);
      expect(exported.pixel[1]).toBeLessThan(15);
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
    }
    expect(errors).toEqual([]);
    expect(remote).toEqual([]);
    const restoredPlayhead = page.getByRole('slider', {
      name: 'Playhead position',
      exact: true,
    });
    const restoredBounds = await restoredPlayhead.boundingBox();
    if (!restoredBounds)
      throw new Error('Restored playhead has no interaction surface');
    await restoredPlayhead.click({
      position: { x: restoredBounds.width / 2, y: restoredBounds.height / 2 },
    });
    await expect.poll(() => previewPixel(page)).toEqual([255, 0, 0, 255]);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
    const desktop = testInfo.outputPath('workspace-desktop.png');
    await page.screenshot({
      path: desktop,
      fullPage: true,
      animations: 'disabled',
    });
    await testInfo.attach('workspace desktop', {
      path: desktop,
      contentType: 'image/png',
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole('button', { name: 'Open project', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const narrow = testInfo.outputPath('workspace-narrow.png');
    await page.screenshot({
      path: narrow,
      fullPage: true,
      animations: 'disabled',
    });
    await testInfo.attach('workspace narrow', {
      path: narrow,
      contentType: 'image/png',
    });
    await page.setViewportSize({ width: 320, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });

  test(`conversation proposes and applies a visible editor change ${base}`, async ({
    page,
    context,
  }, testInfo) => {
    const model = 'test/workspace-model';
    const key = 'synthetic-workspace-test-key';
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    };
    await context.route('https://openrouter.ai/api/v1/models', (route) =>
      route.fulfill({
        headers: cors,
        json: {
          data: [
            {
              id: model,
              name: 'Workspace test model',
              context_length: 32000,
              supported_parameters: ['tools', 'tool_choice'],
              architecture: {
                input_modalities: ['text'],
                output_modalities: ['text'],
              },
            },
          ],
        },
      }),
    );
    const requests: Record<string, unknown>[] = [];
    let clipId = '';
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ headers: cors, body: '' });
          return;
        }
        const body = route.request().postDataJSON() as Record<string, unknown>;
        requests.push(body);
        const messages = body.messages as { role: string }[];
        const events = messages.some((message) => message.role === 'tool')
          ? [
              {
                choices: [
                  {
                    index: 0,
                    delta: {
                      content: 'The opacity change is ready for your review.',
                    },
                    finish_reason: 'stop',
                  },
                ],
              },
            ]
          : [
              {
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: 'opacity-proposal',
                          type: 'function',
                          function: {
                            name: 'propose_edits',
                            arguments: JSON.stringify({
                              summary:
                                'Reduce the selected clip opacity to 50%.',
                              operations: [
                                {
                                  type: 'updateClip',
                                  clipId,
                                  patch: { opacity: 0.5 },
                                },
                              ],
                            }),
                          },
                        },
                      ],
                    },
                    finish_reason: 'tool_calls',
                  },
                ],
              },
            ];
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body:
            events
              .map((event) => `data: ${JSON.stringify(event)}\n\n`)
              .join('') + 'data: [DONE]\n\n',
        });
      },
    );
    await page.goto(base);
    const name = 'Private project title';
    await createProject(page, name);
    await page
      .getByLabel('Import media', { exact: true })
      .setInputFiles(await redPng(page));
    await page.getByRole('button', { name: 'red.png', exact: true }).click();
    const initial = await snapshot(page, base, name);
    clipId = initial.tracks[0]!.clips[0]!.id;

    await page
      .getByRole('button', { name: 'Connect AI', exact: true })
      .first()
      .click();
    const settings = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await settings.getByLabel('OpenRouter API key', { exact: true }).fill(key);
    await settings
      .getByRole('button', { name: 'Use API key', exact: true })
      .click();
    await expect(
      settings.getByText('Key connected', { exact: true }),
    ).toBeVisible();
    await expect(
      settings.getByLabel('OpenRouter API key', { exact: true }),
    ).toHaveCount(0);
    await settings
      .getByRole('combobox', { name: 'AI model', exact: true })
      .click();
    await page
      .getByRole('option', {
        name: `Workspace test model · ${model}`,
        exact: true,
      })
      .click();
    for (const label of [
      'Share overlay and caption text',
      'Share project and media names',
      'Share source transcripts',
    ])
      await expect(
        settings.getByRole('checkbox', { name: label, exact: true }),
      ).not.toBeChecked();
    await settings.getByRole('button', { name: 'Done', exact: true }).click();
    await page
      .getByLabel('Describe your edit', { exact: true })
      .fill('Reduce the selected clip opacity to 50%.');
    await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .click();
    const apply = page.getByRole('button', {
      name: 'Apply proposal',
      exact: true,
    });
    await expect(apply).toBeEnabled();
    const beforeApply = await snapshot(page, base, name);
    expect(beforeApply.revision).toBe(initial.revision);
    expect(beforeApply.tracks[0]!.clips[0]!.opacity).toBe(1);
    await apply.click();
    await expect(
      page.getByText(`Applied at revision ${initial.revision + 1}`, {
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await snapshot(page, base, name)).tracks[0]!.clips[0]!.opacity,
      )
      .toBe(0.5);
    await expect.poll(() => previewPixel(page)).toEqual([128, 0, 0, 255]);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
    const conversationScreenshot = testInfo.outputPath(
      'conversation-applied.png',
    );
    await page.screenshot({
      path: conversationScreenshot,
      fullPage: true,
      animations: 'disabled',
    });
    await testInfo.attach('conversation applied', {
      path: conversationScreenshot,
      contentType: 'image/png',
    });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await snapshot(page, base, name)).tracks[0]!.clips[0]!.opacity,
      )
      .toBe(1);
    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(requests.every((request) => request.model === model)).toBe(true);
    expect(JSON.stringify(requests)).not.toContain(name);
    expect(JSON.stringify(requests)).not.toContain('red.png');
    expect(
      await page.evaluate(() =>
        [...Object.values(localStorage), ...Object.values(sessionStorage)].join(
          '\n',
        ),
      ),
    ).not.toContain(key);
  });
}

test('workspace imports image, audio and video, handles invalid input and cancels export', async ({
  page,
}) => {
  await page.goto('/LocalCut/');
  const name = 'Mixed media';
  await createProject(page, name);
  const input = page.getByLabel('Import media', { exact: true });
  for (const fixture of [
    await redPng(page),
    toneWav(),
    await greenVideo(page),
  ]) {
    await input.setInputFiles(fixture);
    await expect(
      page.getByRole('button', { name: fixture.name, exact: true }),
    ).toBeVisible();
  }
  const project = await snapshot(page, '/LocalCut/', name);
  expect(
    project.tracks
      .flatMap((track) => track.clips.map((clip) => clip.kind))
      .sort(),
  ).toEqual(['audio', 'image', 'video']);
  await page.getByRole('button', { name: 'green.webm', exact: true }).click();
  await page
    .getByRole('button', { name: 'Clip properties', exact: true })
    .click();
  await page.getByLabel('Speed', { exact: true }).fill('2');
  await page.getByLabel('Gain', { exact: true }).fill('0.5');
  await page
    .getByRole('button', { name: 'Apply properties', exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await snapshot(page, '/LocalCut/', name)).tracks
          .flatMap((track) => track.clips)
          .find((clip) => clip.kind === 'video')?.speed,
    )
    .toBe(2);
  const edited = (await snapshot(page, '/LocalCut/', name)).tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.kind === 'video')!;
  expect(edited.gain).toBe(0.5);
  expect(
    Math.abs(edited.durationUs - (edited.sourceOutUs! - edited.sourceInUs) / 2),
  ).toBeLessThanOrEqual(1);

  await input.setInputFiles({
    name: 'broken.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('invalid media contents'),
  });
  await expect(
    page.locator('[data-sonner-toast][data-type="error"]').last(),
  ).toContainText(/format|media|invalid|unsupported|parse|could not/i);
  expect(
    (await snapshot(page, '/LocalCut/', name)).tracks.flatMap(
      (track) => track.clips,
    ),
  ).toHaveLength(3);

  await page.getByRole('button', { name: 'red.png', exact: true }).click();
  await page
    .getByRole('button', { name: 'Clip properties', exact: true })
    .click();
  await page.getByLabel('Duration (seconds)', { exact: true }).fill('60');
  await page
    .getByRole('button', { name: 'Apply properties', exact: true })
    .click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Export video',
    exact: true,
  });
  await dialog
    .getByRole('button', { name: 'Export video', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Cancel export', exact: true })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Save video', exact: true }),
  ).not.toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Export video', exact: true }),
  ).toBeEnabled();
});

for (const base of ['/', '/LocalCut/']) {
  test(`speed rounding preserves exact source bounds ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const name = 'Fractional sample duration ' + base;
    await createProject(page, name);
    await page
      .getByLabel('Import media', { exact: true })
      .setInputFiles(toneWav(48001));
    const track = page.getByRole('button', { name: 'tone.wav', exact: true });
    await expect(track).toBeVisible();
    const originalProject = await snapshot(page, base, name);
    const original = originalProject.tracks.flatMap((item) => item.clips)[0]!;
    expect(original).toMatchObject({
      kind: 'audio',
      sourceInUs: 0,
      sourceOutUs: 1000021,
      durationUs: 1000021,
      speed: 1,
    });
    const readClip = async () =>
      (await snapshot(page, base, name)).tracks
        .flatMap((item) => item.clips)
        .find((clip) => clip.id === original.id)!;
    const update = async (label: string, value: string) => {
      await track.click();
      await page
        .getByRole('button', { name: 'Clip properties', exact: true })
        .click();
      await page.getByLabel(label, { exact: true }).fill(value);
      const before = await snapshot(page, base, name);
      await page
        .getByRole('button', { name: 'Apply properties', exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await snapshot(page, base, name)).revision > before.revision ||
            (await page
              .locator('[data-sonner-toast][data-type="error"]')
              .count()) > 0,
        )
        .toBe(true);
      return readClip();
    };
    const sped = await update('Speed', '2');
    expect(sped).toMatchObject({
      sourceInUs: original.sourceInUs,
      sourceOutUs: original.sourceOutUs,
      durationUs: 500011,
      speed: 2,
    });
    const gained = await update('Gain', '0.25');
    expect(gained).toMatchObject({
      sourceInUs: original.sourceInUs,
      sourceOutUs: original.sourceOutUs,
      durationUs: 500011,
      speed: 2,
      gain: 0.25,
    });
    const fractional = await update('Speed', '1.75');
    expect(fractional).toMatchObject({
      sourceInUs: original.sourceInUs,
      sourceOutUs: original.sourceOutUs,
      durationUs: 571441,
      speed: 1.75,
      gain: 0.25,
    });
    const trimmed = await update('Duration (seconds)', '0.25');
    expect(trimmed).toMatchObject({
      sourceInUs: 0,
      sourceOutUs: 437500,
      durationUs: 250000,
      speed: 1.75,
      gain: 0.25,
    });
  });
}
