import { expect, test, type Page, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function newProjectAction(page: Page) {
  await page
    .getByRole('button', { name: 'Workspace settings', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
  return page.getByRole('menuitem', { name: 'New project', exact: true });
}
async function createProject(page: Page) {
  await (await newProjectAction(page)).click();
  await page.getByLabel('Project name', { exact: true }).fill('Dialog timing');
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Add text', exact: true }),
  ).toBeVisible();
}

async function measureOpening(page: Page, trigger: Locator) {
  await page.evaluate(() => {
    const timings = { start: 0, shell: -1, ready: -1 };
    Object.assign(window, { dialogTimings: timings });
    document.addEventListener(
      'click',
      () => {
        timings.start = performance.now();
        const observer = new MutationObserver(() => {
          const dialogs = Array.from(
            document.querySelectorAll<HTMLElement>(
              '[data-slot="dialog-content"]',
            ),
          );
          const visible = dialogs.filter(
            (dialog) => dialog.getBoundingClientRect().height > 0,
          );
          if (visible.length && timings.shell < 0)
            timings.shell = performance.now() - timings.start;
          if (
            visible.some(
              (dialog) => !dialog.hasAttribute('data-dialog-loading'),
            )
          ) {
            timings.ready = performance.now() - timings.start;
            observer.disconnect();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      },
      { once: true, capture: true },
    );
  });
  await trigger.click();
  await page.waitForFunction(
    () =>
      (window as unknown as { dialogTimings: { ready: number } }).dialogTimings
        .ready >= 0,
  );
  return page.evaluate(
    () =>
      (window as unknown as { dialogTimings: { shell: number; ready: number } })
        .dialogTimings,
  );
}

const surfaces = [
  { name: 'New project', module: 'WorkspaceDialogs', action: newProjectAction },
  {
    name: 'Notifications',
    module: 'NotificationLogDialog',
    action: async (page: Page) =>
      page.getByRole('button', { name: 'Notifications', exact: true }),
  },
  {
    name: 'Commands',
    module: 'CommandPalette',
    action: async (page: Page) =>
      page.getByRole('button', { name: 'Commands', exact: true }),
  },
  {
    name: 'AI connection',
    module: 'AIConnectionDialog',
    action: async (page: Page) => {
      await page
        .getByRole('button', { name: 'Workspace settings', exact: true })
        .click();
      return page.getByRole('menuitem', { name: 'AI settings', exact: true });
    },
  },
  {
    name: 'Projects',
    module: 'ProjectSwitcherDialog',
    project: true,
    action: async (page: Page) =>
      page.getByRole('button', { name: 'Open project', exact: true }),
  },
  {
    name: 'Task queue',
    module: 'TaskQueueDialog',
    project: true,
    action: async (page: Page) =>
      page.getByRole('button', { name: 'Task queue', exact: true }),
  },
  {
    name: 'Record screen',
    module: 'ScreenRecordingDialog',
    project: true,
    action: async (page: Page) => {
      if (
        !(await page
          .getByRole('button', { name: 'Record screen', exact: true })
          .isVisible())
      )
        await page
          .getByRole('button', { name: 'Expand media', exact: true })
          .click();
      return page.getByRole('button', { name: 'Record screen', exact: true });
    },
  },
];

for (const base of ['/', '/LocalCut/']) {
  for (const surface of surfaces) {
    test(`first dialog opening avoids the Suspense floor: ${surface.name} ${base}`, async ({
      page,
    }, info) => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const root = base === '/' ? 'dist-root' : 'dist';
      const manifest = JSON.parse(
        await readFile(`${root}/.vite/manifest.json`, 'utf8'),
      ) as Record<string, { file: string }>;
      await page.goto(base);
      if (surface.project) await createProject(page);
      const firstTrigger = await surface.action(page);
      await firstTrigger.waitFor();
      // Reproduce the audit's decisive probe: import code without rendering it.
      // React.lazy still incurred ~300 ms here; the on-demand store must not.
      const files = [
        manifest[`src/workspace/${surface.module}.tsx`]!.file,
        manifest['src/workspace/LoadingDialog.tsx']!.file,
      ];
      if (surface.name === 'Projects')
        files.push(manifest['src/workspace/ProjectManagement.tsx']!.file);
      if (surface.name === 'New project')
        files.push(manifest['src/workspace/SelectField.tsx']!.file);
      if (surface.name === 'Commands')
        files.push(manifest['src/workspace/workspace-command-list.ts']!.file);
      await page.evaluate(
        async ({ base, files }) => {
          await Promise.all(files.map((file) => import(base + file)));
        },
        { base, files },
      );
      const requested: string[] = [];
      page.on('request', (request) => requested.push(request.url()));
      const first = await measureOpening(page, firstTrigger);
      const dialog = page.getByRole('dialog', {
        name: surface.name,
        exact: true,
      });
      await expect(dialog).toBeVisible();
      expect(first.shell).toBeLessThan(250);
      expect(first.ready).toBeLessThan(250);
      expect(requested.filter((url) => /\.js(?:\?|$)/.test(url))).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      const repeat = await measureOpening(page, await surface.action(page));
      expect(repeat.ready).toBeLessThan(250);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      console.log(JSON.stringify({ base, name: surface.name, first, repeat }));
      await info.attach('dialog opening timings', {
        contentType: 'application/json',
        body: JSON.stringify({ base, name: surface.name, first, repeat }),
      });
    });
  }

  test(`dialog loading shell closes during a delayed chunk and preserves focus ${base}`, async ({
    page,
  }) => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/assets/NotificationLogDialog-*.js', async (route) => {
      await blocked;
      await route.continue();
    });
    await page.goto(base);
    const trigger = page.getByRole('button', {
      name: 'Notifications',
      exact: true,
    });
    const requested = page.waitForRequest(
      '**/assets/NotificationLogDialog-*.js',
    );
    await trigger.click();
    await requested;
    const dialog = page.getByRole('dialog', {
      name: 'Notifications',
      exact: true,
    });
    await expect(
      dialog.getByRole('status', { name: 'Loading notifications…' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    const completed = page.waitForResponse(
      '**/assets/NotificationLogDialog-*.js',
    );
    release();
    await completed;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(dialog.getByText('No notifications yet.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(trigger).toBeFocused();
  });

  test(`opening feedback stays cancellable while modal primitives download ${base}`, async ({
    page,
  }) => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    for (const path of [
      '**/assets/LoadingDialog-*.js',
      '**/assets/NotificationLogDialog-*.js',
    ]) {
      await page.route(path, async (route) => {
        await blocked;
        await route.continue();
      });
    }
    await page.goto(base);
    const trigger = page.getByRole('button', {
      name: 'Notifications',
      exact: true,
    });
    await trigger.click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Opening notifications…' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('status').filter({ hasText: 'Opening notifications…' }),
    ).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(trigger).toBeFocused();
    const responses = [
      '**/assets/LoadingDialog-*.js',
      '**/assets/NotificationLogDialog-*.js',
    ].map((path) => page.waitForResponse(path));
    release();
    await Promise.all(responses);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await trigger.click();
    const dialog = page.getByRole('dialog', {
      name: 'Notifications',
      exact: true,
    });
    await expect(dialog.getByText('No notifications yet.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });

  test(`commands load metadata and UI concurrently and stay dismissed ${base}`, async ({
    page,
  }) => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const paths = [
      '**/assets/workspace-command-list-*.js',
      '**/assets/CommandPalette-*.js',
    ];
    for (const path of paths)
      await page.route(path, async (route) => {
        await blocked;
        await route.continue();
      });
    await page.goto(base);
    const trigger = page.getByRole('button', { name: 'Commands', exact: true });
    const requests = paths.map((path) => page.waitForRequest(path));
    await trigger.click();
    // Both requests must start while neither is permitted to complete.
    await Promise.all(requests);
    const dialog = page.getByRole('dialog', { name: 'Commands', exact: true });
    await expect(
      dialog.getByRole('status', { name: 'Loading commands…' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    const responses = paths.map((path) => page.waitForResponse(path));
    release();
    await Promise.all(responses);
    await trigger.click();
    const search = dialog.getByRole('combobox', {
      name: 'Search commands',
      exact: true,
    });
    await expect(search).toBeVisible();
    await expect(search).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });

  test(`simple dialogs keep heavy editors unloaded and bare startup inert ${base}`, async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.goto(base);
    await (await newProjectAction(page)).click();
    await expect(
      page.getByLabel('Project name', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('combobox', { name: 'Frame rate (fps)', exact: true }),
    ).toBeVisible();
    const root = base === '/' ? 'dist-root' : 'dist';
    const manifest = JSON.parse(
      await readFile(`${root}/.vite/manifest.json`, 'utf8'),
    ) as Record<string, { file: string }>;
    for (const name of ['TextLibrary', 'ClipProperties']) {
      const file = manifest[`src/workspace/${name}.tsx`]!.file;
      expect(requests.some((url) => url.endsWith(file))).toBe(false);
    }
    expect(
      requests.some((url) =>
        /\/(?:editor|ai)-[^/]+\.js|worker|\.onnx|\.wasm/.test(url),
      ),
    ).toBe(false);
    expect(
      await page.evaluate(async () => (await indexedDB.databases()).length),
    ).toBe(0);
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('button', { name: 'Workspace settings', exact: true }),
    ).toBeFocused();
  });

  test(`failed dialog chunks reach explicit release recovery ${base}`, async ({
    page,
  }) => {
    await page.route('**/assets/NotificationLogDialog-*.js', (route) =>
      route.fulfill({ status: 404, body: 'Removed dialog chunk' }),
    );
    await page.goto(base);
    await page
      .getByRole('button', { name: 'Notifications', exact: true })
      .click();
    const recovery = page.getByRole('alert', { name: 'Workspace recovery' });
    await expect(recovery).toContainText('LocalCut could not open this screen');
    await expect(
      recovery.getByRole('button', { name: 'Reload LocalCut' }),
    ).toBeFocused();
    await page.unroute('**/assets/NotificationLogDialog-*.js');
    await recovery.getByRole('button', { name: 'Reload LocalCut' }).click();
    await expect(
      page.getByRole('button', { name: 'Notifications', exact: true }),
    ).toBeVisible();
    await expect(recovery).toHaveCount(0);
  });
}
