import { fulfillChatTitle } from './chat-title-fixture';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function seed(page: Page, base: string) {
  return page.evaluate(async (base) => {
    const { createEditor } = await import(`${base}editor.js`);
    const engine = await createEditor();
    try {
      const first = await engine.projects.create('Route first');
      const second = await engine.projects.create('Route second');
      await engine.commands.apply({
        projectId: first.id,
        expectedRevision: first.revision,
        requestId: crypto.randomUUID(),
        operations: [
          {
            type: 'addTrack',
            track: {
              id: 'saved-track',
              kind: 'overlay',
              clips: [
                {
                  id: 'saved-title',
                  kind: 'text',
                  startUs: 0,
                  durationUs: 1000000,
                  text: { text: 'Saved routed title' },
                },
              ],
            },
          },
        ],
      });
      return { first: first.id, second: second.id };
    } finally {
      await engine.dispose();
    }
  }, base);
}
const picker = (page: Page) =>
  page.getByRole('button', { name: 'Open project', exact: true });
for (const base of ['/', '/LocalCut/']) {
  test(`project routing reopens the recent project and keeps view icons in the header ${base}`, async ({
    page,
  }, info) => {
    await page.goto(base);
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
    const ids = await seed(page, base);
    await page.goto(`${base}#/project/${ids.first}`);
    await expect(picker(page)).toContainText('Route first');
    await page.goto(`${base}#/project/${ids.second}`);
    await expect(picker(page)).toContainText('Route second');
    await page.goto(base);
    await expect(picker(page)).toContainText('Route second');
    await expect(page).toHaveURL(new RegExp(`/project/${ids.second}$`));
    // Explicit catalog and project links win over the saved selection.
    await page.goto(`${base}#/projects`);
    await expect(
      page.getByRole('main', { name: 'Projects', exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/#\/projects$/);
    await page.goto(`${base}#/project/${ids.first}`);
    await expect(picker(page)).toContainText('Route first');
    const views = page.getByRole('tablist', { name: 'Project views' });
    await expect(
      page.locator('.workspace-header').getByRole('tablist'),
    ).toBeVisible();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(
        page.locator('.mobile-edit-heading').getByRole('tablist'),
      ).toBeVisible();
      await expect(views).toHaveCount(1);
      for (const name of ['Editor', 'Storyboard']) {
        const tab = views.getByRole('tab', { name, exact: true });
        await expect(tab.locator('svg')).toHaveCount(1);
        expect(await tab.textContent()).toBe('');
      }
      const heading = page.locator('.mobile-edit-heading');
      expect(
        await heading.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      const bounds = await heading.locator('button').evaluateAll((buttons) =>
        buttons.map((button) => ({
          x: button.getBoundingClientRect().x,
          right: button.getBoundingClientRect().right,
          y: button.getBoundingClientRect().y,
        })),
      );
      expect(bounds.every((b) => b.x >= 0 && b.right <= width)).toBe(true);
      expect(
        Math.max(...bounds.map((b) => b.y)) -
          Math.min(...bounds.map((b) => b.y)),
      ).toBeLessThan(3);
      await views.getByRole('tab', { name: 'Editor', exact: true }).focus();
      await page.keyboard.press('ArrowRight');
      await expect(
        views.getByRole('tab', { name: 'Storyboard', exact: true }),
      ).toBeFocused();
      await expect(
        views.getByRole('tab', { name: 'Storyboard', exact: true }),
      ).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('Home');
      await expect(
        views.getByRole('tab', { name: 'Editor', exact: true }),
      ).toBeFocused();
      await page.screenshot({
        path: info.outputPath(`header-views-${width}.png`),
        animations: 'disabled',
      });
    }
    await page.goto(base);
    await expect(picker(page)).toContainText('Route first');
    await page.evaluate(() => {
      location.hash = '/';
    });
    await expect(picker(page)).toContainText('Edit');
    await expect(page).toHaveURL(/#\/$/);
    await page.reload();
    await expect(picker(page)).toContainText('Route first');
    await page.evaluate(
      async ({ base, id }) => {
        const { createEditor } = await import(`${base}editor.js`);
        const editor = await createEditor();
        try {
          await editor.projects.delete(id);
        } finally {
          await editor.dispose();
        }
      },
      { base, id: ids.first },
    );
    await expect(page.getByRole('alert')).toContainText(
      'unavailable in this browser',
    );
    expect(
      await page.evaluate(() =>
        localStorage.getItem('localcut.recent-project.v1'),
      ),
    ).toBeNull();
    await page.goto(base);
    await expect(picker(page)).toContainText('Edit');
    await page.evaluate(() =>
      localStorage.setItem(
        'localcut.recent-project.v1',
        JSON.stringify({ version: 1, projectId: 'missing-recent-project' }),
      ),
    );
    await page.goto(base);
    await expect(page.getByRole('alert')).toContainText(
      'unavailable in this browser',
    );
    expect(
      await page.evaluate(() =>
        localStorage.getItem('localcut.recent-project.v1'),
      ),
    ).toBeNull();
    await page.goto(base);
    await expect(picker(page)).toContainText('Edit');
  });

  test(`project routing captures navigation while editor panels load ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const ids = await seed(page, base);
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/assets\/WorkspacePanels-[^/]+\.js$/, async (route) => {
      await ready;
      await route.continue();
    });
    try {
      await page.goto(`${base}?routing-startup`, {
        waitUntil: 'domcontentloaded',
      });
      await expect(picker(page)).toBeVisible();
      await expect(
        page.getByRole('status', { name: 'Loading workspace', exact: true }),
      ).toBeVisible();
      await page.evaluate((id) => {
        window.location.hash = `/project/${id}`;
      }, ids.first);
      release();
      await expect(picker(page)).toContainText('Route first');
      await expect(page).toHaveURL(new RegExp(`/project/${ids.first}$`));
    } finally {
      release();
    }
  });

  test(`project routing restores edits, history and catalog identity ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
    const ids = await seed(page, base);
    await page.goto(`${base}#/project/${ids.first}`);
    await expect(picker(page)).toContainText('Route first');
    await expect(
      page.getByRole('button', { name: 'Saved routed title', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'LocalCut home' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/projects\\?project=${ids.first}$`),
    );
    const catalog = page.getByRole('main', { name: 'Projects', exact: true });
    await catalog.getByRole('button', { name: /^Route second/ }).click();
    await expect(page).toHaveURL(new RegExp(`/project/${ids.second}$`));
    await expect(picker(page)).toContainText('Route second');
    await page.goBack();
    await expect(catalog).toBeVisible();
    await expect(
      catalog.getByRole('button', { name: /^Route first/ }),
    ).toContainText('Current');
    await page.goBack();
    await expect(picker(page)).toContainText('Route first');
    await expect(
      page.getByRole('button', { name: 'Saved routed title', exact: true }),
    ).toBeVisible();
    await page.goForward();
    await expect(catalog).toBeVisible();
    await page.reload();
    await expect(
      catalog.getByRole('button', { name: /^Route first/ }),
    ).toContainText('Current');
    await catalog
      .getByRole('button', { name: 'Back to editor', exact: true })
      .click();
    await expect(picker(page)).toContainText('Route first');
    await page.reload();
    await expect(picker(page)).toContainText('Route first');
    await expect(
      page.getByRole('button', { name: 'Saved routed title', exact: true }),
    ).toBeVisible();
    await page.goto(base);
    await expect(picker(page)).toContainText('Route first');
    await picker(page).click();
    await catalog
      .getByRole('button', { name: 'New project', exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'New project',
      exact: true,
    });
    await dialog.getByLabel('Project name').fill('Created through routing');
    await dialog
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await expect(picker(page)).toContainText('Created through routing');
    await expect(page).toHaveURL(/#\/project\/[^/]+$/);
    await page.goto(base);
    await expect(picker(page)).toContainText('Created through routing');
    await expect(page).toHaveURL(/#\/project\/[^/]+$/);
  });

  test(`project routing recovers malformed, missing and deleted projects ${base}`, async ({
    page,
  }) => {
    await page.goto(`${base}#/not-a-route`);
    await expect(page.getByRole('alert')).toHaveText(
      'This project address is not valid.',
    );
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
    await page.getByRole('button', { name: 'Open saved projects' }).click();
    const catalog = page.getByRole('main', { name: 'Projects', exact: true });
    await expect(catalog.getByText('No saved projects yet')).toBeVisible();
    const ids = await seed(page, base);
    await page.goto(`${base}#/project/unknown-project`);
    await expect(page.getByRole('alert')).toContainText(
      'unavailable in this browser',
    );
    await expect(
      page.getByRole('main', { name: 'Video editor' }),
    ).not.toBeVisible();
    await page.getByRole('button', { name: 'Open saved projects' }).click();
    await catalog.getByRole('button', { name: /^Route first/ }).click();
    await expect(picker(page)).toContainText('Route first');
    await page.evaluate(
      async ({ base, id }) => {
        const { createEditor } = await import(`${base}editor.js`);
        const engine = await createEditor();
        try {
          await engine.projects.delete(id);
        } finally {
          await engine.dispose();
        }
      },
      { base, id: ids.first },
    );
    await expect(page.getByRole('alert')).toContainText(
      'unavailable in this browser',
    );
    await page.getByRole('button', { name: 'Open saved projects' }).click();
    await catalog.getByRole('button', { name: /^Route second/ }).click();
    await expect(picker(page)).toContainText('Route second');
  });

  test(`project routing rejects superseded loads with visible pending feedback ${base}`, async ({
    page,
  }, testInfo) => {
    await page.goto(base);
    const ids = await seed(page, base);
    await page.evaluate((slowId) => {
      const pending = new WeakSet<IDBRequest>();
      const callbacks: (() => void)[] = [];
      Object.assign(window, {
        releaseRouteLoad: () =>
          callbacks.splice(0).forEach((callback) => callback()),
        routeLoadWaiting: () => callbacks.length > 0,
      });
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (key) {
        const request = get.call(this, key);
        if (key === slowId) pending.add(request);
        return request;
      };
      const add = IDBRequest.prototype.addEventListener;
      IDBRequest.prototype.addEventListener = function (
        this: IDBRequest,
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ) {
        if (!listener) return;
        if (type === 'success' && pending.has(this)) {
          const wrapped = (event: Event) =>
            callbacks.push(() =>
              typeof listener === 'function'
                ? listener.call(this, event)
                : listener.handleEvent(event),
            );
          return add.call(this, type, wrapped, options);
        }
        return add.call(this, type, listener, options);
      };
    }, ids.first);
    await page.evaluate((id) => {
      window.location.hash = `/project/${id}`;
    }, ids.first);
    await expect(page.getByRole('status')).toContainText('Opening project');
    await expect(
      page.getByRole('region', { name: 'Project navigation' }),
    ).toHaveAttribute('aria-busy', 'true');
    await expect(
      page.getByRole('main', { name: 'Video editor' }),
    ).not.toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as unknown as { routeLoadWaiting: () => boolean }
          ).routeLoadWaiting(),
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('project-routing-loading.png'),
    });
    await page.evaluate((id) => {
      window.location.hash = `/project/${id}`;
    }, ids.second);
    await expect(picker(page)).toContainText('Route second');
    await page.evaluate(async () => {
      (
        window as unknown as { releaseRouteLoad: () => void }
      ).releaseRouteLoad();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
    await expect(picker(page)).toContainText('Route second');
    await expect(page).toHaveURL(new RegExp(`/project/${ids.second}$`));
  });

  test(`project routing retries a failed local storage restore ${base}`, async ({
    page,
  }, testInfo) => {
    await page.goto(base);
    const ids = await seed(page, base);
    await page.addInitScript(() => {
      const open = indexedDB.open.bind(indexedDB);
      let fail = true;
      indexedDB.open = ((...args: Parameters<typeof indexedDB.open>) => {
        if (fail) {
          fail = false;
          throw new Error('Synthetic blocked storage');
        }
        return open(...args);
      }) as typeof indexedDB.open;
    });
    await page.goto(`${base}#/project/${ids.first}`);
    // Hash-only navigation keeps the existing document; reload installs the storage fault.
    await page.reload();
    await expect(page.getByRole('alert')).toContainText(
      'Allow browser storage',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath('project-routing-error.png'),
    });
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(picker(page)).toContainText('Route first');
    await expect(
      page.getByRole('button', { name: 'Saved routed title', exact: true }),
    ).toBeVisible();
  });

  test(`project routing enables restored chat without a setup request ${base}`, async ({
    page,
    context,
  }) => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    };
    let paid = 0;
    await context.route('https://openrouter.ai/api/v1/models', (route) =>
      route.fulfill({
        headers: cors,
        json: {
          data: [
            {
              id: 'test/routing',
              name: 'Routing model',
              context_length: 512000,
              supported_parameters: ['tools', 'tool_choice'],
            },
          ],
        },
      }),
    );
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        if (route.request().method() === 'OPTIONS')
          return route.fulfill({ headers: cors, body: '' });
        if (await fulfillChatTitle(route)) return;
        paid++;
        return route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Project restored.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
        });
      },
    );
    await page.goto(base);
    const ids = await seed(page, base);
    await page.evaluate(() => {
      localStorage.setItem(
        'localcut.openrouter-credential.v1',
        JSON.stringify({ version: 1, key: 'synthetic-routed-key' }),
      );
      localStorage.setItem(
        'localcut.workspace-preferences.v1',
        JSON.stringify({
          version: 1,
          preferences: { aiModel: 'test/routing' },
        }),
      );
    });
    await page.goto(`${base}#/project/${ids.first}`);
    // The fixture changed storage outside the app after startup. Hash-only
    // navigation keeps that document; reload to exercise credential restoration.
    await page.reload();
    const composer = page.getByRole('textbox', {
      name: 'Describe your edit',
      exact: true,
    });
    await expect(composer).toBeEnabled();
    expect(paid).toBe(0);
    await page.reload();
    await expect(composer).toBeEnabled();
    expect(paid).toBe(0);
    await composer.fill('Describe my project');
    await composer.press('Enter');
    await expect(
      page.getByRole('log', { name: 'Conversation messages' }),
    ).toContainText('Project restored.');
    expect(paid).toBe(1);
  });
}

