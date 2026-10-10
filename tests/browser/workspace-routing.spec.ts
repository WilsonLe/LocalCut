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
  test(`project routing captures navigation while the workspace chunk loads ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const ids = await seed(page, base);
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/assets\/Workspace-[^/]+\.js$/, async (route) => {
      await ready;
      await route.continue();
    });
    try {
      await page.goto(`${base}?routing-startup`, {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.getByRole('status')).toHaveText('Loading workspace…');
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
    await picker(page).click();
    await expect(page).toHaveURL(
      new RegExp(`/projects\\?project=${ids.first}$`),
    );
    const catalog = page.getByRole('main', { name: 'Projects', exact: true });
    await catalog.getByRole('button', { name: /Route second/ }).click();
    await expect(page).toHaveURL(new RegExp(`/project/${ids.second}$`));
    await expect(picker(page)).toContainText('Route second');
    await page.goBack();
    await expect(catalog).toBeVisible();
    await expect(
      catalog.getByRole('button', { name: /Route first/ }),
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
      catalog.getByRole('button', { name: /Route first/ }),
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
    await expect(picker(page)).toContainText('Untitled project');
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
    await catalog.getByRole('button', { name: /Route first/ }).click();
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
    await catalog.getByRole('button', { name: /Route second/ }).click();
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
              context_length: 32000,
              supported_parameters: ['tools', 'tool_choice'],
            },
          ],
        },
      }),
    );
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      (route) => {
        if (route.request().method() === 'OPTIONS')
          return route.fulfill({ headers: cors, body: '' });
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
