import { selectAISettingsTab } from './workspace-settings-helper';
import { fulfillChatTitle } from './chat-title-fixture';
import { closeMediaImportAndPlace } from './workspace-import-helper';
import { dismissNotifications } from './workspace-notifications-helper';
import { expect, test, type Page } from '@playwright/test';

test.use({ hasTouch: true });

async function create(page: Page) {
  await page
    .getByRole('button', { name: 'Workspace settings', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
  await page
    .getByRole('menuitem', { name: 'New project', exact: true })
    .click();
  await page
    .getByLabel('Project name', { exact: true })
    .fill('Mobile film with a deliberately long project name');
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Add text', exact: true }),
  ).toBeVisible();
}
async function addText(page: Page) {
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Add text', exact: true })
    .getByRole('button', { name: 'Insert Plain text', exact: true })
    .click();
}
async function fits(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual((await page.viewportSize())!.width);
}
async function select(page: Page, name: RegExp) {
  await page.getByRole('combobox', { name: 'Select timeline clip' }).click();
  await page.getByRole('option', { name }).click();
}
for (const base of ['/', '/LocalCut/']) {
  test(`mobile shared headers scroll actions and Edit scrolls from the preview surface ${base}`, async ({
    page,
  }, info) => {
    test.setTimeout(40_000);
    await page.setViewportSize({ width: 320, height: 450 });
    await page.goto(base);
    await create(page);
    await addText(page);
    const properties = page.getByRole('dialog', {
      name: 'Clip properties',
      exact: true,
    });
    await expect(properties).toBeVisible();
    await properties
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    const nav = page.getByRole('navigation', { name: 'Workspace sections' });
    for (const [tab, label, headingClass] of [
      ['Edit', 'Edit', '.mobile-edit-heading'],
      ['Chat', 'Chat', '.conversation-heading'],
      ['Media', 'Media', '.media-library > .section-heading'],
    ] as const) {
      await nav
        .getByRole('button', {
          name: tab === 'Media' ? 'Expand media' : tab,
          exact: true,
        })
        .click();
      const heading = page.locator(headingClass);
      await expect(heading).toBeInViewport();
      const before = (await heading.boundingBox())!;
      expect(before.y).toBeLessThan(1);
      const lane = heading.getByRole('region', { name: `${label} actions` });
      const right = heading.getByRole('button', {
        name: `Scroll ${label} actions right`,
      });
      if (tab === 'Media') {
        await lane.evaluate((el) => (el.scrollLeft = 0));
        const rect = (await lane.boundingBox())!;
        const cdp = await page.context().newCDPSession(page);
        const x = rect.x + rect.width * 0.7;
        const y = rect.y + rect.height / 2;
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x, y }],
        });
        for (let step = 1; step <= 6; step++)
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: x - step * 12, y }],
          });
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: [],
        });
        await cdp.detach();
        await expect
          .poll(() => lane.evaluate((el) => el.scrollLeft))
          .toBeGreaterThan(20);
        await lane.evaluate((el) => (el.scrollLeft = 0));
      }

      if (await right.count()) {
        await right.click();
        await expect
          .poll(() => lane.evaluate((el) => el.scrollLeft))
          .toBeGreaterThan(0);
        await expect(
          heading.getByRole('button', { name: `Scroll ${label} actions left` }),
        ).toBeVisible();
      }
      for (const button of await heading
        .locator('.panel-header-actions button')
        .all()) {
        if (!(await button.isVisible())) continue;
        await button.focus();
        const bounds = (await button.boundingBox())!;
        expect(
          Math.abs(bounds.y + bounds.height / 2 - before.y - before.height / 2),
        ).toBeLessThan(2);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
      }
      await page.screenshot({
        path: info.outputPath(`mobile-header-${label}.png`),
      });
    }
    await expect(
      page.getByRole('button', { name: 'Close media', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Collapse chat', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Media root', exact: true }),
    ).toHaveCount(0);
    await nav.getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = page.locator('#editor-panel');
    await editor.evaluate((el) => (el.scrollTop = 0));
    await expect.poll(() => editor.evaluate((el) => el.scrollTop)).toBe(0);
    const heading = page.locator('.mobile-edit-heading');
    const preview = (await page.locator('.preview-stage').boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const x = preview.x + preview.width / 2;
    const y = preview.y + preview.height / 2;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    });
    for (let step = 1; step <= 8; step++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y - step * 12 }],
      });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await cdp.detach();
    await expect
      .poll(() => editor.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(40);
    await expect(heading).toBeInViewport();
    expect((await heading.boundingBox())!.y).toBeLessThan(1);
    await expect(nav).toBeInViewport();
    await fits(page);
  });

  test(`mobile chat keyboard keeps its heading and restores navigation; speech opens from Media ${base}`, async ({
    page,
    context,
  }, info) => {
    test.setTimeout(45000);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem(
        'localcut.openrouter-credential.v1',
        JSON.stringify({ version: 1, key: 'synthetic-mobile-key' }),
      );
      localStorage.setItem(
        'localcut.workspace-preferences.v1',
        JSON.stringify({ version: 1, preferences: { aiModel: 'test/mobile' } }),
      );
    });
    let completions = 0;
    await context.route('https://openrouter.ai/api/v1/models', (route) =>
      route.fulfill({
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
        },
        json: {
          data: [
            {
              id: 'test/mobile',
              name: 'Mobile model',
              context_length: 512000,
              supported_parameters: ['tools', 'tool_choice'],
            },
            {
              id: 'test/short',
              name: 'Short model',
              context_length: 256000,
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
          return route.fulfill({
            headers: {
              'access-control-allow-origin': '*',
              'access-control-allow-headers': '*',
              'access-control-allow-methods': 'POST,OPTIONS',
            },
            body: '',
          });
        if (await fulfillChatTitle(route)) return;
        completions++;
        return route.fulfill({
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': '*',
          },
          contentType: 'text/event-stream',
          body: 'data: {"choices":[{"index":0,"delta":{"content":"Ready."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        });
      },
    );
    await page.goto(base);
    await create(page);
    const nav = page.getByRole('navigation', { name: 'Workspace sections' });
    await nav.getByRole('button', { name: 'Chat', exact: true }).click();
    const heading = page.locator('.conversation-heading');
    const composer = page.getByRole('textbox', { name: 'Describe your edit' });
    await expect(composer).toBeEnabled();
    await expect(page.locator('.workspace-header')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Request context' }),
    ).toHaveCount(0);
    await expect(
      heading.getByRole('button', { name: 'Text to speech' }),
    ).toHaveCount(0);
    await expect(heading).toBeInViewport();
    const initial = (await heading.boundingBox())!;
    await page.evaluate(() => {
      const heading = document.querySelector('.conversation-heading')!;
      const workspace = document.querySelector('.workspace')!;
      const frames: { y: number; position: string }[] = [];
      (window as unknown as { headerFrames: typeof frames }).headerFrames =
        frames;
      let remaining = 20;
      const sample = () => {
        frames.push({
          y:
            heading.getBoundingClientRect().y -
            (window.visualViewport?.offsetTop ?? 0),
          position: getComputedStyle(workspace).position,
        });
        if (--remaining) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await composer.fill('Keep this draft');
    await expect(nav).toHaveCount(0);
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport!, 'height', {
        configurable: true,
        value: 420,
      });
      window.visualViewport!.dispatchEvent(new Event('resize'));
    });
    await expect
      .poll(async () => Math.abs((await heading.boundingBox())!.y - initial.y))
      .toBeLessThan(1);
    await expect
      .poll(async () => {
        const rect = (await composer.boundingBox())!;
        return rect.y + rect.height;
      })
      .toBeLessThan(420);
    await page.screenshot({
      path: info.outputPath('mobile-chat-keyboard.png'),
    });
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport!, 'offsetTop', {
        configurable: true,
        value: 35,
      });
      window.visualViewport!.dispatchEvent(new Event('scroll'));
    });
    await expect
      .poll(async () =>
        Math.abs((await heading.boundingBox())!.y - initial.y - 35),
      )
      .toBeLessThan(1);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { headerFrames: unknown[] }).headerFrames
              .length,
        ),
      )
      .toBe(20);
    const frames = await page.evaluate(
      () =>
        (
          window as unknown as {
            headerFrames: { y: number; position: string }[];
          }
        ).headerFrames,
    );
    expect(frames.every(({ position }) => position === 'fixed')).toBe(true);
    expect(
      Math.max(...frames.map(({ y }) => y)) -
        Math.min(...frames.map(({ y }) => y)),
    ).toBeLessThan(1);
    await heading.getByRole('button', { name: 'Chat sessions' }).focus();
    await expect(nav).toBeVisible();
    await page.evaluate(() => {
      delete (window.visualViewport as unknown as Record<string, unknown>)
        .height;
      delete (window.visualViewport as unknown as Record<string, unknown>)
        .offsetTop;
      window.visualViewport!.dispatchEvent(new Event('resize'));
    });
    await expect(composer).toHaveValue('Keep this draft');
    await heading
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page
      .getByRole('menuitem', {
        name: 'AI settings',
        exact: true,
      })
      .click();
    const settings = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await selectAISettingsTab(page, 'LLM - Chat');
    await settings
      .getByRole('combobox', { name: 'AI model', exact: true })
      .click();
    await expect(
      page.getByRole('option', {
        name: 'Short model · test/short',
        exact: true,
      }),
    ).toHaveCount(1);
    await expect(
      page.getByRole('option', {
        name: 'Mobile model · test/mobile',
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole('option', { name: 'Mobile model · test/mobile', exact: true })
      .click();
    await expect(settings).toBeVisible();
    await settings.getByRole('button', { name: 'Done', exact: true }).click();
    await page.locator('#mobile-media-trigger').click();
    const media = page.locator('#workspace-media');
    await expect(
      media.getByRole('button', { name: 'Text to speech', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath('mobile-media-speech.png') });
    await media
      .getByRole('button', { name: 'Text to speech', exact: true })
      .click();
    const speech = page.getByRole('dialog', {
      name: 'Text to speech',
      exact: true,
    });
    await expect(speech).toBeVisible();
    await speech.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(media).toBeVisible();
    await expect(
      media.getByRole('button', { name: 'Text to speech', exact: true }),
    ).toBeFocused();
    await page.setViewportSize({ width: 320, height: 844 });
    for (const name of [
      'Task queue',
      'Text to speech',
      'Commands',
      'Workspace settings',
      'Record screen',
    ]) {
      await media.getByRole('button', { name, exact: true }).focus();
      await expect(
        media.getByRole('button', { name, exact: true }),
      ).toBeInViewport();
    }
    await fits(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await nav.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(composer).toHaveValue('Keep this draft');
    expect(completions).toBe(0);
    await expect(
      page.getByRole('button', { name: 'Chat sessions', exact: true }),
    ).toBeFocused();
    await composer.focus();
    await expect(composer).toBeFocused();
    await expect(nav).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .click();
    await expect(
      page.getByRole('article', { name: 'Assistant response' }),
    ).toContainText('Ready.');
    expect(completions).toBe(1);
    await expect(nav).toHaveCount(0);
    await heading.getByRole('button', { name: 'Chat sessions' }).focus();
    await expect(nav).toBeVisible();
    await expect(
      heading.getByRole('button', { name: 'Chat sessions' }),
    ).toContainText('Editing session title');
    await composer.fill('Mobile retained draft');
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const db = await new Promise<IDBDatabase>((resolve) => {
            const request = indexedDB.open('localcut-chats-v1');
            request.onsuccess = () => resolve(request.result);
          });
          const records = await new Promise<{ content: { prompt: string } }[]>(
            (resolve) => {
              const request = db
                .transaction('sessions')
                .objectStore('sessions')
                .getAll();
              request.onsuccess = () => resolve(request.result);
            },
          );
          db.close();
          return records.some(
            (chat) => chat.content.prompt === 'Mobile retained draft',
          );
        }),
      )
      .toBe(true);
    await heading
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'AI settings', exact: true })
      .click();
    await selectAISettingsTab(page, 'LLM - Chat');
    await settings
      .getByRole('combobox', { name: 'AI model', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'Mobile model · test/mobile', exact: true })
      .click();
    await settings.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(composer).toHaveValue('Mobile retained draft');
    await expect(
      heading.getByRole('button', { name: 'Chat sessions' }),
    ).toContainText('Editing session title');
    await page.reload();
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(composer).toHaveValue('Mobile retained draft');
    await expect(
      heading.getByRole('button', { name: 'Chat sessions' }),
    ).toContainText('Editing session title');
    await expect(
      page.getByRole('article', { name: 'Assistant response' }),
    ).toContainText('Ready.');
    expect(completions).toBe(1);
  });

  test(`mobile active tabs preserve state and animate the selection ${base}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(base);
    await create(page);
    const nav = page.getByRole('navigation', { name: 'Workspace sections' });
    const editor = page.locator('#workspace-editor');
    const chat = page.locator('.conversation-panel');
    const media = page.locator('#workspace-media');
    const edit = nav.getByRole('button', { name: 'Edit', exact: true });
    const chatTab = nav.getByRole('button', { name: 'Chat', exact: true });
    const mediaTab = page.locator('#mobile-media-trigger');
    const preferences = await page.evaluate(() =>
      localStorage.getItem('localcut.workspace-preferences.v1'),
    );
    await expect(edit).toHaveAttribute('aria-current', 'page');
    await expect(editor).toBeVisible();
    await expect(chat).toBeHidden();
    await expect(media).toBeHidden();
    await page.screenshot({ path: info.outputPath('mobile-active-edit.png') });
    await chatTab.click();
    await expect(chatTab).toHaveAttribute('aria-current', 'page');
    await expect(chat).toBeVisible();
    await expect(editor).toBeHidden();
    await mediaTab.click();
    await expect(mediaTab).toHaveAttribute('aria-current', 'page');
    await expect(media).toBeVisible();
    await expect(editor).toBeHidden();
    await expect(chat).toBeHidden();
    await expect(nav).toBeInViewport();
    await expect
      .poll(async () => {
        const highlight = (await page
          .locator('.mobile-tab-indicator')
          .boundingBox())!;
        const selected = (await mediaTab.boundingBox())!;
        return Math.abs(highlight.x - selected.x);
      })
      .toBeLessThan(1);
    expect(
      await page
        .locator('.mobile-tab-indicator')
        .evaluate((el) => getComputedStyle(el).transitionDuration),
    ).not.toBe('0s');
    await page.screenshot({ path: info.outputPath('mobile-active-media.png') });
    await chatTab.click();
    await expect(chatTab).toHaveAttribute('aria-current', 'page');
    await expect(chat).toBeVisible();
    for (let i = 0; i < 3; i++) {
      await edit.click();
      await chatTab.click();
      await mediaTab.click();
    }
    await edit.click();
    await expect(editor).toBeVisible();
    await expect(chat).toBeHidden();
    await expect(media).toBeHidden();
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await chatTab.focus();
    await page.keyboard.press('Enter');
    await expect(chat).toBeVisible();
    expect(
      await page
        .locator('.mobile-tab-indicator')
        .evaluate((el) => getComputedStyle(el).transitionDuration),
    ).toBe('0s');
    expect(
      await page
        .locator('#chat-panel')
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe('none');
    expect(
      await page.evaluate(() =>
        localStorage.getItem('localcut.workspace-preferences.v1'),
      ),
    ).toBe(preferences);
    await edit.click();
    await page.getByRole('button', { name: 'Commands', exact: true }).click();
    const commands = page.getByRole('dialog', {
      name: 'Commands',
      exact: true,
    });
    await commands.getByRole('combobox').fill('Expand chat');
    await commands
      .getByRole('option')
      .filter({ has: page.getByText('Expand chat', { exact: true }) })
      .click();
    await expect(chatTab).toHaveAttribute('aria-current', 'page');
    await expect(chat).toBeVisible();
    expect(
      await page.evaluate(() =>
        localStorage.getItem('localcut.workspace-preferences.v1'),
      ),
    ).toBe(preferences);
    await edit.click();
    await page.setViewportSize({ width: 390, height: 500 });
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'Appearance', exact: true })
      .click();
    const appearance = page.getByRole('region', {
      name: 'Appearance customization',
    });
    await expect(appearance).toBeVisible();
    const body = page.locator('.workspace-body');
    await body.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    expect(await body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await chatTab.click();
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBe(0);
    await expect(
      chat.getByRole('button', { name: 'Chat sessions' }),
    ).toBeInViewport();
    await appearance.getByRole('button', { name: 'Close appearance' }).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(editor).toBeVisible();
    await expect(chat).toBeVisible();
    await expect(nav).toBeHidden();
  });

  test(`mobile media tab fills the content at every interface size and scrolls its library ${base}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto(base);
    const media = page.getByRole('complementary', {
      name: 'Media library',
      exact: true,
    });
    for (const interfaceSize of ['default', 'small', 'large']) {
      await page.evaluate((interfaceSize) => {
        localStorage.setItem(
          'localcut.appearance.v1',
          JSON.stringify({
            version: 1,
            preferences: { interfaceSize },
          }),
        );
      }, interfaceSize);
      await page.reload();
      for (const viewport of [
        { width: 320, height: 740 },
        { width: 600, height: 300 },
      ]) {
        await page.setViewportSize(viewport);
        const trigger = page.locator('#mobile-media-trigger');
        await trigger.click();
        await expect(media).toBeVisible();
        await expect
          .poll(async () => {
            const bounds = (await media.boundingBox())!;

            const nav = (await page
              .locator('.mobile-navigation')
              .boundingBox())!;
            return Math.max(
              Math.abs(bounds.x),
              Math.abs(bounds.y),
              Math.abs(bounds.width - viewport.width),
              Math.max(0, bounds.y + bounds.height - nav.y),
            );
          })
          .toBeLessThanOrEqual(1);
        expect(
          await media.evaluate((el) => getComputedStyle(el).borderRadius),
        ).toBe('0px');
        const close = media.getByRole('button', {
          name: 'Close media',
          exact: true,
        });
        await expect(close).toHaveCount(0);
        await media
          .getByRole('button', { name: 'Import media', exact: true })
          .scrollIntoViewIfNeeded();
        await expect(
          media.getByRole('button', { name: 'Import media', exact: true }),
        ).toBeInViewport();
        if (interfaceSize === 'default') {
          await page.screenshot({
            path: info.outputPath(`media-sheet-${viewport.width}.png`),
          });
        }
        await page
          .getByRole('navigation', { name: 'Workspace sections' })
          .getByRole('button', { name: 'Edit', exact: true })
          .click();
        await expect(media).toBeHidden();
      }
    }
    await page.evaluate(() =>
      localStorage.removeItem('localcut.appearance.v1'),
    );
    await page.setViewportSize({ width: 320, height: 740 });
    await page.reload();
    await create(page);
    await page.locator('#mobile-media-trigger').click();
    const bytes = await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(16, 16);
      canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
      return [
        ...new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer()),
      ];
    });
    await page.getByLabel('Import media', { exact: true }).setInputFiles(
      Array.from({ length: 24 }, (_, i) => ({
        name: `source-${i}.png`,
        mimeType: 'image/png',
        buffer: Buffer.from(bytes),
      })),
    );
    await closeMediaImportAndPlace(page);
    await expect(media.locator('.media-item')).toHaveCount(24);
    const header = media.locator('.section-heading');
    const commands = header.getByRole('button', {
      name: 'Commands',
      exact: true,
    });
    const headerBounds = (await header.boundingBox())!;
    await commands.focus();
    const commandsBounds = (await commands.boundingBox())!;
    expect(commandsBounds.y + commandsBounds.height).toBeLessThanOrEqual(
      headerBounds.y + headerBounds.height,
    );
    expect(commandsBounds.y).toBeGreaterThanOrEqual(headerBounds.y);
    await expect(page.locator('.workspace-header')).toHaveCount(0);
    await expect(header).toBeInViewport();
    await expect
      .poll(
        () =>
          media
            .locator('.media-symbol img')
            .evaluateAll(
              (els) =>
                els.filter((el) => (el as HTMLImageElement).naturalWidth > 0)
                  .length,
            ),
        // All 24 previews use queued native jobs, which can outlast a single
        // control's deadline during concurrent Chrome coverage.
        { timeout: 30_000 },
      )
      .toBe(24);
    const content = media.locator('.media-content');
    const cdp = await page.context().newCDPSession(page);
    const bounds = (await media
      .locator('.media-asset-preview')
      .first()
      .boundingBox())!;
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    });
    for (let step = 1; step <= 8; step++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y - step * 12 }],
      });
      await expect(page.locator('.media-drag-preview')).toHaveCount(0);
    }
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await expect
      .poll(() => content.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(40);
    // Horizontal touch dragging keeps its preview; native cancellation removes it.
    const source = media.locator('.media-asset-preview').first();
    await source.scrollIntoViewIfNeeded();
    const dragBounds = (await source.boundingBox())!;
    const dragX = dragBounds.x + dragBounds.width / 2;
    const dragY = dragBounds.y + dragBounds.height / 2;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: dragX, y: dragY }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: dragX - 30, y: dragY }],
    });
    await expect(page.locator('.media-drag-preview')).toBeVisible();
    await expect(page.locator('.media-drag-preview')).toContainText(
      'source-0.png',
    );
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchCancel',
      touchPoints: [],
    });
    await expect(page.locator('.media-drag-preview')).toHaveCount(0);
    await cdp.detach();
    expect(await content.evaluate((el) => el.scrollHeight)).toBeGreaterThan(
      await content.evaluate((el) => el.clientHeight),
    );
    await media
      .getByText('source-23.png', { exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      media.getByText('source-23.png', { exact: true }),
    ).toBeInViewport();
    await expect(
      media.getByRole('button', { name: 'Close media', exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath('media-sheet-scrolled.png'),
    });
    await page.keyboard.press('Escape');
    await expect(media).toBeHidden();
    await expect(page.locator('#mobile-media-trigger')).toBeFocused();
  });

  test(
    '@journey ' +
      [
        `mobile touch editing, grouping, playback and media focus ${base}`,
        `mobile dialogs, landscape, reflow and desktop preference preservation ${base}`,
      ].join(' | '),
    async ({ page }, testInfo) => {
      const info = testInfo;

      await test.step(`mobile touch editing, grouping, playback and media focus ${base}`, async () => {
        await page.setViewportSize({ width: 320, height: 740 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(base);
        await fits(page);
        const nav = page.getByRole('navigation', {
          name: 'Workspace sections',
        });
        await expect(nav).toBeInViewport();
        const startup = await page.evaluate(() =>
          performance.getEntriesByType('resource').map((r) => r.name),
        );
        expect(
          startup.some((url) => /editor\.js|ai\.js|worker/.test(url)),
        ).toBe(false);
        await page.screenshot({ path: info.outputPath('mobile-empty.png') });
        await create(page);
        const bytes = await page.evaluate(async () => {
          const canvas = new OffscreenCanvas(160, 90);
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = '#ff0000';
          ctx.fillRect(0, 0, 160, 90);
          return [
            ...new Uint8Array(
              await (
                await canvas.convertToBlob({ type: 'image/png' })
              ).arrayBuffer(),
            ),
          ];
        });
        await page.getByLabel('Import media', { exact: true }).setInputFiles([
          {
            name: 'first.png',
            mimeType: 'image/png',
            buffer: Buffer.from(bytes),
          },
          {
            name: 'second.png',
            mimeType: 'image/png',
            buffer: Buffer.from(bytes),
          },
        ]);
        await closeMediaImportAndPlace(page);
        await expect(page.locator('.timeline-clip')).toHaveCount(2);
        await fits(page);
        await select(page, /first.png/);
        await page
          .getByRole('button', { name: 'Clip properties', exact: true })
          .click();
        const properties = page.getByRole('dialog', {
          name: 'Clip properties',
          exact: true,
        });
        await properties
          .getByLabel('Duration (seconds)', { exact: true })
          .fill('0.1');
        await properties
          .getByRole('button', { name: 'Apply properties', exact: true })
          .click();
        await expect(properties).toBeHidden();
        await page
          .getByRole('button', { name: 'Select multiple clips' })
          .click();
        await select(page, /second.png/);
        await expect(
          page.locator('.timeline-clip[aria-pressed="true"]'),
        ).toHaveCount(2);
        await page
          .getByRole('button', { name: 'Group clips', exact: true })
          .click();
        await expect(
          page.locator('.timeline-clip[data-grouped="true"]'),
        ).toHaveCount(2);
        await page
          .getByRole('button', { name: 'Ungroup clips', exact: true })
          .click();
        await expect(
          page.locator('.timeline-clip[data-grouped="true"]'),
        ).toHaveCount(0);
        await expect
          .poll(() =>
            page
              .getByLabel('Video preview', { exact: true })
              .evaluate((canvas) => {
                const pixel = (canvas as HTMLCanvasElement)
                  .getContext('2d')!
                  .getImageData(480, 270, 1, 1).data;
                return pixel[0]! > 220 && pixel[1]! < 30;
              }),
          )
          .toBe(true);
        await page
          .getByRole('button', { name: 'Play preview', exact: true })
          .click();
        await expect
          .poll(async () =>
            Number(
              await page
                .getByRole('slider', { name: 'Playhead position' })
                .getAttribute('aria-valuenow'),
            ),
          )
          .toBeGreaterThan(0);
        await page
          .getByRole('button', { name: 'Pause preview', exact: true })
          .click();
        const sizing = await page
          .locator(
            '.workspace-header button, .mobile-tab-header button, .mobile-navigation button, .playback-controls button',
          )
          .evaluateAll((nodes) =>
            nodes.map((n) => ({
              label: n.getAttribute('aria-label') || n.textContent,
              width: n.getBoundingClientRect().width,
              height: n.getBoundingClientRect().height,
            })),
          );
        for (const target of sizing) {
          expect(target.width, String(target.label)).toBeGreaterThanOrEqual(44);
          expect(target.height, String(target.label)).toBeGreaterThanOrEqual(
            44,
          );
        }
        await page.screenshot({
          path: info.outputPath('mobile-editor.png'),
          fullPage: true,
        });
        const mediaTrigger = nav.getByRole('button', { name: 'Expand media' });
        await mediaTrigger.click();
        const media = page.getByRole('complementary', {
          name: 'Media library',
          exact: true,
        });
        await expect(media).toBeInViewport();
        const mediaBounds = (await media.boundingBox())!;
        expect(mediaBounds.x).toBeCloseTo(0, 0);
        expect(mediaBounds.y).toBeCloseTo(0, 0);
        expect(mediaBounds.width).toBeCloseTo(320, 0);
        expect(mediaBounds.y + mediaBounds.height).toBeLessThanOrEqual(
          (await nav.boundingBox())!.y,
        );
        await expect(
          media.getByText('first.png', { exact: true }),
        ).toBeVisible();
        await expect
          .poll(() =>
            media.evaluate((el) => el.contains(document.activeElement)),
          )
          .toBe(true);
        for (let i = 0; i < 8; i++) {
          await page.keyboard.press('Tab');
          await expect
            .poll(() =>
              page.evaluate(() => {
                const focused = document.activeElement;
                return !focused?.closest(
                  '[inert], [aria-hidden="true"], #editor-panel, #chat-panel',
                );
              }),
            )
            .toBe(true);
        }
        await page.screenshot({ path: info.outputPath('mobile-media.png') });
        await page.keyboard.press('Escape');
        await expect(media).toBeHidden();
        await expect(mediaTrigger).toBeFocused();
        // A retained, closed media sheet must not block the shared viewport owner.
        const timeline = page.locator('.timeline-viewport');
        await timeline.scrollIntoViewIfNeeded();
        const initialWidth = await timeline.evaluate((el) => el.scrollWidth);
        const box = (await timeline.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + 18);
        await page.keyboard.down('Control');
        await page.mouse.wheel(0, -140);
        await page.keyboard.up('Control');
        await expect
          .poll(() => timeline.evaluate((el) => el.scrollWidth))
          .toBeGreaterThan(initialWidth * 1.5);
        await timeline.focus();
        await page.keyboard.press('0');
        await expect
          .poll(() => timeline.evaluate((el) => el.scrollWidth))
          .toBe(initialWidth);
        await nav.getByRole('button', { name: 'Chat', exact: true }).click();
        await expect(
          page.getByRole('button', { name: 'Chat sessions', exact: true }),
        ).toBeFocused();
        await page
          .getByRole('button', { name: 'Workspace settings', exact: true })
          .focus();
        await expect(
          page.getByRole('button', { name: 'Workspace settings', exact: true }),
        ).toBeInViewport();
        await nav.getByRole('button', { name: 'Edit', exact: true }).click();
        await expect(
          page.getByRole('main', { name: 'Video editor' }),
        ).toBeFocused();
        await expect(
          page.getByRole('button', { name: 'Play preview', exact: true }),
        ).toBeInViewport();
        await dismissNotifications(page);
        await page.screenshot({
          path: info.outputPath('mobile-editor-start.png'),
        });
      });

      await test.step(`mobile dialogs, landscape, reflow and desktop preference preservation ${base}`, async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        // Continue in the already-open app.
        // Keep the imported clips and active project for dialog/reflow checks.
        await addText(page);
        const properties = page.getByRole('dialog', {
          name: 'Clip properties',
          exact: true,
        });
        await page.setViewportSize({ width: 844, height: 390 });
        await expect(properties).toBeVisible();
        await properties
          .getByRole('button', { name: 'Apply properties', exact: true })
          .scrollIntoViewIfNeeded();
        await expect(
          properties.getByRole('button', {
            name: 'Apply properties',
            exact: true,
          }),
        ).toBeInViewport();
        await properties
          .getByRole('button', { name: 'Close', exact: true })
          .click();
        await fits(page);
        await expect(
          page.getByRole('navigation', { name: 'Workspace sections' }),
        ).toBeVisible();
        await page.screenshot({
          path: info.outputPath('mobile-landscape.png'),
          fullPage: true,
        });
        await page.setViewportSize({ width: 320, height: 740 });
        // Browser text enlargement, independent of the responsive viewport.
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '200%';
        });
        await page
          .getByRole('button', { name: 'Workspace settings', exact: true })
          .click();
        await page
          .getByRole('menuitem', { name: 'Project', exact: true })
          .click();
        await expect(
          page.getByRole('menuitem', { name: 'Open project', exact: true }),
        ).toBeInViewport();
        await page
          .getByRole('menuitem', { name: 'Open project', exact: true })
          .click();
        await fits(page);
        const browser = page.getByRole('main', { name: 'Projects' });
        await expect(
          browser.getByRole('textbox', { name: 'Search projects' }),
        ).toBeVisible();
        const actionSizes = await browser
          .locator('.project-browser-actions button')
          .evaluateAll((nodes) =>
            nodes.map((n) => ({
              scroll: n.scrollHeight,
              height: n.clientHeight,
            })),
          );
        for (const action of actionSizes)
          expect(action.scroll).toBeLessThanOrEqual(action.height);
        await page.screenshot({
          path: info.outputPath('mobile-projects-text-200.png'),
          fullPage: true,
        });
        await browser
          .getByRole('button', { name: 'Back to editor', exact: true })
          .click();
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '';
        });
        await page
          .getByRole('button', { name: 'Workspace settings', exact: true })
          .click();
        await page
          .getByRole('menuitem', { name: 'Appearance', exact: true })
          .click();
        await expect(
          page.getByRole('button', { name: 'Close appearance', exact: true }),
        ).toBeVisible();
        await fits(page);
        const colors = await page
          .locator('.appearance-swatches button')
          .evaluateAll((nodes) =>
            nodes.map((n) => ({
              left: n.getBoundingClientRect().left,
              right: n.getBoundingClientRect().right,
              width: n.getBoundingClientRect().width,
              height: n.getBoundingClientRect().height,
            })),
          );
        for (const color of colors) {
          expect(color.right).toBeLessThanOrEqual(320);
          expect(color.left).toBeGreaterThanOrEqual(0);
          expect(color.width).toBeGreaterThanOrEqual(44);
          expect(color.height).toBeGreaterThanOrEqual(44);
        }
        await page
          .getByRole('button', { name: 'Close appearance', exact: true })
          .click();
        await page.setViewportSize({ width: 1440, height: 900 });
        await expect(page.locator('html')).toHaveAttribute(
          'data-workspace-narrow',
          'false',
        );
        // The preceding import revealed desktop media for this session.
        // Close it before exercising the original deliberate open preference.
        await page
          .getByRole('button', { name: 'Collapse media', exact: true })
          .click();
        await page
          .getByRole('button', { name: 'Expand media', exact: true })
          .click();
        await page
          .getByRole('separator', { name: 'Resize workspace chat' })
          .press('End');
        const before = await page.evaluate(() =>
          localStorage.getItem('localcut.workspace-preferences.v1'),
        );
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(
          page.getByRole('complementary', {
            name: 'Media library',
            exact: true,
          }),
        ).toBeHidden();
        await page
          .getByRole('button', { name: 'Expand media', exact: true })
          .click();
        await page
          .getByRole('navigation', { name: 'Workspace sections' })
          .getByRole('button', { name: 'Edit', exact: true })
          .click();
        expect(
          await page.evaluate(() =>
            localStorage.getItem('localcut.workspace-preferences.v1'),
          ),
        ).toBe(before);
        await page.setViewportSize({ width: 1440, height: 900 });
        await expect(
          page.getByRole('button', { name: 'Collapse media', exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole('separator', { name: 'Resize workspace chat' }),
        ).toHaveAttribute('aria-valuetext', '560 pixels');
        await expect(
          page.getByRole('navigation', { name: 'Workspace sections' }),
        ).toBeHidden();
      });
    },
  );
}

