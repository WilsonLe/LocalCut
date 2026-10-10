import { expect, test } from '@playwright/test';

for (const base of ['/', '/LocalCut/']) {
  test(`cached projects render during refresh and reconcile current storage ${base}`, async ({
    page,
  }, testInfo) => {
    await page.goto(base);
    const ids = await page.evaluate(async (base) => {
      const { createEditor } = await import(`${base}editor.js`);
      const editor = await createEditor();
      try {
        const keep = await editor.projects.create('Keep film');
        const remove = await editor.projects.create('Removed film');
        return { keep: keep.id, remove: remove.id };
      } finally {
        await editor.dispose();
      }
    }, base);
    await page
      .getByRole('button', { name: 'Open project', exact: true })
      .click();
    const browser = page.getByRole('main', { name: 'Projects', exact: true });
    await expect(
      browser.getByRole('button', { name: /Removed film/ }),
    ).toBeEnabled();
    const cached = await page.evaluate(() =>
      localStorage.getItem('localcut.project-catalog.v1'),
    );
    await page.evaluate(
      async ({ base, ids }) => {
        const { createEditor } = await import(`${base}editor.js`);
        const editor = await createEditor();
        try {
          await editor.projects.delete(ids.remove);
          await editor.projects.create('Fresh film');
        } finally {
          await editor.dispose();
        }
      },
      { base, ids },
    );
    await expect(
      browser.getByRole('button', { name: /Fresh film/ }),
    ).toBeVisible();
    await page.evaluate(
      (cached) => localStorage.setItem('localcut.project-catalog.v1', cached!),
      cached,
    );
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**${base}editor.js`, async (route) => {
      await held;
      await route.continue();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(
      browser.getByRole('button', { name: /Removed film/ }),
    ).toBeEnabled();
    await expect(browser).toHaveAttribute('aria-busy', 'true');
    await browser
      .getByRole('textbox', { name: 'Search projects' })
      .fill('film');
    await expect(browser.getByRole('listitem')).toHaveCount(2);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath('cached-projects-refresh.png'),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    release();
    await expect(
      browser.getByRole('button', { name: /Fresh film/ }),
    ).toBeEnabled();
    await expect(
      browser.getByRole('button', { name: /Removed film/ }),
    ).toHaveCount(0);
    await expect(
      browser.getByRole('textbox', { name: 'Search projects' }),
    ).toHaveValue('film');
    await expect(browser).toHaveAttribute('aria-busy', 'false');
    await browser.getByRole('button', { name: /Keep film/ }).click();
    await expect(
      page.getByRole('button', { name: 'Open project', exact: true }),
    ).toContainText('Keep film');
    expect(new URL(page.url()).hash).toContain(ids.keep);
  });

  test(`loading skeletons and cached failure retry remain usable ${base}`, async ({
    page,
  }, testInfo) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**${base}editor.js`, async (route) => {
      await held;
      await route.continue();
    });
    await page.goto(`${base}#/projects`);
    const browser = page.getByRole('main', { name: 'Projects', exact: true });
    const skeleton = browser.locator('.project-list-skeleton');
    await expect(skeleton).toBeVisible();
    expect(
      await skeleton
        .locator('.loading-placeholder')
        .first()
        .evaluate((element) => getComputedStyle(element).animationName),
    ).toBe('none');
    await page.screenshot({
      path: testInfo.outputPath('cold-projects-skeleton.png'),
      fullPage: true,
    });
    release();
    await expect(
      browser.getByText('No saved projects yet', { exact: true }),
    ).toBeVisible();
    await page.unroute(`**${base}editor.js`);
    await page.evaluate(() =>
      localStorage.setItem(
        'localcut.project-catalog.v1',
        JSON.stringify({
          version: 1,
          projects: [
            {
              id: 'missing-cached-id',
              name: 'Cached film',
              clipCount: 3,
              durationUs: 5000000,
            },
          ],
        }),
      ),
    );
    await page.addInitScript(() => {
      const open = indexedDB.open.bind(indexedDB);
      let first = true;
      indexedDB.open = ((...args: Parameters<typeof indexedDB.open>) => {
        if (first) {
          first = false;
          throw new Error('Storage temporarily unavailable');
        }
        return open(...args);
      }) as typeof indexedDB.open;
    });
    await page.reload();
    await expect(page.locator('[data-sonner-toast]')).toContainText(
      'Storage temporarily unavailable',
    );
    await expect(
      browser.getByRole('button', { name: /Cached film/ }),
    ).toBeEnabled();
    await expect(browser).toHaveAttribute('aria-busy', 'false');
    await browser.getByRole('button', { name: 'Refresh projects' }).click();
    await expect(
      browser.getByText('No saved projects yet', { exact: true }),
    ).toBeVisible();
    await expect(
      browser.getByRole('button', { name: /Cached film/ }),
    ).toHaveCount(0);
    // A stale cached ID can never become an editable project.
    await page.goto(`${base}#/project/missing-cached-id`);
    await expect(page.getByRole('alert')).toContainText(
      'unavailable in this browser',
    );
    await page.getByRole('button', { name: 'Open saved projects' }).click();
    await expect(
      browser.getByText('No saved projects yet', { exact: true }),
    ).toBeVisible();
  });
}
