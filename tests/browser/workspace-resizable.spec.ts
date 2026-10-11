import { expect, test } from '@playwright/test';

for (const base of ['/', '/LocalCut/']) {
  test(`workspace resizable panels follow dragging without preference writes ${base}`, async ({
    page,
  }) => {
    // Keep the panel-toggle and drag regression on the animated layout path.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base);
    const composer = page.locator('.chat-provider-empty');
    // Retain the exact DOM instance through dragging and collapse.
    await composer.evaluate((element) => {
      (window as unknown as { resizeComposer: Element }).resizeComposer =
        element;
    });
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    const handles = [
      {
        name: 'Resize workspace chat',
        selector: '.conversation-panel',
        axis: 'width',
        delta: -72,
        field: 'chatWidth',
      },
      {
        name: 'Resize media library',
        selector: '#workspace-media',
        axis: 'width',
        delta: 60,
        field: 'mediaWidth',
      },
      {
        name: 'Resize timeline',
        selector: '.timeline',
        axis: 'height',
        delta: -48,
        field: 'timelineHeight',
      },
    ] as const;
    // Let the explicit panel-toggle animation settle before measuring dragging.
    await expect
      .poll(() =>
        page.locator('.workspace-columns').getAttribute('data-transitioning'),
      )
      .toBeNull();
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      (window as unknown as { resizeWrites: number }).resizeWrites = 0;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'localcut.workspace-preferences.v1')
          (window as unknown as { resizeWrites: number }).resizeWrites++;
        return original.call(this, key, value);
      };
    });
    for (const { name, selector, axis, delta, field } of handles) {
      const handle = page.getByRole('separator', { name, exact: true });
      const target = page.locator(selector);
      const before = (await target.boundingBox())![axis];
      const box = (await handle.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      const writes = await page.evaluate(
        () => (window as unknown as { resizeWrites: number }).resizeWrites,
      );
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(
        x + (axis === 'width' ? delta : 0),
        y + (axis === 'height' ? delta : 0),
        { steps: 12 },
      );
      await expect
        .poll(async () => (await target.boundingBox())![axis])
        .toBeCloseTo(
          before + (name === 'Resize media library' ? delta : -delta),
          0,
        );
      expect(
        await page.evaluate(
          () => (window as unknown as { resizeWrites: number }).resizeWrites,
        ),
      ).toBe(writes);
      expect(
        await target.evaluate(
          (element) =>
            getComputedStyle(element.closest('[data-panel]')!)
              .transitionDuration,
        ),
      ).toBe('0s');
      const aria = await handle.evaluate((element) => ({
        now: Number(element.getAttribute('aria-valuenow')),
        min: Number(element.getAttribute('aria-valuemin')),
        max: Number(element.getAttribute('aria-valuemax')),
      }));
      expect(aria.now).toBeGreaterThanOrEqual(aria.min);
      expect(aria.now).toBeLessThanOrEqual(aria.max);
      expect(aria.min).toBeGreaterThanOrEqual(0);
      expect(aria.max).toBeLessThanOrEqual(100);
      await page.mouse.up();
      const after = Math.round((await target.boundingBox())![axis]);
      await expect
        .poll(() =>
          page.evaluate(
            (field) =>
              JSON.parse(
                localStorage.getItem('localcut.workspace-preferences.v1')!,
              ).preferences[field],
            field,
          ),
        )
        .toBe(after);
      await handle.press(
        name === 'Resize workspace chat'
          ? 'ArrowLeft'
          : name === 'Resize media library'
            ? 'ArrowRight'
            : 'ArrowUp',
      );
      await expect
        .poll(async () => Math.round((await target.boundingBox())![axis]))
        .toBe(after + 16);
    }
    await page
      .getByRole('button', { name: 'Collapse chat', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Expand chat', exact: true })
      .click();
    expect(
      await composer.evaluate(
        (element) =>
          (window as unknown as { resizeComposer: Element }).resizeComposer ===
          element,
      ),
    ).toBe(true);
    const preferred = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('localcut.workspace-preferences.v1')!)
          .preferences,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole('navigation', { name: 'Workspace sections' }),
    ).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await expect
      .poll(async () =>
        Math.round(
          (await page.locator('.conversation-panel').boundingBox())!.width,
        ),
      )
      .toBe(preferred.chatWidth);
    await expect
      .poll(async () =>
        Math.round(
          (await page.locator('#workspace-media').boundingBox())!.width,
        ),
      )
      .toBe(preferred.mediaWidth);
    await expect
      .poll(async () =>
        Math.round((await page.locator('.timeline').boundingBox())!.height),
      )
      .toBe(preferred.timelineHeight);
    const timeline = (await page.locator('.timeline').boundingBox())!;
    expect(Math.round(timeline.y + timeline.height)).toBe(900);
    await expect(
      page
        .locator('.preview')
        .getByRole('button', { name: 'Import media', exact: true }),
    ).toBeVisible();
    await expect(composer).toBeVisible();
    await page.screenshot({
      path: `.artifacts/resizable-${base === '/' ? 'root' : 'pages'}.png`,
    });
  });
}