test('touch tablet controls fit with media and multi-selection open', async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/LocalCut/');
  await create(page);
  for (let i = 0; i < 2; i++) {
    await addText(page);
    await page
      .getByRole('dialog', { name: 'Clip properties', exact: true })
      .getByRole('button', { name: 'Close', exact: true })
      .click();
  }
  await page.getByRole('button', { name: 'Expand media', exact: true }).click();
  await page.getByRole('button', { name: 'Select multiple clips' }).click();
  await page.getByRole('combobox', { name: 'Select timeline clip' }).click();
  await page.getByRole('option').first().click();
  const editor = (await page
    .getByRole('main', { name: 'Video editor' })
    .boundingBox())!;
  const buttons = await page
    .locator('.timeline-toolbar button')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().right),
    );
  for (const right of buttons)
    expect(right).toBeLessThanOrEqual(editor.x + editor.width);
  await page
    .getByRole('button', { name: 'Workspace settings', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Appearance', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Close appearance' }),
  ).toBeVisible();
  const colors = await page
    .locator('.appearance-swatches button')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        right: node.getBoundingClientRect().right,
        width: node.getBoundingClientRect().width,
      })),
    );
  for (const color of colors) {
    expect(color.right).toBeLessThanOrEqual(768);
    expect(color.width).toBeGreaterThanOrEqual(44);
  }
  await fits(page);
});

