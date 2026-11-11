import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Project } from '../../src/editor';

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
    page.getByRole('button', { name: 'Add text', exact: true }),
  ).toBeEnabled();
}
async function snapshot(page: Page, name: string): Promise<Project> {
  return page.evaluate(async (name) => {
    const { createEditor } = (await import(
      String('/LocalCut/editor.js')
    )) as typeof import('../../src/editor');
    const engine = await createEditor();
    try {
      const project = (await engine.projects.list()).find(
        (project) => project.name === name,
      );
      if (!project) throw new Error('Expected persisted UI project');
      return project;
    } finally {
      await engine.dispose();
    }
  }, name);
}

test('stale property forms reject before overwriting a concurrent engine edit and can retry fresh', async ({
  page,
}) => {
  // Keep only the external instance's notification from reaching the workspace.
  // The writes below still use the production engine and real IndexedDB commits.
  await page.addInitScript(() => {
    const control = { hold: false, suppressed: 0 };
    Object.defineProperty(window, '__propertyBroadcastControl', {
      value: control,
    });
    const original = BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage = function (message: unknown) {
      if (this.name === 'localcut-projects' && control.hold) {
        control.suppressed++;
        return;
      }
      original.call(this, message);
    };
  });
  await page.goto('/LocalCut/');
  const name = 'Property revision conflict';
  await createProject(page, name);
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await page
    .getByRole('button', { name: 'Insert Plain text', exact: true })
    .click();
  const form = page.getByRole('dialog', {
    name: 'Clip properties',
    exact: true,
  });
  await expect(form).toBeVisible();
  await expect(form.getByLabel('Gain', { exact: true })).toHaveValue('1');
  const initial = await snapshot(page, name);
  expect(initial.revision).toBe(1);
  const clipId = initial.tracks[0]!.clips[0]!.id;
  const external = await page.evaluate(
    async ({ name, clipId }) => {
      const control = (
        window as unknown as {
          __propertyBroadcastControl: { hold: boolean; suppressed: number };
        }
      ).__propertyBroadcastControl;
      control.hold = true;
      const { createEditor } = (await import(
        String('/LocalCut/editor.js')
      )) as typeof import('../../src/editor');
      const other = await createEditor();
      try {
        const project = (await other.projects.list()).find(
          (project) => project.name === name,
        )!;
        await other.commands.apply({
          projectId: project.id,
          expectedRevision: project.revision,
          requestId: crypto.randomUUID(),
          operations: [{ type: 'updateClip', clipId, patch: { gain: 0.25 } }],
        });
        return {
          snapshot: await other.projects.snapshot(project.id),
          suppressed: control.suppressed,
        };
      } finally {
        await other.dispose();
      }
    },
    { name, clipId },
  );
  expect(external.snapshot.revision).toBe(2);
  expect(external.snapshot.tracks[0]!.clips[0]!.gain).toBe(0.25);
  expect(external.suppressed).toBeGreaterThan(0);
  // Verify the old rendered form is truly stale before submitting it.
  await expect(form.getByLabel('Gain', { exact: true })).toHaveValue('1');
  await form.getByLabel('Start (seconds)', { exact: true }).fill('0.1');
  await form
    .getByRole('button', { name: 'Apply properties', exact: true })
    .click();
  const conflict = page.getByText(
    'Project changed. Review the latest values and try again.',
    { exact: true },
  );
  await expect
    .poll(
      async () =>
        (await conflict.isVisible()) ||
        (await snapshot(page, name)).revision !== 2,
    )
    .toBe(true);
  const rejected = await snapshot(page, name);
  expect(rejected.revision).toBe(2);
  expect(rejected.tracks[0]!.clips[0]!).toMatchObject({
    gain: 0.25,
    startUs: 0,
  });
  await expect(conflict).toBeVisible();
  await expect(form).toBeVisible();
  await expect(form.getByLabel('Gain', { exact: true })).toHaveValue('0.25');
  await expect(form.getByLabel('Start (seconds)', { exact: true })).toHaveValue(
    '0',
  );
  await page.evaluate(() => {
    (
      window as unknown as { __propertyBroadcastControl: { hold: boolean } }
    ).__propertyBroadcastControl.hold = false;
  });
  await form.getByLabel('Start (seconds)', { exact: true }).fill('0.1');
  await form
    .getByRole('button', { name: 'Apply properties', exact: true })
    .click();
  await expect.poll(async () => (await snapshot(page, name)).revision).toBe(3);
  const retried = await snapshot(page, name);
  expect(retried.tracks[0]!.clips[0]!).toMatchObject({
    gain: 0.25,
    startUs: 100000,
  });
});
