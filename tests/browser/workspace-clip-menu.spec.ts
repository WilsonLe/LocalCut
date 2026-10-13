import { behaviorBases } from './coverage-bases';
import { expect, test, type Page } from '@playwright/test';
import type { Project } from '../../src/editor';

test.use({ hasTouch: true });

async function snapshot(
  page: Page,
  base: string,
  id: string,
): Promise<Project> {
  return page.evaluate(
    async ({ base, id }) => {
      const { createEditor } = await import(base + 'editor.js');
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

for (const base of behaviorBases) {
  test(`timeline clip action menus and property tabs retain instance drafts with mouse keyboard touch ${base}`, async ({
    page,
  }, testInfo) => {
    await page.goto(base);
    const id = await page.evaluate(async (base) => {
      const { createEditor } = await import(base + 'editor.js');
      const editor = await createEditor();
      try {
        const canvas = new OffscreenCanvas(128, 72);
        canvas.getContext('2d')!.fillRect(0, 0, 128, 72);
        const asset = await editor.assets.import(
          new File([await canvas.convertToBlob()], 'repeated.png', {
            type: 'image/png',
          }),
        ).completion;
        const project = await editor.projects.create('Clip menu');
        await editor.commands.apply({
          projectId: project.id,
          expectedRevision: 0,
          requestId: 'seed',
          operations: [
            { type: 'addTrack', track: { id: 'v', kind: 'video' } },
            ...[0, 3_000_000].map((startUs, index) => ({
              type: 'insertClip' as const,
              trackId: 'v',
              clip: {
                id: `clip-${index}`,
                kind: 'image' as const,
                assetId: asset.id,
                startUs,
                durationUs: 2_000_000,
              },
            })),
          ],
        });
        return project.id;
      } finally {
        await editor.dispose();
      }
    }, base);
    await page.goto(base + '#/project/' + id);
    const first = page.locator('[data-clip-id="clip-0"]');
    const target = page.locator('[data-clip-id="clip-1"]');
    const menu = page.getByRole('menu', { name: 'Clip actions', exact: true });
    const form = page.getByRole('dialog', {
      name: 'Clip properties',
      exact: true,
    });
    await first.click();
    const before = await snapshot(page, base, id);
    await target.click({ button: 'right' });
    await expect(menu).toBeVisible();
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    expect((await snapshot(page, base, id)).revision).toBe(before.revision);
    let releaseDialog!: () => void;
    const dialogGate = new Promise<void>((resolve) => {
      releaseDialog = resolve;
    });
    const dialogResponse = page.waitForResponse((response) =>
      /\/assets\/WorkspaceDialogs-[^/]+\.js$/.test(response.url()),
    );
    await page.route('**/assets/WorkspaceDialogs-*.js', async (route) => {
      await dialogGate;
      await route.continue();
    });
    await menu
      .getByRole('menuitem', { name: 'Properties', exact: true })
      .click();
    await expect(
      page.getByText('Opening clip properties…', { exact: true }).or(
        page.getByRole('status', {
          name: 'Loading clip properties…',
          exact: true,
        }),
      ),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(form).not.toBeVisible();
    await expect(target).toBeFocused();
    releaseDialog();
    await (await dialogResponse).finished();
    await page.unroute('**/assets/WorkspaceDialogs-*.js');
    await expect(form).not.toBeVisible();
    await target.press('Shift+F10');
    await menu
      .getByRole('menuitem', { name: 'Properties', exact: true })
      .click();
    await expect(form).toBeVisible();
    await expect(
      form.getByRole('tab', { name: 'General', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(form.getByLabel('Start (seconds)')).toHaveValue('3');
    await form.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(form).not.toBeVisible();
    await expect(target).toBeFocused();
    await target.press('Shift+F10');
    await menu
      .getByRole('menuitem', { name: 'Properties', exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await expect(form).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(form).not.toBeVisible();
    await expect(target).toBeFocused();
    await target.press('Shift+F10');
    await menu
      .getByRole('menuitem', { name: 'Properties', exact: true })
      .click();
    await expect(form.locator('summary')).toHaveCount(0);
    await form.getByLabel('Duration (seconds)').fill('3');
    const color = form.getByRole('tab', { name: 'Color', exact: true });
    await form.getByRole('tab', { name: 'General', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(color).toBeFocused();
    await color.click();
    await form.getByLabel('Color strength', { exact: true }).fill('0.6');
    await form.getByRole('tab', { name: 'Mask', exact: true }).click();
    await form
      .getByRole('combobox', { name: 'Mask shape', exact: true })
      .click();
    await page.getByRole('option', { name: 'Rectangle', exact: true }).click();
    await form.getByLabel('Mask feather (pixels)', { exact: true }).fill('4');
    await color.click();
    await expect(
      form.getByLabel('Color strength', { exact: true }),
    ).toHaveValue('0.6');
    // Invalid hidden drafts reveal their tab and receive focus instead of blocking invisibly.
    await form.getByLabel('Color strength', { exact: true }).fill('2');
    await form.getByRole('tab', { name: 'General', exact: true }).click();
    await form.getByRole('button', { name: 'Apply properties' }).click();
    await expect(color).toHaveAttribute('aria-selected', 'true');
    await expect(
      form.getByLabel('Color strength', { exact: true }),
    ).toBeFocused();
    await form.getByLabel('Color strength', { exact: true }).fill('0.6');
    await form.getByRole('tab', { name: 'General', exact: true }).click();
    await form.getByRole('tab', { name: 'Animation', exact: true }).click();
    await form.getByLabel('Base value', { exact: true }).fill('');
    await form.getByRole('tab', { name: 'General', exact: true }).click();
    await form
      .getByRole('button', { name: 'Review animation errors', exact: true })
      .click();
    await expect(form.getByLabel('Base value', { exact: true })).toBeVisible();
    await form.getByLabel('Base value', { exact: true }).fill('0');
    await form.getByRole('tab', { name: 'General', exact: true }).click();
    await expect(form.getByLabel('Duration (seconds)')).toHaveValue('3');
    await form.screenshot({
      path: testInfo.outputPath('clip-properties-tabs-desktop.png'),
    });
    await form.getByRole('button', { name: 'Apply properties' }).click();
    await expect(form).not.toBeVisible();
    const saved = await snapshot(page, base, id);
    expect(saved.tracks[0]!.clips[0]!.durationUs).toBe(2_000_000);
    expect(saved.tracks[0]!.clips[1]!).toMatchObject({
      durationUs: 3_000_000,
      colorStrength: 0.6,
      mask: { shape: 'rectangle', feather: 4 },
    });

    await target.focus();
    await target.press('Shift+F10');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();
    await expect(target).toBeFocused();
    await first.click();
    await target.click({ button: 'right' });
    await menu
      .getByRole('menuitem', { name: 'Delete clip', exact: true })
      .click();
    await expect(target).toHaveCount(0);
    expect(
      (await snapshot(page, base, id)).tracks[0]!.clips.map((c) => c.id),
    ).toEqual(['clip-0']);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(target).toBeVisible();

    await target.click({ button: 'right' });
    await menu
      .getByRole('menuitem', { name: 'Select clip', exact: true })
      .click();
    await expect(target).toHaveAttribute('aria-pressed', 'true');
    await expect(first).toHaveAttribute('aria-pressed', 'false');
    await target.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await target.click({ button: 'right' });
    await menu
      .getByRole('menuitem', { name: 'Split at playhead', exact: true })
      .click();
    await expect(page.locator('.timeline-clip[data-clip-id]')).toHaveCount(3);
    const split = (await snapshot(page, base, id)).tracks[0]!.clips;
    expect(split.find((clip) => clip.id === 'clip-0')!.durationUs).toBe(
      2_000_000,
    );
    expect(
      split
        .filter((clip) => clip.id !== 'clip-0')
        .reduce((sum, clip) => sum + clip.durationUs, 0),
    ).toBe(3_000_000);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.locator('.timeline-clip[data-clip-id]')).toHaveCount(2);

    const change = async (locked: boolean) =>
      page.evaluate(
        async ({ base, id, locked }) => {
          const { createEditor } = await import(base + 'editor.js');
          const editor = await createEditor();
          try {
            const project = await editor.projects.snapshot(id);
            await editor.commands.apply({
              projectId: id,
              expectedRevision: project.revision,
              requestId: crypto.randomUUID(),
              operations: [
                { type: 'updateTrack', trackId: 'v', patch: { locked } },
              ],
            });
            await editor.projects.versions.save(id);
          } finally {
            await editor.dispose();
          }
        },
        { base, id, locked },
      );
    await target.click({ button: 'right' });
    await change(false);
    await expect(
      menu.getByRole('menuitem', { name: 'Delete clip' }),
    ).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await change(true);
    await expect(page.locator('.timeline-track')).toHaveAttribute(
      'data-locked',
      'true',
    );
    await target.click({ button: 'right' });
    await expect(
      menu.getByRole('menuitem', { name: 'Delete clip' }),
    ).toHaveAttribute('aria-disabled', 'true');
    await menu
      .getByRole('menuitem', { name: 'Properties', exact: true })
      .click();
    await expect(form.getByLabel('Start (seconds)')).toHaveAttribute(
      'readonly',
      '',
    );
    await form.getByRole('button', { name: 'Close', exact: true }).click();
    await change(false);
    await expect(page.locator('.timeline-track')).not.toHaveAttribute(
      'data-locked',
      'true',
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await target.scrollIntoViewIfNeeded();
    const client = await page.context().newCDPSession(page);
    const bounds = (await target.boundingBox())!;
    const point = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
      id: 1,
    };
    const touch = async (
      type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
      x = point.x,
    ) =>
      client.send('Input.dispatchTouchEvent', {
        type,
        touchPoints:
          type === 'touchEnd' || type === 'touchCancel'
            ? []
            : [{ ...point, x }],
      });
    const revision = (await snapshot(page, base, id)).revision;
    await touch('touchStart');
    await expect(menu).toBeVisible();
    await touch('touchEnd');
    await expect(menu).toBeVisible();
    expect((await snapshot(page, base, id)).revision).toBe(revision);
    await page.screenshot({ path: testInfo.outputPath('clip-menu-touch.png') });
    await menu.getByRole('menuitem', { name: 'Properties', exact: true }).tap();
    await expect(form.getByLabel('Start (seconds)')).toHaveValue('3');
    await form.getByRole('tab', { name: 'Animation', exact: true }).tap();
    const box = (await form.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(390);
    expect(box.height).toBeLessThanOrEqual(844);
    await form.screenshot({
      path: testInfo.outputPath('clip-properties-tabs-mobile.png'),
    });
    await form.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(target).toBeFocused();
    await touch('touchStart');
    await touch('touchMove', point.x + 20);
    await page.waitForTimeout(600);
    await expect(menu).not.toBeVisible();
    await touch('touchCancel');
    await touch('touchStart');
    await touch('touchCancel');
    await page.waitForTimeout(600);
    await expect(menu).not.toBeVisible();
    await client.detach();
    await page.reload();
    await expect(target).toBeVisible();
    expect(
      (await snapshot(page, base, id)).tracks[0]!.clips[1]!.durationUs,
    ).toBe(3_000_000);
  });
}
