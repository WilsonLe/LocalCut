import { expect, test } from '@playwright/test';
for (const base of ['/', '/LocalCut/']) {
  test(`project version browsing recreates the read-only editor at ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
    await page
      .getByRole('menuitem', { name: 'New project', exact: true })
      .click();
    await page.getByLabel('Project name').fill('Version journey');
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.getByRole('button', { name: 'Add text', exact: true }).click();
    await page.getByLabel('Text', { exact: true }).fill('First state');
    await page.getByRole('button', { name: 'Apply properties' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    // Explicit browsing flushes the pending debounce before listing versions.
    await page.getByRole('button', { name: 'Versions', exact: true }).click();
    const firstVersionLabel = await page
      .getByRole('group', { name: 'Saved versions' })
      .getByRole('button')
      .first()
      .innerText();
    await page
      .getByRole('button', { name: firstVersionLabel, exact: true })
      .click();
    const timeline = page.getByRole('region', { name: 'Video timeline' });
    await expect(
      timeline.getByRole('button', { name: 'First state', exact: true }),
    ).toBeVisible();
    await expect(
      timeline.getByRole('button', { name: 'Undo', exact: true }),
    ).toHaveCount(0);
    await expect(
      timeline.getByRole('button', { name: 'Add text', exact: true }),
    ).toHaveCount(0);
    await timeline
      .getByRole('button', { name: 'First state', exact: true })
      .click();
    await page.getByRole('main', { name: 'Video editor' }).focus();
    for (const key of [
      't',
      'd',
      'Delete',
      'ControlOrMeta+z',
      'ControlOrMeta+Shift+z',
    ])
      await page.keyboard.press(key);
    await timeline
      .getByRole('button', { name: 'Clip properties', exact: true })
      .click();
    await expect(page.getByLabel('Text', { exact: true })).toHaveAttribute(
      'readonly',
      '',
    );
    await expect(
      page.getByRole('button', { name: 'Apply properties' }),
    ).not.toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByLabel('Playhead position').fill('500000');
    await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const engine = await createEditor();
      try {
        const project = (await engine.projects.list()).find(
          (p) => p.name === 'Version journey',
        )!;
        await engine.commands.apply({
          projectId: project.id,
          expectedRevision: project.revision,
          requestId: 'concurrent-trim',
          operations: [
            {
              type: 'updateClip',
              clipId: project.tracks[0]!.clips[0]!.id,
              patch: { durationUs: 100000 },
            },
          ],
        });
      } finally {
        await engine.dispose();
      }
    }, base);
    // A live update must not clamp the historical playhead to the current duration.
    await expect(page.getByLabel('Playhead position')).toHaveValue('500000');
    await page
      .getByRole('button', { name: 'Play preview', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Pause preview', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Pause preview', exact: true })
      .click();
    await page.locator('.editing-content').evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({
      path: `test-results/version-preview-${base === '/' ? 'root' : 'pages'}.png`,
      fullPage: true,
    });
    await page
      .getByRole('button', { name: 'Return to current', exact: true })
      .click();
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await timeline
      .getByRole('button', { name: 'First state', exact: true })
      .click();
    await timeline
      .getByRole('button', { name: 'Clip properties', exact: true })
      .click();
    await page.getByLabel('Text', { exact: true }).fill('Second state');
    await page.getByRole('button', { name: 'Apply properties' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await page
      .getByRole('button', { name: firstVersionLabel, exact: true })
      .click();
    await expect(
      timeline.getByRole('button', { name: 'First state', exact: true }),
    ).toBeVisible();
    await expect(
      timeline.getByRole('button', { name: 'Second state', exact: true }),
    ).not.toBeVisible();
    // Re-entering through an already-open history button checkpoints the edit,
    // even though the one-second autosave clock has not advanced.
    const checkpointedText = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const engine = await createEditor();
      try {
        const project = (await engine.projects.list()).find(
          (p) => p.name === 'Version journey',
        )!;
        const versions = await engine.projects.versions.list(project.id);
        const latest = await engine.projects.versions.snapshot(
          project.id,
          versions[0]!.id,
        );
        return latest.project.tracks[0]!.clips[0]!.text!.text;
      } finally {
        await engine.dispose();
      }
    }, base);
    expect(checkpointedText).toBe('Second state');
    await page.clock.resume();
    await page
      .getByRole('button', { name: 'Restore as new version', exact: true })
      .click();
    await expect(
      timeline.getByRole('button', { name: 'First state', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Version \d+ ·.*Restored/ }),
    ).toBeVisible();
    await page
      .getByRole('group', { name: 'Saved versions' })
      .getByRole('button')
      .nth(1)
      .click();
    await expect(
      timeline.getByRole('button', { name: 'Second state', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Return to current', exact: true })
      .click();
    await page.reload();
    await page
      .getByRole('button', { name: 'Open project', exact: true })
      .click();
    await page.getByRole('button', { name: /Version journey/ }).click();
    await page.getByRole('button', { name: 'Versions', exact: true }).click();
    await expect(
      page.getByRole('button', { name: /Version \d+ ·.*Restored/ }),
    ).toBeVisible();
    await page.getByRole('button', { name: /Version 1 ·/ }).click();
    await expect(
      page.getByRole('heading', { name: 'Empty timeline', exact: true }),
    ).toBeVisible();
    await expect(
      timeline.getByRole('button', { name: 'First state', exact: true }),
    ).not.toBeVisible();
    await expect(
      page
        .locator('.empty-preview')
        .getByRole('button', { name: 'Import media', exact: true }),
    ).not.toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: `test-results/version-browser-${base === '/' ? 'root' : 'pages'}.png`,
      fullPage: true,
    });
  });
}
