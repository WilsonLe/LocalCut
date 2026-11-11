import { behaviorBases } from './coverage-bases';
import { expect, test } from '@playwright/test';

import type { Page } from '@playwright/test';
import { openVersions } from './workspace-settings-helper';
import type { Project } from '../../src/editor';
async function snapshot(
  page: Page,
  base: string,
  id: string,
): Promise<Project> {
  return page.evaluate(
    async ({ id }) => {
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
for (const base of behaviorBases) {
  test(`track menu operations, locked edits, stale forms and saved history @journey ${base}`, async ({
    page,
  }, testInfo) => {
    await page.goto(base);
    const id = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const p = await editor.projects.create('Track menu', {
          width: 128,
          height: 72,
        });
        await editor.commands.apply({
          projectId: p.id,
          expectedRevision: 0,
          requestId: 'setup',
          operations: [
            {
              type: 'addTrack',
              track: {
                id: 'v',
                kind: 'video',
                name: 'Footage',
                clips: [
                  {
                    id: 'clip',
                    kind: 'text',
                    startUs: 0,
                    durationUs: 1000000,
                    text: { text: 'Title' },
                    width: 128,
                    height: 72,
                  },
                ],
              },
            },
            {
              type: 'addTrack',
              track: { id: 'a', kind: 'audio', name: 'Music' },
            },
            {
              type: 'addTrack',
              track: { id: 'o', kind: 'overlay', name: 'Titles' },
            },
          ],
        });
        return p.id;
      } finally {
        await editor.dispose();
      }
    }, base);
    await page.goto(`${base}#/project/${id}`);
    const p = () => snapshot(page, base, id);
    const menuButton = (name: string) =>
      page.getByRole('button', { name: `Track menu: ${name}`, exact: true });
    const choose = async (name: string, action: string) => {
      await menuButton(name).click();
      await page.getByRole('menuitem', { name: action, exact: true }).click();
    };
    await test.step('keyboard rename and compact desktop menu', async () => {
      await menuButton('Footage').focus();
      await page.keyboard.press('Enter');
      await expect(
        page.getByRole('menu', { name: 'Track menu: Footage' }),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath('track-menu-desktop.png'),
      });
      await page
        .getByRole('menuitem', { name: 'Rename track', exact: true })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Rename track' });
      await dialog
        .getByLabel('Track name', { exact: true })
        .fill('Main footage');
      await dialog.getByRole('button', { name: 'Save name' }).click();
      await expect(menuButton('Main footage')).toBeVisible();
      await expect(menuButton('Main footage')).toBeFocused();
      expect((await p()).tracks[0]!.name).toBe('Main footage');
    });
    await test.step('toggle output states and lock, retaining readable clips', async () => {
      for (const [action, field, value] of [
        ['Disable track', 'disabled', true],
        ['Enable track', 'disabled', false],
        ['Mute track', 'muted', true],
        ['Unmute track', 'muted', false],
        ['Solo track', 'solo', true],
        ['Unsolo track', 'solo', false],
        ['Lock track', 'locked', true],
      ] as const) {
        await choose('Main footage', action);
        await expect
          .poll(async () => (await p()).tracks[0]![field])
          .toBe(value);
        await expect(menuButton('Main footage')).toBeFocused();
      }
      await page.locator('[data-clip-id="clip"]').click();
      await expect(
        page.locator('[data-track-id="v"] .timeline-resize-handle'),
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Delete clip', exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole('main', { name: 'Video editor', exact: true })
        .focus();
      await page.keyboard.press('Delete');
      expect((await p()).tracks[0]!.clips).toHaveLength(1);
      await page
        .getByRole('button', { name: 'Clip properties', exact: true })
        .click();
      await expect(
        page.getByRole('dialog', { name: 'Clip properties' }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Apply properties', exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole('dialog', { name: 'Clip properties' })
        .getByRole('button', { name: 'Close', exact: true })
        .click();

      await menuButton('Main footage').click();
      await expect(
        page.getByRole('menuitem', { name: 'Delete track', exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('menuitem', { name: 'Clear track clips', exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('menuitem', { name: 'Move track down', exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole('menuitem', { name: 'Unlock track', exact: true })
        .click();
      await expect.poll(async () => (await p()).tracks[0]!.locked).toBe(false);
    });
    await test.step('duplicate, reorder, confirm clearing/deletion and undo', async () => {
      await choose('Main footage', 'Duplicate track');
      await expect(menuButton('Main footage copy')).toBeVisible();
      const copied = (await p()).tracks[1]!;
      expect(copied.clips[0]!.id).not.toBe('clip');
      await choose('Main footage copy', 'Move track down');
      await expect.poll(async () => (await p()).tracks[2]!.id).toBe(copied.id);
      await choose('Main footage copy', 'Move track up');
      await expect.poll(async () => (await p()).tracks[1]!.id).toBe(copied.id);
      await choose('Main footage copy', 'Clear track clips');
      await page
        .getByRole('dialog', { name: 'Clear track clips' })
        .getByRole('button', { name: 'Cancel', exact: true })
        .click();
      expect((await p()).tracks[1]!.clips).toHaveLength(1);
      await choose('Main footage copy', 'Clear track clips');
      await page
        .getByRole('dialog', { name: 'Clear track clips' })
        .getByRole('button', { name: 'Clear clips', exact: true })
        .click();
      await expect
        .poll(async () => (await p()).tracks[1]!.clips.length)
        .toBe(0);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect
        .poll(async () => (await p()).tracks[1]!.clips.length)
        .toBe(1);
      await choose('Main footage copy', 'Delete track');
      await page
        .getByRole('dialog', { name: 'Delete track' })
        .getByRole('button', { name: 'Delete track', exact: true })
        .click();
      await expect(menuButton('Main footage copy')).toHaveCount(0);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(menuButton('Main footage copy')).toBeVisible();
    });
    await test.step('stale rename cannot overwrite an external edit', async () => {
      await choose('Main footage', 'Rename track');
      await page.getByLabel('Track name', { exact: true }).fill('Stale name');
      await page.evaluate(
        async ({ id }) => {
          const { createEditor } = (await import(
            base + 'editor.js'
          )) as typeof import('../../src/editor');
          const editor = await createEditor();
          try {
            const p = await editor.projects.snapshot(id);
            await editor.commands.apply({
              projectId: id,
              expectedRevision: p.revision,
              requestId: 'external',
              operations: [
                {
                  type: 'updateTrack',
                  trackId: 'v',
                  patch: { name: 'External name' },
                },
              ],
            });
          } finally {
            await editor.dispose();
          }
        },
        { base, id },
      );
      await expect(page.getByRole('alert')).toContainText(
        'The project changed',
      );
      await expect(page.getByRole('button', { name: 'Save name' })).toHaveCount(
        0,
      );
      await page
        .getByRole('dialog', { name: 'Rename track' })
        .getByRole('button', { name: 'Cancel', exact: true })
        .click();
      await expect(menuButton('External name')).toBeVisible();
    });
    await test.step('reload, read-only versions and mobile menu', async () => {
      const before = await p();
      await page.reload();
      await expect(menuButton('External name')).toBeVisible();
      expect((await p()).tracks).toEqual(before.tracks);
      await openVersions(page);
      await page
        .getByRole('group', { name: 'Saved versions' })
        .getByRole('button')
        .last()
        .click();
      await expect(page.getByText(/Version \d+ · Read-only/)).toBeVisible();
      await expect(
        page.getByRole('button', { name: /^Track menu:/ }),
      ).toHaveCount(0);
      await page
        .getByRole('button', { name: 'Return to current', exact: true })
        .click();
      await expect(menuButton('External name')).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await menuButton('Titles').click();
      await expect(
        page.getByRole('menuitem', { name: 'Mute track', exact: true }),
      ).toHaveCount(0);
      const menu = page.getByRole('menu', { name: 'Track menu: Titles' });
      const box = (await menu.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      await page.screenshot({
        path: testInfo.outputPath('track-menu-mobile.png'),
      });
      await page.keyboard.press('Escape');
    });
  });
}
