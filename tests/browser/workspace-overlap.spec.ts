import { expect, test, type Page } from '@playwright/test';
import type { Project } from '../../src/editor';
import {
  openVersions,
  waitForWorkspaceSettings,
} from './workspace-settings-helper';

test.use({ hasTouch: true });

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
  test(`timeline overlap context menu shows visual spans and supports mouse keyboard touch ${base}`, async ({
    page,
  }, testInfo) => {
    await page.goto(base);
    const id = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const canvas = new OffscreenCanvas(128, 72);
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#369';
        context.fillRect(0, 0, 128, 72);
        const asset = await editor.assets.import(
          new File([await canvas.convertToBlob()], 'overlap.png', {
            type: 'image/png',
          }),
        ).completion;
        const project = await editor.projects.create('Overlap menu');
        await editor.commands.apply({
          projectId: project.id,
          expectedRevision: 0,
          requestId: 'overlap-fixture',
          operations: [
            { type: 'addTrack', track: { id: 'v', kind: 'video' } },
            ...[0, 1_000_000, 4_000_000, 5_000_000].map((startUs, index) => ({
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
    await page.getByRole('main', { name: 'Video editor', exact: true }).focus();
    await page.keyboard.press('ControlOrMeta+o');
    await page
      .getByRole('main', { name: 'Projects', exact: true })
      .getByRole('button', { name: /^Overlap menu/ })
      .click();
    const markers = page.locator('.timeline-overlap');
    await expect(markers).toHaveCount(2);
    const marker = markers.first();
    await expect(marker).toHaveText('');
    await expect(marker.locator('svg')).toHaveCount(1);
    await expect(marker).toHaveAttribute('data-transition', 'false');
    // Leave a different overlap selected. Menu edits must use the clicked pair.
    await markers.last().click();
    const before = await snapshot(page, base, id);
    await marker.click({ button: 'right' });
    const menu = page.getByRole('menu', {
      name: 'Overlap options',
      exact: true,
    });
    await expect(menu).toBeVisible();
    expect((await snapshot(page, base, id)).revision).toBe(before.revision);
    await expect(
      page.locator('.timeline-clip[aria-pressed="true"]'),
    ).toHaveCount(2);
    await page.screenshot({
      path: testInfo.outputPath('overlap-desktop-menu.png'),
    });
    await page
      .getByRole('menuitem', { name: 'Add transition', exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'Crossfade', exact: true })
      .click();
    await expect
      .poll(
        async () => (await snapshot(page, base, id)).transitions[0]?.fromClipId,
      )
      .toBe('clip-0');
    expect((await snapshot(page, base, id)).transitions[0]!.toClipId).toBe(
      'clip-1',
    );
    await expect(marker).toHaveAttribute('data-transition', 'true');
    await expect(marker).toHaveText('');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(async () => (await snapshot(page, base, id)).transitions.length)
      .toBe(0);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(marker).toHaveAttribute('data-transition', 'true');

    // Keyboard opening, selection, Escape and focus return.
    await marker.focus();
    await marker.press('Shift+F10');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();
    await expect(marker).toBeFocused();
    await marker.press('Shift+F10');
    await page
      .getByRole('menuitem', { name: 'Select overlapping clips', exact: true })
      .click();
    await expect(marker).toHaveAttribute('aria-pressed', 'true');
    await expect(markers.last()).toHaveAttribute('aria-pressed', 'false');
    await marker.click({ button: 'right' });
    await page
      .getByRole('menuitem', { name: 'Change transition', exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'Blur dissolve', exact: true })
      .click();
    await expect
      .poll(
        async () => (await snapshot(page, base, id)).transitions[0]?.templateId,
      )
      .toBe('blur-dissolve');
    const keyframes = (await snapshot(page, base, id)).tracks[0]!.clips[1]!
      .keyframes;
    await marker.click({ button: 'right' });
    await page
      .getByRole('menuitem', { name: 'Remove blend', exact: true })
      .click();
    await expect
      .poll(async () => (await snapshot(page, base, id)).transitions.length)
      .toBe(0);
    expect(
      (await snapshot(page, base, id)).tracks[0]!.clips[1]!.keyframes,
    ).toEqual(keyframes);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(
        async () => (await snapshot(page, base, id)).transitions[0]?.templateId,
      )
      .toBe('blur-dissolve');
    await page.reload();
    await expect(marker).toHaveAttribute('data-transition', 'true');

    // A changed revision freezes the open menu; locked tracks cannot edit either.
    const changeTrack = async (locked: boolean) =>
      page.evaluate(
        async ({ base, id, locked }) => {
          const { createEditor } = (await import(
            base + 'editor.js'
          )) as typeof import('../../src/editor');
          const editor = await createEditor();
          try {
            const p = await editor.projects.snapshot(id);
            await editor.commands.apply({
              projectId: id,
              expectedRevision: p.revision,
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
    await marker.click({ button: 'right' });
    await changeTrack(false);
    await expect(
      page.getByRole('menuitem', { name: 'Change transition', exact: true }),
    ).toHaveAttribute('aria-disabled', 'true');
    await expect(
      page.getByRole('menuitem', { name: 'Remove blend', exact: true }),
    ).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await changeTrack(true);
    await expect(page.locator('.timeline-track').first()).toHaveAttribute(
      'data-locked',
      'true',
    );
    await marker.click({ button: 'right' });
    await expect(
      page.getByRole('menuitem', { name: 'Change transition', exact: true }),
    ).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await changeTrack(false);
    await expect(page.locator('.timeline-track').first()).not.toHaveAttribute(
      'data-locked',
      'true',
    );

    await openVersions(page);
    await page
      .getByRole('group', { name: 'Saved versions' })
      .getByRole('button')
      .first()
      .click();
    await expect(page.getByText(/Version \d+ · Read-only/)).toBeVisible();
    await marker.click({ button: 'right' });
    await expect(
      page.getByRole('menuitem', { name: /^(Add|Change) transition$/ }),
    ).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', { name: 'Return to current', exact: true })
      .click();
    await waitForWorkspaceSettings(page);
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'Appearance', exact: true })
      .click();
    await page
      .getByRole('region', { name: 'Appearance customization' })
      .getByRole('button', { name: 'Dark', exact: true })
      .click();
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.setViewportSize({ width: 390, height: 844 });
    await marker.scrollIntoViewIfNeeded();
    const client = await page.context().newCDPSession(page);
    const bounds = (await marker.boundingBox())!;
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
    await page.screenshot({
      path: testInfo.outputPath('overlap-mobile-menu.png'),
    });
    await page
      .getByRole('menuitem', { name: 'Change transition', exact: true })
      .tap();
    await page.getByRole('menuitem', { name: 'Slide left', exact: true }).tap();
    await expect
      .poll(
        async () => (await snapshot(page, base, id)).transitions[0]?.templateId,
      )
      .toBe('slide-left');
    // Movement and cancellation before the hold threshold do not open a menu.
    await touch('touchStart');
    await touch('touchMove', point.x + 20);
    await page.waitForTimeout(600);
    await expect(menu).not.toBeVisible();
    await touch('touchEnd');
    await touch('touchStart');
    await touch('touchCancel');
    await page.waitForTimeout(600);
    await expect(menu).not.toBeVisible();
    await client.detach();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
