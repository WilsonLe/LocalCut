import { expect, test } from '@playwright/test';

for (const base of ['/', '/LocalCut/']) {
  test(`deployment recovery preserves saved projects and requires explicit reload ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const id = await page.evaluate(async (base) => {
      const { createEditor } = await import(base + 'editor.js');
      const editor = await createEditor();
      try {
        localStorage.setItem('test-release-preserve', 'keep');
        return (await editor.projects.create('Survives deployment')).id;
      } finally {
        await editor.dispose();
      }
    }, base);
    await page.route(`**${base}assets/editor-*.js`, (route) =>
      route.fulfill({ status: 404, body: 'Removed old chunk' }),
    );
    const projectUrl = `${base}?view=retained#/project/${id}`;
    await page.goto(projectUrl);
    const recovery = page.getByRole('alert', { name: 'Workspace recovery' });
    await expect(recovery).toContainText('Part of LocalCut could not load');
    await expect(
      recovery.getByRole('button', { name: 'Reload LocalCut' }),
    ).toBeFocused();
    await recovery.getByRole('button', { name: 'Dismiss' }).click();
    await expect(recovery).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe(`#/project/${id}`);
    // Repeated failures give an explicit recovery action, never an auto-reload loop.
    await page.reload();
    await expect(recovery).toBeVisible();
    const [freshHtml] = await Promise.all([
      page.waitForRequest(
        (request) =>
          request.isNavigationRequest() &&
          new URL(request.url()).searchParams.has('_localcut_reload'),
      ),
      page.waitForEvent('domcontentloaded'),
      recovery.getByRole('button', { name: 'Reload LocalCut' }).click(),
    ]);
    expect(new URL(freshHtml.url()).searchParams.get('view')).toBe('retained');
    await expect(recovery).toBeVisible();
    await expect.poll(() => new URL(page.url()).search).toBe('?view=retained');
    await page.unroute(`**${base}assets/editor-*.js`);
    await recovery.getByRole('button', { name: 'Reload LocalCut' }).click();
    await expect(
      page.getByRole('button', { name: 'Open project', exact: true }),
    ).toContainText('Survives deployment');
    await expect(recovery).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe(`#/project/${id}`);
    expect(
      await page.evaluate(() => localStorage.getItem('test-release-preserve')),
    ).toBe('keep');
  });

  test(`missing optional UI chunk has an eager usable recovery screen ${base}`, async ({
    page,
  }) => {
    await page.route(`**${base}assets/AppearancePanel-*.js`, (route) =>
      route.fulfill({ status: 404, body: 'Removed old panel' }),
    );
    await page.goto(base);
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'Appearance', exact: true })
      .click();
    const recovery = page.getByRole('alert', { name: 'Workspace recovery' });
    await expect(recovery).toContainText('LocalCut could not open this screen');
    await page.unroute(`**${base}assets/AppearancePanel-*.js`);
    await recovery.getByRole('button', { name: 'Reload LocalCut' }).click();
    await expect(
      page.getByRole('button', { name: 'Workspace settings', exact: true }),
    ).toBeVisible();
    await expect(recovery).toHaveCount(0);
  });

  test(`headless discovery bypasses stale compatibility aliases and returns one release ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const aliases: string[] = [];
    await page.route(/\/(ai|editor)\.js$/, (route) => {
      aliases.push(route.request().url());
      return route.fulfill({
        contentType: 'text/javascript',
        body: "throw new Error('stale public alias')",
      });
    });
    await page.route(`**${base}modules.json`, (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: '{"modules":{"editor":"removed.js"}}',
      }),
    );
    const result = await page.evaluate(async (base) => {
      const url = new URL(base + 'modules.json', location.href);
      url.searchParams.set('fresh', crypto.randomUUID());
      const response = await fetch(url, { cache: 'no-store' });
      const release = await response.json();
      const [editor, ai] = await Promise.all([
        import(new URL(release.modules.editor, url).href),
        import(new URL(release.modules.ai, url).href),
      ]);
      return {
        release,
        editor: typeof editor.createEditor,
        ai: typeof ai.createOpenRouter,
      };
    }, base);
    expect(result.editor).toBe('function');
    expect(result.ai).toBe('function');
    expect(result.release.version).toBe(1);
    expect(result.release.release).toMatch(/^[a-f0-9]{64}$/);
    expect(result.release.modules.editor).toMatch(/^assets\/editor-[^/]+\.js$/);
    expect(result.release.modules.ai).toMatch(/^assets\/ai-[^/]+\.js$/);
    expect(aliases).toEqual([]);
  });
}