for (const input of ['mouse', 'touch'] as const) {
  test.describe(`${input} expanded divider targets`, () => {
    test.use({ hasTouch: input === 'touch' });
    for (const base of ['/', '/LocalCut/']) {
      for (const [interfaceSize, scale] of [
        ['default', 1],
        ['small', 0.75],
        ['large', 1.25],
      ] as const) {
        test(`workspace resizable pointer coordinates at ${interfaceSize} interface size ${base}`, async ({
          page,
        }) => {
          await page.setViewportSize({ width: 1440, height: 900 });
          await page.addInitScript(
            ({ interfaceSize }) => {
              localStorage.setItem(
                'localcut.appearance.v1',
                JSON.stringify({ version: 1, preferences: { interfaceSize } }),
              );
              localStorage.setItem(
                'localcut.workspace-preferences.v1',
                JSON.stringify({
                  version: 1,
                  preferences: { mediaOpen: true },
                }),
              );
            },
            { interfaceSize },
          );
          await page.goto(base);
          for (const [name, axis, direction, field] of [
            ['Resize workspace chat', 'width', -1, 'chatWidth'],
            ['Resize media library', 'width', 1, 'mediaWidth'],
            ['Resize timeline', 'height', -1, 'timelineHeight'],
          ] as const) {
            const handle = page.getByRole('separator', { name, exact: true });
            await expect(handle).toBeVisible();
            const before = parseInt(
              (await handle.getAttribute('aria-valuetext'))!,
            );
            const box = (await handle.boundingBox())!;
            // Start near the primitive's physical 10px/20px target edge, beyond
            // the original 9 layout-pixel DOM hit area at Default/Small.
            const offset = input === 'touch' ? 8.5 : 4.75;
            const x = box.x + box.width / 2 + (axis === 'width' ? offset : 0),
              y = box.y + box.height / 2 + (axis === 'height' ? offset : 0);
            const endX = x + (axis === 'width' ? direction * 48 * scale : 0);
            const endY = y + (axis === 'height' ? direction * 48 * scale : 0);
            if (input === 'touch') {
              const session = await page.context().newCDPSession(page);
              await session.send('Input.dispatchTouchEvent', {
                type: 'touchStart',
                touchPoints: [{ x, y }],
              });
              for (let step = 1; step <= 6; step++)
                await session.send('Input.dispatchTouchEvent', {
                  type: 'touchMove',
                  touchPoints: [
                    {
                      x: x + ((endX - x) * step) / 6,
                      y: y + ((endY - y) * step) / 6,
                    },
                  ],
                });
              await session.send('Input.dispatchTouchEvent', {
                type: 'touchEnd',
                touchPoints: [],
              });
              await session.detach();
            } else {
              await page.mouse.move(x, y);
              await page.mouse.down();
              await page.mouse.move(endX, endY, { steps: 6 });
              await page.mouse.up();
            }
            await expect(handle).toHaveAttribute(
              'aria-valuetext',
              `${before + 48} pixels`,
            );
            await expect
              .poll(() =>
                page.evaluate(
                  (field) =>
                    JSON.parse(
                      localStorage.getItem(
                        'localcut.workspace-preferences.v1',
                      )!,
                    ).preferences[field],
                  field,
                ),
              )
              .toBe(before + 48);
          }
          const timeline = (await page.locator('.timeline').boundingBox())!;
          expect(timeline.y + timeline.height).toBeCloseTo(900, 0);
        });
      }
    }
  });
}