for (const base of ['/', '/LocalCut/']) {
  test(`project switcher dialog preserves editor state and switches projects ${base}`, async ({
    page,
  }, info) => {
    await page.goto(base);
    const ids = await seed(page, base);
    await page.goto(`${base}#/project/${ids.first}`);
    const trigger = picker(page);
    await expect(trigger).toContainText('Route first');
    const editor = page.getByRole('main', {
      name: 'Video editor',
      includeHidden: true,
    });
    await editor.evaluate((element) => {
      element.dataset.switcherMount = 'preserved';
    });
    const playhead = page.getByRole('slider', { name: 'Playhead position' });
    await playhead.focus();
    await page.keyboard.press('End');
    const position = await playhead.getAttribute('aria-valuenow');
    const url = page.url();
    const historyLength = await page.evaluate(() => history.length);
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Projects', exact: true });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(url);
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    await expect(editor).toHaveAttribute('data-switcher-mount', 'preserved');
    await expect(
      dialog.getByRole('button', { name: /^Route first/ }),
    ).toContainText('Current');
    await dialog
      .getByRole('textbox', { name: 'Search projects' })
      .fill('second');
    await expect(dialog.locator('.project-browser-row')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(playhead).toHaveAttribute('aria-valuenow', position!);
    await trigger.click();
    await page.screenshot({
      path: info.outputPath('project-switcher-desktop.png'),
      animations: 'disabled',
    });
    await dialog.getByRole('button', { name: /^Route first/ }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page).toHaveURL(url);
    await page.setViewportSize({ width: 320, height: 800 });
    await trigger.click();
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath('project-switcher-mobile.png'),
      animations: 'disabled',
    });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await dialog.getByRole('button', { name: /^Route second/ }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toContainText('Route second');
    await expect(page).toHaveURL(new RegExp(`/project/${ids.second}$`));
    await page.goBack();
    await expect(trigger).toContainText('Route first');
    await expect(page).toHaveURL(url);
    await page.goForward();
    await expect(trigger).toContainText('Route second');
    await page.reload();
    await expect(trigger).toContainText('Route second');
  });
}
