import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Project } from '../../src/editor';

async function prepare(page: Page, base: string, overlap = false) {
  await page.goto(base);
  const id = await page.evaluate(
    async ({ base, overlap }) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const canvas = new OffscreenCanvas(128, 72),
          context = canvas.getContext('2d')!;
        context.fillStyle = '#369';
        context.fillRect(0, 0, 128, 72);
        const asset = await editor.assets.import(
          new File([await canvas.convertToBlob()], 'input.png', {
            type: 'image/png',
          }),
        ).completion;
        context.fillStyle = '#f00';
        context.fillRect(0, 0, 128, 72);
        const upper = overlap
          ? await editor.assets.import(
              new File([await canvas.convertToBlob()], 'upper.png', {
                type: 'image/png',
              }),
            ).completion
          : asset;
        const p = await editor.projects.create('Input combinations');
        await editor.commands.apply({
          projectId: p.id,
          requestId: crypto.randomUUID(),
          expectedRevision: 0,
          operations: [
            { type: 'addTrack', track: { id: 'v', kind: 'video' } },
            ...[0, overlap ? 0 : 3_000_000].map((startUs, index) => ({
              type: 'insertClip' as const,
              trackId: 'v',
              clip: {
                id: `clip-${index}`,
                kind: 'image' as const,
                assetId: index ? upper.id : asset.id,
                startUs,
                durationUs: 1_000_000,
              },
            })),
          ],
        });
        return p.id;
      } finally {
        await editor.dispose();
      }
    },
    { base, overlap },
  );
  await page.getByRole('main', { name: 'Video editor', exact: true }).focus();
  await page.keyboard.press('ControlOrMeta+o');
  await page
    .getByRole('dialog', { name: 'Open project', exact: true })
    .getByRole('button', { name: /Input combinations/ })
    .click();
  await expect(page.locator('.timeline-clip')).toHaveCount(2);
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  return id;
}
async function snapshot(
  page: Page,
  base: string,
  id: string,
): Promise<Project> {
  return page.evaluate(
    async ({ base, id }) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        return await editor.projects.snapshot(id);
      } finally {
        await editor.dispose();
      }
    },
    { base, id },
  );
}
for (const base of ['/', '/LocalCut/']) {
  test(`editor combinations zoom the pointed surface, preserve anchors and pan/scrub ${base}`, async ({
    page,
  }, info) => {
    const id = await prepare(page, base);
    const timeline = page.locator('.timeline-viewport'),
      preview = page.locator('.preview-stage');
    const revision = (await snapshot(page, base, id)).revision;
    const box = (await timeline.boundingBox())!;
    const x = box.width * 0.7,
      y = 18;
    const timeAtPointer = () =>
      timeline.evaluate(
        (element, x) =>
          (x + element.scrollLeft - 76) / (element.scrollWidth - 76),
        x,
      );
    const anchor = await timeAtPointer();
    const initialWidth = await timeline.evaluate((e) => e.scrollWidth);
    await page.mouse.move(box.x + x, box.y + y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -140);
    await page.keyboard.up('Control');
    await expect
      .poll(() => timeline.evaluate((e) => e.scrollWidth))
      .toBeGreaterThan(initialWidth * 1.5);
    await expect.poll(timeAtPointer).toBeCloseTo(anchor, 2);
    await expect(page.locator('.preview-stage canvas')).toHaveCSS(
      'transform',
      'matrix(1, 0, 0, 1, 0, 0)',
    );
    const scroll = await timeline.evaluate((e) => e.scrollLeft);
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, 50);
    await page.keyboard.up('Shift');
    await expect
      .poll(() => timeline.evaluate((e) => e.scrollLeft))
      .toBeGreaterThan(scroll);
    const beforePan = await timeline.evaluate((e) => e.scrollLeft);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(box.x + x - 40, box.y + y);
    await page.mouse.up({ button: 'middle' });
    await expect
      .poll(() => timeline.evaluate((e) => e.scrollLeft))
      .toBeGreaterThan(beforePan);
    await timeline.focus();
    await page.keyboard.press('0');
    await expect
      .poll(() => timeline.evaluate((e) => e.scrollWidth))
      .toBe(initialWidth);
    await expect.poll(() => timeline.evaluate((e) => e.scrollLeft)).toBe(0);
    const ruler = (await page.locator('.timeline-ruler').boundingBox())!;
    await page.mouse.move(
      ruler.x + ruler.width / 4,
      ruler.y + ruler.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      ruler.x + ruler.width / 2,
      ruler.y + ruler.height / 2,
    );
    await page.mouse.up();
    await expect
      .poll(async () =>
        Number(
          await page
            .getByRole('slider', { name: 'Playhead position' })
            .inputValue(),
        ),
      )
      .toBeGreaterThan(1_900_000);
    await expect
      .poll(async () =>
        Number(
          await page
            .getByRole('slider', { name: 'Playhead position' })
            .inputValue(),
        ),
      )
      .toBeLessThan(2_100_000);
    const pbox = (await preview.boundingBox())!;
    const px = Math.round(pbox.x + pbox.width * 0.65) - pbox.x,
      py = Math.round(pbox.y + pbox.height * 0.4) - pbox.y;
    const contentAtPointer = () =>
      preview.locator('canvas').evaluate(
        (canvas, { px, py }) => {
          const m = new DOMMatrix(getComputedStyle(canvas).transform);
          return { x: (px - m.e) / m.a, y: (py - m.f) / m.d, scale: m.a };
        },
        { px, py },
      );
    const before = await contentAtPointer();
    await page.mouse.move(pbox.x + px, pbox.y + py);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    await expect
      .poll(async () => (await contentAtPointer()).scale)
      .toBeGreaterThan(1.5);
    expect((await contentAtPointer()).x).toBeCloseTo(before.x, 2);
    expect((await contentAtPointer()).y).toBeCloseTo(before.y, 2);
    expect(await timeline.evaluate((e) => e.scrollWidth)).toBe(initialWidth);
    await preview.focus();
    await page.keyboard.press('=');
    await expect
      .poll(async () => (await contentAtPointer()).scale)
      .toBeGreaterThan(2);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(pbox.x + px + 30, pbox.y + py + 20);
    await page.mouse.up({ button: 'middle' });
    expect((await contentAtPointer()).x).not.toBeCloseTo(before.x, 0);
    // Reaching minimum zoom after panning must return to the fit transform.
    await page.mouse.move(pbox.x + px, pbox.y + py);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 240);
    await page.mouse.wheel(0, 240);
    await page.keyboard.up('Control');
    await expect(preview.locator('canvas')).toHaveCSS(
      'transform',
      'matrix(1, 0, 0, 1, 0, 0)',
    );
    // Wheel does not commit view transforms or zoom the page.
    expect((await snapshot(page, base, id)).revision).toBe(revision);
    expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
    await page.screenshot({ path: info.outputPath('editor-input-views.png') });
  });

  test(`editor combinations preserve text, modal gestures and native clip activation ${base}`, async ({
    page,
  }) => {
    const id = await prepare(page, base);
    const revision = (await snapshot(page, base, id)).revision;
    await page.getByRole('main', { name: 'Video editor', exact: true }).focus();
    await page.keyboard.press('ControlOrMeta+s');
    await expect(
      page.getByText('Project saved', { exact: true }),
    ).toBeVisible();
    await page.locator('.timeline-clip').first().focus();
    await page.keyboard.press('Space');
    await expect(
      page.locator('.timeline-clip[aria-pressed="true"]'),
    ).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: 'Play preview', exact: true }),
    ).toBeVisible();
    await page.getByRole('main', { name: 'Video editor', exact: true }).focus();
    await page.keyboard.press('n');
    const input = page.getByLabel('Project name', { exact: true });
    await input.fill('qws');
    await input.press('ControlOrMeta+a');
    await input.press('x');
    await expect(input).toHaveValue('x');
    const prevented = await page.locator('.timeline-viewport').evaluate(
      (element) =>
        !element.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: -100,
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        ),
    );
    expect(prevented).toBe(false);
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    const initial = await page
      .locator('.timeline-viewport')
      .evaluate((e) => e.scrollWidth);
    await page.getByRole('main', { name: 'Video editor', exact: true }).focus();
    await page.keyboard.press('=');
    await expect
      .poll(() =>
        page.locator('.timeline-viewport').evaluate((e) => e.scrollWidth),
      )
      .toBeGreaterThan(initial);
    await page.keyboard.press('?');
    const help = page.getByRole('dialog', {
      name: 'Keyboard shortcuts',
      exact: true,
    });
    await expect(
      help.getByText('View and mouse', { exact: true }),
    ).toBeVisible();
    const last = help.getByText('Commands', { exact: true });
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeVisible();
    expect((await snapshot(page, base, id)).revision).toBe(revision);
  });

  test(`editor combinations resolve focused properties and palette view commands ${base}`, async ({
    page,
  }) => {
    await prepare(page, base);
    const main = page.getByRole('main', { name: 'Video editor', exact: true });
    const first = page.locator('[data-clip-id="clip-0"]');
    const second = page.locator('[data-clip-id="clip-1"]');
    const properties = page.getByRole('dialog', {
      name: 'Clip properties',
      exact: true,
    });
    await first.click();
    await second.focus();
    await page.keyboard.press('Enter');
    await expect(
      properties.getByLabel('Start (seconds)', { exact: true }),
    ).toHaveValue('3');
    await page.keyboard.press('Escape');
    await main.focus();
    await page.keyboard.press('Escape');
    await expect(
      page.locator('.timeline-clip[aria-pressed="true"]'),
    ).toHaveCount(0);
    await second.focus();
    await page.keyboard.press('Enter');
    await expect(
      properties.getByLabel('Start (seconds)', { exact: true }),
    ).toHaveValue('3');
    await page.keyboard.press('Escape');
    await main.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+g');
    await expect(
      page.getByText('Clips grouped', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Ungroup clips', exact: true }),
    ).toBeEnabled();
    await second.focus();
    await page.keyboard.press('Enter');
    await expect(
      properties.getByLabel('Start (seconds)', { exact: true }),
    ).toHaveValue('3');
    await page.keyboard.press('Escape');
    const timeline = page.locator('.timeline-viewport');
    const width = () => timeline.evaluate((e) => e.scrollWidth);
    const initial = await width();
    const run = async (label: string) => {
      await main.focus();
      await page.keyboard.press('ControlOrMeta+k');
      await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
      await page.getByRole('option', { name: label, exact: false }).click();
      await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    };
    await run('Zoom timeline in');
    await expect.poll(width).toBeGreaterThan(initial);
    const zoomed = await width();
    await run('Zoom timeline out');
    await expect.poll(width).toBeLessThan(zoomed);
    await run('Zoom timeline in');
    const box = (await timeline.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 18);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(box.x + box.width / 2 - 40, box.y + 18);
    await page.mouse.up({ button: 'middle' });
    await expect
      .poll(() => timeline.evaluate((e) => e.scrollLeft))
      .toBeGreaterThan(0);
    await run('Fit timeline');
    await expect.poll(width).toBe(initial);
    await expect.poll(() => timeline.evaluate((e) => e.scrollLeft)).toBe(0);
  });

  test(`editor combinations nudge preserves overlapping native frame layers ${base}`, async ({
    page,
  }) => {
    const id = await prepare(page, base, true);
    const pixel = () =>
      page.evaluate(
        async ({ base, id }) => {
          const { createEditor } = (await import(
            base + 'editor.js'
          )) as typeof import('../../src/editor');
          const editor = await createEditor();
          try {
            const frame = await editor.preview.frame(id, 500_000, {
              width: 128,
              height: 72,
            }).completion;
            const canvas = new OffscreenCanvas(128, 72);
            const context = canvas.getContext('2d')!;
            context.drawImage(frame.image, 0, 0);
            frame.image.close();
            return [...context.getImageData(64, 36, 1, 1).data];
          } finally {
            await editor.dispose();
          }
        },
        { base, id },
      );
    expect(await pixel()).toEqual([255, 0, 0, 255]);
    // The upper overlapping clip covers the lower clip's mouse target.
    await page.locator('[data-clip-id="clip-0"]').focus();
    await page.keyboard.press('Space');
    await page.getByRole('main', { name: 'Video editor', exact: true }).focus();
    await page.keyboard.press('Alt+ArrowRight');
    await expect
      .poll(
        async () =>
          (await snapshot(page, base, id)).tracks[0]!.clips.find(
            (c) => c.id === 'clip-0',
          )!.startUs,
      )
      .toBe(33333);
    expect(
      (await snapshot(page, base, id)).tracks[0]!.clips.map((c) => c.id),
    ).toEqual(['clip-0', 'clip-1']);
    // Await a fresh native frame from the persisted revision, not a stale canvas.
    expect(await pixel()).toEqual([255, 0, 0, 255]);
  });

  test(`editor combinations clipboard, nudge, trim, boundary and ripple are persisted ${base}`, async ({
    page,
  }) => {
    const id = await prepare(page, base),
      main = page.getByRole('main', { name: 'Video editor', exact: true });
    const clips = async () =>
      (await snapshot(page, base, id)).tracks.flatMap((t) => t.clips);
    await main.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await expect(
      page.locator('.timeline-clip[aria-pressed="true"]'),
    ).toHaveCount(2);
    await page.keyboard.press('ControlOrMeta+c');
    await page.keyboard.press('ControlOrMeta+x');
    await expect.poll(async () => (await clips()).length).toBe(0);
    await main.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ControlOrMeta+v');
    await expect.poll(async () => (await clips()).length).toBe(2);
    expect((await clips()).map((c) => c.id)).not.toContain('clip-0');
    await main.focus();
    await page.keyboard.press('Alt+ArrowRight');
    await expect
      .poll(async () =>
        (await clips()).map((c) => c.startUs).sort((a, b) => a - b),
      )
      .toEqual([33333, 3033333]);
    await main.focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect
      .poll(async () =>
        (await clips()).map((c) => c.startUs).sort((a, b) => a - b),
      )
      .toEqual([0, 3_000_000]);
    await main.focus();
    await page.keyboard.press('Escape');
    await expect(
      page.locator('.timeline-clip[aria-pressed="true"]'),
    ).toHaveCount(0);
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await expect(
      page.getByRole('slider', { name: 'Playhead position' }),
    ).toHaveValue('1000000');
    await page.keyboard.press('ArrowDown');
    await expect(
      page.getByRole('slider', { name: 'Playhead position' }),
    ).toHaveValue('3000000');
    await page.keyboard.press('ArrowUp');
    await expect(
      page.getByRole('slider', { name: 'Playhead position' }),
    ).toHaveValue('1000000');
    await page.locator('.timeline-clip').first().click();
    await main.focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('w');
    await expect
      .poll(
        async () => (await clips()).find((c) => c.startUs === 0)?.durationUs,
      )
      .toBe(500_000);
    await page.locator('.timeline-clip').first().click();
    await main.focus();
    await page.keyboard.press('Shift+Delete');
    await expect.poll(async () => (await clips()).length).toBe(1);
    expect((await clips())[0]!.startUs).toBe(2_500_000);
    await main.focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await clips()).length).toBe(2);
    await page.locator('.timeline-clip').first().dblclick();
    await expect(
      page.getByRole('dialog', { name: 'Clip properties', exact: true }),
    ).toBeVisible();
    const before = (await snapshot(page, base, id)).revision;
    await page.keyboard.press('ControlOrMeta+x');
    await page.keyboard.press('Shift+Delete');
    expect((await snapshot(page, base, id)).revision).toBe(before);
    await page.keyboard.press('Escape');
    await page.locator('.timeline-clip').first().focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('dialog', { name: 'Clip properties', exact: true }),
    ).toBeVisible();
  });
}
