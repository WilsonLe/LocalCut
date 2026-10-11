import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

for (const base of ['/', '/LocalCut/']) {
  test(`header check for update preserves projects and handles deployment states ${base}`, async ({
    page,
  }, testInfo) => {
    const directory = base === '/' ? 'dist-root' : 'dist';
    const current = JSON.parse(
      readFileSync(`${directory}/build-info.json`, 'utf8'),
    ) as { commit: string; ancestors: string[] };
    expect(current.commit).toMatch(/^[a-f0-9]{40}$/);
    const later = {
      version: 1,
      commit: 'a'.repeat(40),
      ancestors: [current.commit, ...current.ancestors],
    };
    let body: unknown = { ...current, version: 1 };
    let failure = false;
    let requests = 0;
    let release: (() => void) | undefined;
    let delay: Promise<void> | undefined;
    const urls: string[] = [];
    await page.route(/\/build-info\.json\?/, async (route) => {
      requests++;
      urls.push(route.request().url());
      await delay;
      if (failure) await route.abort('internetdisconnected');
      else await route.fulfill({ json: body });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base);
    const check = page.getByRole('button', {
      name: 'Check for update',
      exact: true,
    });
    await expect(check).toBeVisible();
    expect(requests).toBe(0);
    // The lazy tooltip replaces its fallback trigger during startup. Sample
    // the final layout instead of assuming a previous visibility check pins it.
    await expect
      .poll(async () => {
        const checkBox = await check.boundingBox();
        const commandsBox = await page
          .getByRole('button', { name: 'Commands', exact: true })
          .boundingBox();
        return (
          !!checkBox &&
          !!commandsBox &&
          checkBox.x > 1200 &&
          checkBox.x + checkBox.width < commandsBox.x
        );
      })
      .toBe(true);

    await test.step('pending feedback, current and older commits', async () => {
      delay = new Promise<void>((resolve) => {
        release = resolve;
      });
      await check.click();
      await expect(check).toBeDisabled();
      await expect(check).toHaveAttribute('aria-busy', 'true');
      await check.evaluate((button: HTMLButtonElement) => button.click());
      expect(requests).toBe(1);
      release!();
      delay = undefined;
      await expect(
        page.getByText('LocalCut is up to date', { exact: true }).last(),
      ).toBeVisible();
      await expect(check).toBeEnabled();
      for (const commit of [current.ancestors[0]!, 'b'.repeat(40)]) {
        body = { version: 1, commit, ancestors: [] };
        await check.click();
        await expect(check).toHaveAttribute('aria-busy', 'false');
        await expect(
          page.getByRole('dialog', { name: 'Update available' }),
        ).toHaveCount(0);
      }
    });

    await test.step('offline and malformed metadata allow retry', async () => {
      failure = true;
      await check.click();
      await expect(
        page
          .getByText(
            'Could not check for updates. Check your connection and try again.',
            { exact: true },
          )
          .last(),
      ).toBeVisible();
      await expect(check).toBeEnabled();
      failure = false;
      body = { version: 1, commit: 'invalid', ancestors: [current.commit] };
      await check.click();
      await expect(check).toHaveAttribute('aria-busy', 'false');
      await expect(
        page.getByRole('dialog', { name: 'Update available' }),
      ).toHaveCount(0);
    });

    const projectId = await page.evaluate(async (base) => {
      const { createEditor } = await import(`${base}editor.js`);
      const editor = await createEditor();
      try {
        const project = await editor.projects.create('Keep through update');
        return project.id;
      } finally {
        await editor.dispose();
      }
    }, base);
    await page.evaluate((id) => {
      window.location.hash = `/project/${id}`;
    }, projectId);
    await expect(
      page.getByRole('button', { name: 'Open project', exact: true }),
    ).toContainText('Keep through update');
    body = later;
    await check.click();
    const dialog = page.getByRole('dialog', { name: 'Update available' });
    await expect(dialog).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('update-prompt-desktop.png'),
    });
    await dialog.getByRole('button', { name: 'Later', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`#/project/${projectId}$`));
    await expect(check).toBeFocused();

    await test.step('mobile control and explicit update retain route and saved project', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(check).toBeVisible();
      delay = new Promise<void>((resolve) => {
        release = resolve;
      });
      await check.click();
      await expect(check).toHaveAttribute('aria-busy', 'true');
      await page
        .getByRole('navigation', { name: 'Workspace sections' })
        .getByRole('button', { name: 'Chat', exact: true })
        .click();
      release!();
      delay = undefined;
      await expect(dialog).toHaveCount(0);
      await page
        .getByRole('navigation', { name: 'Workspace sections' })
        .getByRole('button', { name: 'Edit', exact: true })
        .click();
      await expect(check).toHaveAttribute('aria-busy', 'false');
      await check.click();
      await expect(dialog).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath('update-prompt-mobile.png'),
      });
      const navigation = page.waitForRequest(
        (request) =>
          request.isNavigationRequest() &&
          request.url().includes('_localcut_reload='),
      );
      await dialog
        .getByRole('button', { name: 'Update now', exact: true })
        .click();
      const request = await navigation;
      expect(new URL(request.url()).pathname).toBe(base);
      await expect(
        page.getByRole('button', { name: 'Open project', exact: true }),
      ).toContainText('Keep through update');
      await expect(page).toHaveURL(new RegExp(`#/project/${projectId}$`));
      expect(
        await page.evaluate(() =>
          new URL(location.href).searchParams.has('_localcut_reload'),
        ),
      ).toBe(false);
    });
    expect(new Set(urls).size).toBe(urls.length);
    expect(
      urls.every((url) => new URL(url).pathname === `${base}build-info.json`),
    ).toBe(true);
  });
}
