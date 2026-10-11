import { dismissNotifications } from './workspace-notifications-helper';
import { dragPlayhead } from './workspace-playhead-helper';
import { openAISettings } from './workspace-settings-helper';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Project } from '../../src/core/model';

async function createProject(page: Page, name: string) {
  await page
    .getByRole('button', { name: 'Workspace settings', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
  await page
    .getByRole('menuitem', { name: 'New project', exact: true })
    .click();
  await page.getByLabel('Project name', { exact: true }).fill(name);
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'New project', exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Workspace settings', exact: true }),
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

function toneWav(frames = 24000, silentFrames = 0, amplitude = 3000) {
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
      frame < silentFrames
        ? 0
        : Math.sin((frame * 2 * Math.PI * 440) / sampleRate) * amplitude,
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
  test(`timeline media previews, waveform trimming and mobile selection ${base}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    const remote: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (
        !request.url().startsWith('http://127.0.0.1:') &&
        !request.url().startsWith('blob:') &&
        !request.url().startsWith('data:')
      )
        remote.push(request.url());
    });
    await page.goto(base);
    await createProject(page, 'Timeline previews');
    await page
      .getByLabel('Import media', { exact: true })
      .setInputFiles([
        await redPng(page),
        toneWav(96000, 48000, 12000),
        await greenVideo(page),
      ]);
    const timeline = page.getByRole('region', { name: 'Video timeline' });
    const image = timeline.getByRole('button', {
      name: 'red.png',
      exact: true,
    });
    const video = timeline.getByRole('button', {
      name: 'green.webm',
      exact: true,
    });
    const audio = timeline.getByRole('button', {
      name: 'tone.wav',
      exact: true,
    });
    for (const [clip, expected] of [
      [image, [255, 0, 0]],
      [video, [0, 255, 0]],
    ] as const) {
      // Timeline previews start only when their clip enters the viewport.
      await clip.scrollIntoViewIfNeeded();
      await expect(clip.locator('.timeline-thumbnail')).toBeAttached();
      const pixel = await clip
        .locator('.timeline-thumbnail')
        .evaluate(async (element) => {
          const url = getComputedStyle(element).backgroundImage.slice(5, -2);
          const image = new Image();
          image.src = url;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(image, 0, 0, 1, 1);
          return [...ctx.getImageData(0, 0, 1, 1).data];
        });
      expected.forEach((value, i) =>
        expect(Math.abs(pixel[i]! - value)).toBeLessThan(8),
      );
    }
    const heights = () =>
      audio
        .locator('.timeline-waveform path')
        .evaluate((path) =>
          [...path.getAttribute('d')!.matchAll(/v([\d.]+)/g)].map((m) =>
            Number(m[1]),
          ),
        );
    await audio.scrollIntoViewIfNeeded();
    await expect(audio.locator('.timeline-waveform')).toBeAttached();
    expect((await heights()).slice(0, 60)).toEqual(Array(60).fill(1));
    expect(Math.min(...(await heights()).slice(65))).toBeGreaterThan(8);
    await audio.click();
    await expect(audio).toHaveAttribute('aria-pressed', 'true');
    await audio.focus();
    await page.keyboard.press('Space');
    await expect(audio).toBeFocused();
    await page.screenshot({
      path: `.artifacts/timeline-previews-desktop-${base === '/' ? 'root' : 'pages'}.png`,
    });
    await page.reload();
    await image.scrollIntoViewIfNeeded();
    await expect(image.locator('.timeline-thumbnail')).toBeAttached();
    await audio.scrollIntoViewIfNeeded();
    await expect(audio.locator('.timeline-waveform')).toBeAttached();
    await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const p = (await editor.projects.list()).find(
          (p) => p.name === 'Timeline previews',
        )!;
        const project = await editor.projects.snapshot(p.id);
        const clip = project.tracks
          .flatMap((t) => t.clips)
          .find((c) => c.kind === 'audio')!;
        await editor.commands.apply({
          projectId: p.id,
          expectedRevision: project.revision,
          requestId: 'trim-waveform',
          operations: [
            {
              type: 'updateClip',
              clipId: clip.id,
              patch: {
                sourceInUs: 1000000,
                sourceOutUs: 2000000,
                durationUs: 500000,
                speed: 2,
              },
            },
          ],
        });
      } finally {
        await editor.dispose();
      }
    }, base);
    await expect
      .poll(async () => Math.min(...(await heights())))
      .toBeGreaterThan(8);
    await page.setViewportSize({ width: 390, height: 844 });
    await image.click();
    await expect(image).toHaveAttribute('aria-pressed', 'true');
    await expect(image.locator('.timeline-clip-name')).toBeVisible();
    await expect(image.locator('.timeline-thumbnail')).toBeAttached();
    await page.screenshot({
      path: `.artifacts/timeline-previews-mobile-${base === '/' ? 'root' : 'pages'}.png`,
    });
    expect(remote).toEqual([]);
    expect(errors).toEqual([]);
  });

  test(`workspace media thumbnails and asset tooltips ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    await createProject(page, 'Media previews');
    const fixtures = [await redPng(page), toneWav(), await greenVideo(page)];
    for (const fixture of fixtures) {
      await page
        .getByLabel('Import media', { exact: true })
        .setInputFiles(fixture);
      await expect(
        page.getByRole('button', { name: fixture.name, exact: true }),
      ).toBeVisible();
    }
    const cards = page.locator('.media-item');
    await expect(cards).toHaveCount(3);
    await expect(cards).not.toContainText(['128 × 72', 'Connect AI', '0.50']);
    for (const [name, expected] of [
      ['red.png', [255, 0, 0]],
      ['green.webm', [0, 255, 0]],
    ] as const) {
      const image = page.getByRole('img', { name: `Thumbnail for ${name}` });
      await expect
        .poll(() =>
          image.evaluate((element) => {
            const image = element as HTMLImageElement;
            return image.complete && image.naturalWidth > 0;
          }),
        )
        .toBe(true);
      const pixel = await image.evaluate((element) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d')!;
        context.drawImage(element as HTMLImageElement, 0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data];
      });
      expected.forEach((channel, index) =>
        expect(Math.abs(pixel[index]! - channel)).toBeLessThan(8),
      );
    }
    const audio = page.getByRole('button', {
      name: 'Asset details for tone.wav',
    });
    await expect(audio.locator('svg')).toBeVisible();
    await expect(audio.locator('img')).toHaveCount(0);
    const imageDetails = page.getByRole('button', {
      name: 'Asset details for red.png',
    });
    await imageDetails.hover();
    await expect(page.getByRole('tooltip')).toContainText('128 × 72');
    await expect(page.getByRole('tooltip')).toContainText('image/png');
    await page.mouse.move(0, 0);
    await expect(page.getByRole('tooltip')).not.toBeVisible();
    await audio.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tooltip', { name: /tone.wav/ })).toContainText(
      'audio',
    );
    await expect(
      page.getByRole('tooltip', { name: /tone.wav/ }),
    ).not.toContainText('0 × 0');
    await page.evaluate(() =>
      localStorage.setItem(
        'localcut.asset-index-consent.v1',
        JSON.stringify({ version: 1, provider: 'openrouter', allowed: true }),
      ),
    );
    await page.reload();
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    await expect(
      page.getByRole('img', { name: 'Thumbnail for red.png' }),
    ).toBeVisible();
    await expect(
      page.getByRole('img', { name: 'Thumbnail for green.webm' }),
    ).toBeVisible();
    await expect(cards).not.toContainText([
      'Connect AI and choose a compatible model to index this asset.',
      '128 × 72',
    ]);
    await page
      .getByRole('button', { name: 'Asset details for red.png' })
      .focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tooltip')).toContainText(
      'Connect AI and choose a compatible model to index this asset.',
    );
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .focus();
    await page.screenshot({
      path: `.artifacts/media-thumbnails-${base === '/' ? 'root' : 'pages'}.png`,
    });
  });

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
      .poll(async () => Number(await playingHead.getAttribute('aria-valuenow')))
      .toBeGreaterThan(50_000);
    await playingHead.press('Home');
    await expect(
      page.getByRole('button', { name: 'Play preview', exact: true }),
    ).toBeVisible();
    await expect(playingHead).toHaveAttribute('aria-valuenow', '0');
    await page.waitForTimeout(150);
    await expect(playingHead).toHaveAttribute('aria-valuenow', '0');
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
    await dragPlayhead(page, 0.5);
    await expect.poll(() => previewPixel(page)).toEqual([255, 0, 0, 255]);

    await page.reload();
    await page
      .getByRole('button', { name: 'Open project', exact: true })
      .click();
    await page
      .getByRole('main', { name: 'Projects', exact: true })
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
      const path = testInfo.outputPath('export.' + format);
      await download.saveAs(path);
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
    await dragPlayhead(page, 0.5);
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
        const tools = body.tools as { function: { name: string } }[];
        if (!tools.some((tool) => tool.function.name === 'propose_edits')) {
          await route.fulfill({
            headers: cors,
            contentType: 'text/event-stream',
            body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'load-editing', type: 'function', function: { name: 'load_skill', arguments: '{"skillId":"editing"}' } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`,
          });
          return;
        }
        requests.push(body);
        const messages = body.messages as {
          role: string;
          tool_calls?: { function: { name: string } }[];
        }[];
        const events = messages.some((message) =>
          message.tool_calls?.some(
            (tool) => tool.function.name === 'propose_edits',
          ),
        )
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

    await openAISettings(page);
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
    ).not.toBeVisible();
    await expect(
      settings.getByRole('button', {
        name: 'Reconnect OpenRouter',
        exact: true,
      }),
    ).toBeVisible();
    await settings
      .getByRole('combobox', { name: 'AI model', exact: true })
      .click();
    await page
      .getByRole('option', {
        name: `Workspace test model · ${model}`,
        exact: true,
      })
      .click();
    await settings
      .getByRole('button', { name: 'Data & analytics', exact: true })
      .click();
    const sharing = page.getByRole('dialog', {
      name: 'Data & analytics',
      exact: true,
    });
    for (const label of [
      'Share overlay and caption text',
      'Share project and media names',
      'Share source transcripts',
    ])
      await expect(
        sharing.getByRole('checkbox', { name: label, exact: true }),
      ).not.toBeChecked();
    await page.keyboard.press('Escape');
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
        [
          ...Object.entries(localStorage)
            .filter(([name]) => name !== 'localcut.openrouter-credential.v1')
            .map(([, value]) => value),
          ...Object.values(sessionStorage),
        ].join('\n'),
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

for (const base of ['/', '/LocalCut/']) {
  test(`custom speed ramps and pitch controls persist ${base}`, async ({
    page,
  }, testInfo) => {
    await page.goto(base);
    const name = 'Custom ramp ' + base;
    await createProject(page, name);
    await page
      .getByLabel('Import media', { exact: true })
      .setInputFiles(toneWav(4 * 48000));
    const track = page.getByRole('button', { name: 'tone.wav', exact: true });
    const properties = async () => {
      // A success toast can cover the scrolled mobile track and pause when
      // hovered. Use its real close control before selecting the next edit.
      await dismissNotifications(page);
      await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
      await track.click();
      await page
        .getByRole('button', { name: 'Clip properties', exact: true })
        .click();
    };
    const select = async (label: string, option: string) => {
      await page.getByRole('combobox', { name: label, exact: true }).click();
      await expect(
        page.getByRole('combobox', { name: label, exact: true }),
      ).toHaveAttribute('aria-expanded', 'true');
      await page
        .getByRole('option', { name: option, exact: true })
        .filter({ visible: true })
        .click();
      await expect(
        page.locator('[data-slot="select-content"]:visible'),
      ).toHaveCount(0);
    };
    await properties();
    await select('Audio pitch', 'Keep pitch');
    for (const preset of [
      'Staircase up',
      'Staircase down',
      'Staircase up then down',
      'Staircase down then up',
    ]) {
      await select('Speed profile', preset);
      await expect(
        page.getByLabel('Point 9 speed', { exact: true }),
      ).toBeVisible();
    }
    await select('Speed profile', 'Up then down');
    await page.getByLabel('Point 2 speed', { exact: true }).fill('3');
    await select('Segment 1', 'Staircase');
    await select('Segment 2', 'Linear');
    await page
      .getByRole('button', { name: 'Add ramp point', exact: true })
      .click();
    await page.getByLabel('Point 2 (%)', { exact: true }).fill('20');
    await page.getByLabel('Point 2 speed', { exact: true }).fill('1');
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('speed-ramp-desktop.png'),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath('speed-ramp-narrow.png'),
    });
    const dialog = page.getByRole('dialog', {
      name: 'Clip properties',
      exact: true,
    });
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await expect
      .poll(() =>
        dialog.evaluate((element) => {
          const dialog = element.getBoundingClientRect();
          const button = element
            .querySelector('button[type="submit"]')!
            .getBoundingClientRect();
          return (
            button.top >= dialog.top &&
            button.bottom <= dialog.bottom &&
            button.bottom <= innerHeight - 16
          );
        }),
      )
      .toBe(true);
    await page
      .getByRole('button', { name: 'Apply properties', exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    const saved = (await snapshot(page, base, name)).tracks.flatMap(
      (t) => t.clips,
    )[0]!;
    expect(saved.pitchMode).toBe('preserve');
    expect(
      saved.speedRamp?.map((p) => [p.position, p.speed, p.interpolation]),
    ).toEqual([
      [0, 0.5, 'hold'],
      [0.2, 1, 'hold'],
      [0.5, 3, 'linear'],
      [1, 0.5, 'smooth'],
    ]);
    expect(saved.sourceOutUs).toBe(4000000);
    // The success toast overlaps the mobile media toggle and pauses while hovered.
    await dismissNotifications(page);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
    // Mobile media starts closed independently of the desktop rail preference.
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Close media', exact: true })
      .click();
    await properties();
    // The core allows strictly ordered points closer than 0.01%; the form must too.
    await page.getByLabel('Point 2 (%)', { exact: true }).fill('0.001');
    await page.getByLabel('Point 3 (%)', { exact: true }).fill('0.002');
    await page
      .getByRole('button', { name: 'Apply properties', exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    const dense = (await snapshot(page, base, name)).tracks.flatMap(
      (t) => t.clips,
    )[0]!;
    expect(dense.speedRamp?.map((p) => p.position)).toEqual([
      0, 0.00001, 0.00002, 1,
    ]);
    await properties();
    await page.getByLabel('Gain', { exact: true }).fill('0.4');
    await page
      .getByRole('button', { name: 'Apply properties', exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    const gained = (await snapshot(page, base, name)).tracks.flatMap(
      (t) => t.clips,
    )[0]!;
    expect(gained.speedRamp).toEqual(dense.speedRamp);
    expect(gained.durationUs).toBe(dense.durationUs);
    await properties();
    await select('Speed profile', 'Constant');
    await page.getByLabel('Speed', { exact: true }).fill('2');
    await page
      .getByRole('button', { name: 'Apply properties', exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    const constant = (await snapshot(page, base, name)).tracks.flatMap(
      (t) => t.clips,
    )[0]!;
    expect(constant).toMatchObject({
      speed: 2,
      pitchMode: 'preserve',
      durationUs: 2000000,
      gain: 0.4,
    });
    expect(constant.speedRamp).toBeUndefined();
  });
}
