import { expect, test } from '@playwright/test';

test('chat resize controls match responsive layout and report actual desktop width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 850, height: 900 });
  await page.goto('/LocalCut/');
  const handle = page.locator(
    '[role="separator"][aria-label="Resize workspace chat"]',
  );
  for (const width of [850, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(handle).toBeHidden();
    await expect(
      page.getByRole('separator', { name: 'Resize workspace chat' }),
    ).toHaveCount(0);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(handle).toBeVisible();
  const panel = page.getByRole('complementary', {
    name: 'Editing conversation',
    exact: true,
  });
  await expect
    .poll(async () => Math.round((await panel.boundingBox())!.width))
    .toBe(320);
  const before = Number(await handle.getAttribute('aria-valuenow'));
  await handle.focus();
  await handle.press('ArrowRight');
  await expect
    .poll(async () => Math.round((await panel.boundingBox())!.width))
    .toBe(before + 16);
  await expect(handle).toHaveAttribute('aria-valuenow', String(before + 16));
  const min = Number(await handle.getAttribute('aria-valuemin'));
  const max = Number(await handle.getAttribute('aria-valuemax'));
  expect(before + 16).toBeGreaterThanOrEqual(min);
  expect(before + 16).toBeLessThanOrEqual(max);
  await handle.press('Home');
  await expect
    .poll(async () => Math.round((await panel.boundingBox())!.width))
    .toBe(min);
  await expect(handle).toHaveAttribute('aria-valuenow', String(min));
  await handle.press('End');
  await expect
    .poll(async () => Math.round((await panel.boundingBox())!.width))
    .toBe(max);
  await expect(handle).toHaveAttribute('aria-valuenow', String(max));
});

for (const base of ['/', '/LocalCut/']) {
  test(`workspace keeps metadata quiet, project forms spacious and media on the right ${base}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base);
    for (const copy of [
      'Local media · Private by default',
      'No project open',
      'No AI provider connected. Manual editing is available.',
      'Describe the cut you want.',
      'On this device',
      '30 fps',
      '16:9 · 1080p',
    ]) {
      await expect(page.getByText(copy, { exact: true })).toHaveCount(0);
    }
    await expect(
      page.getByRole('button', { name: 'Connect AI', exact: true }),
    ).toHaveCount(1);
    await expect(
      page
        .locator('header.workspace-header')
        .getByRole('button', { name: 'Media', exact: true }),
    ).toHaveCount(0);
    const previewInfo = page.getByRole('button', { name: 'Preview settings' });
    await previewInfo.focus();
    await expect(page.getByRole('tooltip')).toContainText(
      '1920 × 1080 · 30 fps',
    );
    await page
      .getByRole('button', { name: 'New project', exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'New project',
      exact: true,
    });
    const spacing = await dialog.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const field = element.querySelector('input')!.getBoundingClientRect();
      const label = element.querySelector('label')!.getBoundingClientRect();
      const footer = element
        .querySelector('[data-slot="dialog-footer"]')!
        .getBoundingClientRect();
      return {
        padding: field.left - box.left,
        labelGap: field.top - label.bottom,
        footerGap: footer.top - field.bottom,
      };
    });
    expect(spacing.padding).toBeGreaterThanOrEqual(24);
    expect(spacing.labelGap).toBeGreaterThanOrEqual(10);
    expect(spacing.footerGap).toBeGreaterThanOrEqual(24);
    await dialog.getByLabel('Project name').fill('Polished workspace');
    await dialog.getByRole('button', { name: 'Create project' }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole('button', { name: 'Expand media' }).click();
    const media = page.getByRole('complementary', {
      name: 'Media library',
      exact: true,
    });
    await expect(
      media.getByRole('button', { name: 'Import media', exact: true }),
    ).toBeVisible();
    const editor = page.getByRole('main', { name: 'Video editor' });
    await expect
      .poll(
        async () =>
          (await media.boundingBox())!.x -
          ((await editor.boundingBox())!.x +
            (await editor.boundingBox())!.width),
      )
      .toBeCloseTo(0, 0);
    await page.getByRole('button', { name: 'Collapse media' }).click();
    await expect(
      media.getByRole('button', { name: 'Import media', exact: true }),
    ).toBeHidden();
    await page.setViewportSize({ width: 768, height: 900 });
    await page.getByRole('button', { name: 'Expand media' }).click();
    const properties = page.getByRole('button', {
      name: 'Clip properties',
      exact: true,
    });
    await expect(properties).toBeVisible();
    await expect
      .poll(async () => {
        const action = (await properties.boundingBox())!;
        const area = (await editor.boundingBox())!;
        return (
          action.x >= area.x && action.x + action.width <= area.x + area.width
        );
      })
      .toBe(true);
    await page.getByRole('button', { name: 'Collapse media' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Expand media' }).click();
    await expect(media).toBeInViewport();
    await expect(
      media.getByRole('button', { name: 'Import media', exact: true }),
    ).toBeVisible();
    const bounds = (await media.boundingBox())!;
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Collapse media' }).click();
    await expect(
      page.getByRole('button', { name: 'Expand media' }),
    ).toBeInViewport();
  });
}

test('CYOBot chat structure keeps local sessions, markdown, drafts and keyboard resizing', async ({
  page,
  context,
}) => {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  };
  await context.route('https://openrouter.ai/api/v1/models', (route) =>
    route.fulfill({
      headers: cors,
      json: {
        data: [
          {
            id: 'test/structure',
            name: 'Structure model',
            context_length: 32000,
            supported_parameters: ['tools', 'tool_choice'],
          },
        ],
      },
    }),
  );
  let remoteImage = 0;
  await context.route('https://example.com/untrusted.png', (route) => {
    remoteImage++;
    return route.abort();
  });
  await context.route(
    'https://openrouter.ai/api/v1/chat/completions',
    (route) =>
      route.fulfill(
        route.request().method() === 'OPTIONS'
          ? { headers: cors, body: '' }
          : {
              headers: cors,
              contentType: 'text/event-stream',
              body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '# Edit notes\n\nUse **shorter cuts**.\n\n- Keep the subject\n- Preserve sound\n\n![reference](https://example.com/untrusted.png)\n\n<script>window.bad=true</script>' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
            },
      ),
  );
  await page.goto('/LocalCut/');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name').fill('Chat structure');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Connect AI', exact: true }).click();
  const settings = page.getByRole('dialog', {
    name: 'AI connection',
    exact: true,
  });
  await settings
    .getByLabel('OpenRouter API key')
    .fill('synthetic-structure-key');
  await settings.getByRole('button', { name: 'Use API key' }).click();
  await settings
    .getByRole('combobox', { name: 'AI model', exact: true })
    .click();
  await page
    .getByRole('option', {
      name: 'Structure model · test/structure',
      exact: true,
    })
    .click();
  await settings.getByRole('button', { name: 'Done' }).click();
  const composer = page.getByRole('textbox', {
    name: 'Describe your edit',
    exact: true,
  });
  await composer.fill('First chat');
  await composer.press('Shift+Enter');
  await expect(composer).toHaveValue('First chat\n');
  await composer.press('Enter');
  const log = page.getByRole('log', {
    name: 'Conversation messages',
    exact: true,
  });
  await expect(log.getByRole('heading', { name: 'Edit notes' })).toBeVisible();
  await expect(log.locator('strong')).toHaveText('shorter cuts');
  await expect(log.getByRole('listitem')).toHaveCount(2);
  expect(remoteImage).toBe(0);
  expect(await page.evaluate(() => 'bad' in window)).toBe(false);
  await composer.fill('Draft to retain');
  await page
    .getByRole('button', { name: 'Chat sessions', exact: true })
    .click();
  await page
    .getByRole('menuitem', { name: 'New conversation', exact: true })
    .click();
  await expect(composer).toHaveValue('');
  await expect(log).not.toContainText('First chat');
  await page
    .getByRole('button', { name: 'Chat sessions', exact: true })
    .click();
  await page
    .getByRole('menuitemradio', { name: 'First chat', exact: true })
    .click();
  await expect(composer).toHaveValue('Draft to retain');
  await expect(log).toContainText('First chat');
  const resize = page.getByRole('separator', { name: 'Resize workspace chat' });
  await resize.focus();
  const before = Number(await resize.getAttribute('aria-valuenow'));
  await resize.press('ArrowRight');
  await expect
    .poll(async () => Number(await resize.getAttribute('aria-valuenow')))
    .toBe(before + 16);
  await page.getByRole('button', { name: 'Collapse chat' }).click();
  await page.getByRole('button', { name: 'Expand chat' }).click();
  await expect(composer).toHaveValue('Draft to retain');
});
