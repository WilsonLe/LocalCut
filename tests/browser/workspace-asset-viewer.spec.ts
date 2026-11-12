import { test, expect } from '@playwright/test';
import { behaviorBases } from './coverage-bases';
import { closeMediaImport } from './workspace-import-helper';
import { mediaVideo } from './workspace-video-fixture';

function tone() {
  const bytes = Buffer.alloc(44 + 48000 * 2);
  bytes.write('RIFF');
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
  bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let i = 0; i < 48000; i++)
    bytes.writeInt16LE(
      Math.round(Math.sin((i * Math.PI * 880) / 48000) * 3000),
      44 + i * 2,
    );
  return { name: 'tone.wav', mimeType: 'audio/wav', buffer: bytes };
}

for (const base of behaviorBases) {
  test(`asset viewing opens original images video and audio without edits ${base}`, async ({
    page,
  }, info) => {
    page.setDefaultTimeout(15000);
    await page.goto(base);
    await page.getByRole('main', { name: 'Video editor', exact: true }).focus();
    await page.keyboard.press('n');
    await page
      .getByLabel('Project name', { exact: true })
      .fill('Source previews');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    const png = await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(640, 360);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#194f70';
      ctx.fillRect(0, 0, 640, 360);
      ctx.fillStyle = '#f2bc55';
      ctx.beginPath();
      ctx.arc(460, 110, 55, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#438b89';
      ctx.beginPath();
      ctx.moveTo(0, 320);
      ctx.lineTo(220, 100);
      ctx.lineTo(450, 360);
      ctx.lineTo(0, 360);
      ctx.fill();
      return [
        ...new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer()),
      ];
    });
    await page.getByLabel('Import media', { exact: true }).setInputFiles([
      {
        name: 'Landscape.png',
        mimeType: 'image/png',
        buffer: Buffer.from(png),
      },
      tone(),
      await mediaVideo(page),
    ]);
    await closeMediaImport(page);
    const readProject = () =>
      page.evaluate(async (base) => {
        const { createEditor } = (await import(
          base + 'editor.js'
        )) as typeof import('../../src/editor');
        const editor = await createEditor();
        try {
          const id = decodeURIComponent(location.hash.split('/')[2]!);
          return await editor.projects.snapshot(id);
        } finally {
          await editor.dispose();
        }
      }, base);
    const before = await readProject();
    const card = (name: string) =>
      page.getByRole('button', {
        name: `Asset details for ${name}`,
        exact: true,
      });
    const dialog = (name: string) =>
      page.getByRole('dialog', { name, exact: true });
    const revoked: string[] = [];
    await page.exposeFunction('recordViewerRevoke', (url: string) => {
      revoked.push(url);
    });
    await page.evaluate(() => {
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = (url) => {
        void (
          window as unknown as {
            recordViewerRevoke(url: string): Promise<void>;
          }
        ).recordViewerRevoke(url);
        revoke(url);
      };
    });
    // Keep the same project mounted across catalog navigation. A pending
    // optional dialog must not outlive its route or reopen after it resolves.
    const catalogAndReturn = async () => {
      await page.evaluate(() => {
        const id = location.hash.split('/')[2]!;
        location.hash = `/projects?project=${id}`;
      });
      await expect(page).toHaveURL(/#\/projects\?project=/);
      await page
        .getByRole('button', { name: 'Back to editor', exact: true })
        .click();
    };
    await catalogAndReturn();
    let releaseChunk!: () => void;
    let chunkStarted!: () => void;
    let chunkFinished!: () => void;
    const released = new Promise<void>((resolve) => {
      releaseChunk = resolve;
    });
    const started = new Promise<void>((resolve) => {
      chunkStarted = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      chunkFinished = resolve;
    });
    await page.route('**/assets/AssetViewerDialog-*.js', async (route) => {
      chunkStarted();
      await released;
      await route.continue();
      chunkFinished();
    });
    try {
      await card('Landscape.png').click();
      await started;
      await page.goBack();
      await expect(page).toHaveURL(/#\/projects\?project=/);
      await expect(dialog('Landscape.png')).toHaveCount(0);
      await expect(page.getByText(/Opening landscape.png/)).toHaveCount(0);
    } finally {
      releaseChunk();
    }
    await finished;
    await page.unroute('**/assets/AssetViewerDialog-*.js');
    await page
      .getByRole('button', { name: 'Back to editor', exact: true })
      .click();
    await expect(dialog('Landscape.png')).toHaveCount(0);
    await card('Landscape.png').click();
    const image = dialog('Landscape.png').getByRole('img', {
      name: 'Landscape.png',
      exact: true,
    });
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBe(640);
    expect(
      await image.evaluate((img: HTMLImageElement) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        return [...ctx.getImageData(0, 0, 1, 1).data];
      }),
    ).toEqual([25, 79, 112, 255]);
    const imageUrl = await image.getAttribute('src');
    await page.screenshot({
      path: info.outputPath('asset-viewer-desktop.png'),
    });
    await page.keyboard.press('Escape');
    await expect(dialog('Landscape.png')).toBeHidden();
    await expect(card('Landscape.png')).toBeFocused();
    await expect.poll(() => revoked.includes(imageUrl!)).toBe(true);
    await card('tone.wav').click({ modifiers: ['Meta'] });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(card('Landscape.png')).toHaveAttribute('aria-pressed', 'true');
    await expect(card('tone.wav')).toHaveAttribute('aria-pressed', 'true');
    // Both entry points share the same job. Hold native analysis at its lock
    // boundary so progress, duplicate suppression and cancellation are observed.
    const audioId = await card('tone.wav').evaluate(
      (el) => el.closest<HTMLElement>('[data-asset-id]')!.dataset.assetId!,
    );
    await page.evaluate(async (assetId) => {
      let acquired!: () => void;
      const ready = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      const host = window as unknown as {
        releaseViewerIndex: () => void;
        viewerIndexLock: Promise<unknown>;
      };
      host.viewerIndexLock = navigator.locks.request(
        `localcut:asset-index:analysis:${assetId}`,
        async () => {
          acquired();
          await new Promise<void>((resolve) => {
            host.releaseViewerIndex = resolve;
          });
        },
      );
      await ready;
    }, audioId);
    try {
      await page
        .getByRole('button', { name: 'Actions for tone.wav', exact: true })
        .click();
      await page
        .getByRole('menuitem', { name: 'Index asset', exact: true })
        .click();
      await card('tone.wav').click();
      await expect(
        dialog('tone.wav').getByRole('button', {
          name: 'Cancel indexing',
          exact: true,
        }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await page
        .getByRole('button', { name: 'Actions for tone.wav', exact: true })
        .click();
      await expect(
        page.getByRole('menuitem', { name: 'Indexing…', exact: true }),
      ).toBeDisabled();
      await page.keyboard.press('Escape');
      await card('tone.wav').click();
      await dialog('tone.wav')
        .getByRole('button', { name: 'Cancel indexing', exact: true })
        .click();
      await expect(dialog('tone.wav').getByRole('status')).toContainText(
        'Indexing cancelled',
      );
    } finally {
      await page.evaluate(async () => {
        const host = window as unknown as {
          releaseViewerIndex: () => void;
          viewerIndexLock: Promise<unknown>;
        };
        host.releaseViewerIndex();
        await host.viewerIndexLock;
      });
    }
    await dialog('tone.wav')
      .getByRole('button', { name: 'Index asset', exact: true })
      .click();
    await expect(dialog('tone.wav').getByRole('status')).toContainText(
      'Indexed ·',
    );
    await expect(dialog('tone.wav').getByRole('status')).toContainText(
      '4 audio windows',
    );
    await page.screenshot({ path: info.outputPath('asset-viewer-audio.png') });
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', { name: 'Actions for Landscape.png', exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'Index asset', exact: true })
      .click();
    await card('Landscape.png').click();
    await expect(dialog('Landscape.png').getByRole('status')).toContainText(
      'Indexed · 1 scene · 1 frame',
    );
    await page.keyboard.press('Escape');
    for (const [name, tag] of [
      ['tone.wav', 'audio'],
      ['green.webm', 'video'],
    ] as const) {
      await card(name).focus();
      await page.keyboard.press(name === 'tone.wav' ? 'Enter' : 'Space');
      const source = dialog(name).locator(tag);
      await expect
        .poll(() => source.evaluate((el: HTMLMediaElement) => el.readyState))
        .toBeGreaterThanOrEqual(1);
      if (tag === 'video') {
        await dialog(name)
          .getByRole('button', { name: 'Index asset', exact: true })
          .click();
        await expect(dialog(name).getByRole('status')).toContainText(
          'Indexed ·',
        );
        await page.screenshot({
          path: info.outputPath('asset-viewer-video.png'),
        });
      }
      const scrubber = dialog(name).getByRole('slider', {
        name: 'Preview position',
        exact: true,
      });
      await scrubber.focus();
      await scrubber.press('End');
      await expect
        .poll(() => source.evaluate((el: HTMLMediaElement) => el.currentTime))
        .toBeGreaterThan(0.2);
      await scrubber.press('Home');
      await dialog(name)
        .getByRole('button', { name: 'Play clip', exact: true })
        .click();
      await expect
        .poll(() => source.evaluate((el: HTMLMediaElement) => el.currentTime))
        .toBeGreaterThan(0);
      const handle = await source.elementHandle();
      const url = await source.getAttribute('src');
      await dialog(name)
        .getByRole('button', { name: 'Close', exact: true })
        .click();
      await expect.poll(() => revoked.includes(url!)).toBe(true);
      expect(await handle!.evaluate((el: HTMLMediaElement) => el.paused)).toBe(
        true,
      );
      await expect(card(name)).toBeFocused();
    }
    const indexes = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const projectId = location.hash.split('/')[2]!;
        const entries = (await editor.library.forProject(projectId).list())
          .entries;
        const results = [];
        for (const name of ['tone.wav', 'green.webm', 'Landscape.png']) {
          const id = entries.find((entry) => entry.name === name)!.assetId!;
          const runs = await editor.assets.indexes.list(id);
          results.push({
            name,
            count: runs.length,
            status: runs[0]!.status,
            frames: runs[0]!.analysis.frames.length,
          });
        }
        const tasks = (await editor.tasks.list()).filter(
          (task) => task.kind === 'media.analyze',
        );
        return {
          results,
          completed: tasks.filter((task) => task.state === 'completed').length,
          cancelled: tasks.filter((task) => task.state === 'cancelled').length,
        };
      } finally {
        await editor.dispose();
      }
    }, base);
    expect(indexes.completed).toBe(3);
    expect(indexes.cancelled).toBe(1);
    expect(indexes.results).toHaveLength(3);
    for (const result of indexes.results) {
      expect(result.count).toBe(1);
      expect(result.status).toBe('analyzed');
      expect(result.frames).toBe(
        result.name === 'tone.wav' ? 0 : expect.any(Number),
      );
      if (result.name !== 'tone.wav') expect(result.frames).toBeGreaterThan(0);
    }
    await catalogAndReturn();
    await card('tone.wav').click();
    const navigatingAudio = dialog('tone.wav').locator('audio');
    await dialog('tone.wav')
      .getByRole('button', { name: 'Play clip', exact: true })
      .click();
    const audioHandle = await navigatingAudio.elementHandle();
    const navigatingUrl = await navigatingAudio.getAttribute('src');
    await page.goBack();
    await expect(page).toHaveURL(/#\/projects\?project=/);
    await expect(dialog('tone.wav')).toHaveCount(0);
    await expect.poll(() => revoked.includes(navigatingUrl!)).toBe(true);
    expect(
      await audioHandle!.evaluate((el: HTMLMediaElement) => el.paused),
    ).toBe(true);
    await page
      .getByRole('button', { name: 'Back to editor', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await readProject()).toEqual(before);
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    await card('Landscape.png').click();
    await expect(dialog('Landscape.png').getByRole('img')).toBeVisible();
    const bounds = await dialog('Landscape.png').boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: info.outputPath('asset-viewer-mobile.png') });
    await page.keyboard.press('Escape');
    // Remove only this test's original; the card must still open with recovery.
    await page.evaluate(
      async (assetId) => {
        const root = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle('localcut');
        await root.removeEntry(assetId);
      },
      await card('Landscape.png').evaluate(
        (el) => el.closest<HTMLElement>('[data-asset-id]')!.dataset.assetId!,
      ),
    );
    await card('Landscape.png').click();
    await expect(dialog('Landscape.png').getByRole('alert')).toContainText(
      /relink/i,
    );
    await dialog('Landscape.png')
      .getByRole('button', { name: 'Index asset', exact: true })
      .click();
    await expect(
      dialog('Landscape.png').getByRole('alert').last(),
    ).toContainText(/missing/i);
    await page.keyboard.press('Escape');
    await page.reload();
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    for (const name of ['tone.wav', 'green.webm']) {
      await card(name).click();
      await expect(dialog(name).getByRole('status')).toContainText('Indexed ·');
      await expect(
        dialog(name).getByRole('slider', {
          name: 'Preview position',
          exact: true,
        }),
      ).toBeEnabled();
      if (name === 'tone.wav')
        await page.screenshot({
          path: info.outputPath('asset-viewer-audio-mobile.png'),
        });
      await page.keyboard.press('Escape');
    }
  });
}