test('media focus follows the mounted trigger across both breakpoints', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/LocalCut/');
  await create(page);
  await page.getByRole('button', { name: 'Expand media', exact: true }).click();
  await page.locator('#workspace-media').focus();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('#desktop-media-trigger')).toBeFocused();
  await page.locator('#desktop-media-trigger').click();
  const desktop = page.locator('#desktop-media-trigger');
  await expect(desktop).toHaveAttribute('aria-expanded', 'true');
  await desktop.focus();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#mobile-media-trigger')).toBeFocused();
});

test.describe('fine-pointer responsive selection', () => {
  test.use({ hasTouch: false });
  test('touch multi-selection resets when its control disappears', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/LocalCut/');
    await create(page);
    for (let i = 0; i < 3; i++) {
      await addText(page);
      await page
        .getByRole('dialog', { name: 'Clip properties', exact: true })
        .getByRole('button', { name: 'Close', exact: true })
        .click();
      // Keep pointer targets separate; overlapping text clips intentionally
      // share a lane and cannot all receive a pointer click at the same time.
      await page
        .getByRole('slider', { name: 'Playhead position' })
        .press('End');
    }
    await page.getByRole('button', { name: 'Select multiple clips' }).click();
    await page.getByRole('combobox', { name: 'Select timeline clip' }).click();
    await page.getByRole('option').first().click();
    const clips = page.locator('.timeline-clip');
    const selected = page.locator('.timeline-clip[aria-pressed="true"]');
    await expect(selected).toHaveCount(2);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(
      page.getByRole('button', { name: 'Select multiple clips' }),
    ).toBeHidden();
    // CSS can hide the control before its media-query listener commits the reset.
    await expect(
      page.getByRole('button', {
        name: 'Select multiple clips',
        exact: true,
        includeHidden: true,
      }),
    ).toHaveAttribute('aria-pressed', 'false');
    // Enter opens Clip properties; native Space activation selects the button
    // without opening a modal that intercepts the following pointer checks.
    await clips.nth(1).press('Space');
    await expect(selected).toHaveCount(1);
    await clips.nth(0).click();
    await expect(selected).toHaveCount(1);
    await clips.nth(1).click({ modifiers: ['Shift'] });
    await expect(selected).toHaveCount(2);
    await clips.nth(2).click({ modifiers: ['ControlOrMeta'] });
    await expect(selected).toHaveCount(3);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole('button', { name: 'Select multiple clips' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });
});
