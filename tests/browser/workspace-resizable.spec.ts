import { test, expect } from '@playwright/test';
import { behaviorBases } from './coverage-bases';

for (const base of behaviorBases) {
  test(`editor and media resize, persist and synchronize without a chat panel ${base}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base);
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    const media = page.locator('#media-panel');
    const handle = page.getByRole('separator', {
      name: 'Resize media library',
      exact: true,
    });
    await expect(handle).toBeVisible();
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(async () => Math.round((await media.boundingBox())!.width))
      .toBe(316);
    const bounds = (await handle.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 80);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 70, bounds.y + 80, { steps: 10 });
    await page.mouse.up();
    const savedWidth = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('localcut.workspace-preferences.v1')!)
          .preferences.mediaWidth as number,
    );
    expect(savedWidth).toBeGreaterThan(350);
    const editor = (await page.locator('#editor-panel').boundingBox())!;
    expect(editor.x + editor.width).toBeGreaterThan(1435);
    await page.reload();
    await expect
      .poll(async () => Math.round((await media.boundingBox())!.width))
      .toBe(savedWidth);
    const second = await context.newPage();
    try {
      await second.goto(base);
      await page
        .getByRole('button', { name: 'Collapse media', exact: true })
        .click();
      await expect(
        second.getByRole('button', { name: 'Expand media', exact: true }),
      ).toBeVisible();
      await expect
        .poll(async () =>
          Math.round(
            (await second.locator('#media-panel').boundingBox())!.width,
          ),
        )
        .toBe(52);
    } finally {
      await second.close();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const nav = page.getByRole('navigation', { name: 'Workspace sections' });
    await nav
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    await expect(
      page.getByRole('region', { name: 'Project media' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      nav.getByRole('button', { name: 'Expand media', exact: true }),
    ).toBeFocused();
    await expect(
      nav.getByRole('button', { name: 'Edit', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

for (const input of ['mouse', 'touch'] as const) {
  test.describe(`${input} expanded divider targets`, () => {
    test.use({ hasTouch: input === 'touch' });
    for (const base of behaviorBases) {
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
