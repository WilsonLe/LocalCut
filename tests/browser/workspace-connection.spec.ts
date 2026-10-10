import { openAISettings } from './workspace-settings-helper';
import { expect, test } from '@playwright/test';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
const models = Array.from({ length: 120 }, (_, index) => ({
  id: `test/model-${index}`,
  name: `Editing model ${String(index).padStart(3, '0')}`,
  context_length: 32000,
  supported_parameters: ['tools', 'tool_choice'],
}));

for (const base of ['/', '/LocalCut/']) {
  test(`mobile OpenRouter chat routes supported parameters and explains endpoint rejection ${base}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await context.route('https://openrouter.ai/api/v1/models', (route) =>
      route.fulfill({ headers: cors, json: { data: [models[0]] } }),
    );
    let requests = 0;
    let reject = false;
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ headers: cors, body: '' });
          return;
        }
        requests++;
        const body = route.request().postDataJSON();
        expect(body.model).toBe(models[0]!.id);
        expect(body.provider).toEqual({
          data_collection: 'deny',
          require_parameters: true,
        });
        expect(body.tool_choice).toBe('auto');
        // Simulate strict routing rejecting a parameter this model cannot use.
        if (reject || 'parallel_tool_calls' in body) {
          await route.fulfill({
            status: 404,
            headers: cors,
            json: {
              error: 'SECRET echoed prompt and synthetic-connection-key',
            },
          });
          return;
        }
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body: 'data: {"choices":[{"index":0,"delta":{"content":"Try a short opening montage."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        });
      },
    );
    await page.goto(base);
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
    await page
      .getByRole('menuitem', { name: 'New project', exact: true })
      .click();
    await page.getByLabel('Project name', { exact: true }).fill('Brainstorm');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await openAISettings(page);
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await dialog
      .getByLabel('OpenRouter API key', { exact: true })
      .fill('synthetic-connection-key');
    await dialog
      .getByRole('button', { name: 'Use API key', exact: true })
      .click();
    await dialog
      .getByRole('combobox', { name: 'AI model', exact: true })
      .click();
    await page.getByRole('option', { name: /Editing model 000/ }).click();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page
      .getByRole('navigation', { name: 'Workspace sections' })
      .getByRole('button', { name: 'Chat', exact: true })
      .click();
    const composer = page.getByLabel('Describe your edit', { exact: true });
    const send = page.getByRole('button', {
      name: 'Send edit request',
      exact: true,
    });
    await expect(send).toHaveCount(0);
    expect(requests).toBe(0);
    await composer.fill('Brain storm idea on the current project');
    await send.click();
    await expect(
      page.getByRole('article', { name: 'Assistant response' }),
    ).toContainText('Try a short opening montage.');
    expect(requests).toBe(1);
    reject = true;
    await composer.fill('Another idea');
    await send.click();
    await expect(
      page.getByText(
        'The selected model or endpoint is unavailable (HTTP 404). Refresh models or choose another tool-capable model.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText('SECRET');
    await expect(page.locator('body')).not.toContainText(
      'synthetic-connection-key',
    );
    expect(requests).toBe(2);
    reject = false;
    await composer.fill('Try again');
    await send.click();
    await expect(
      page.getByRole('article', { name: 'Assistant response' }).last(),
    ).toContainText('Try a short opening montage.');
    expect(requests).toBe(3);
  });
}

for (const base of ['/', '/LocalCut/']) {
  test(`compact AI connection searches the whole catalog and reveals settings progressively ${base}`, async ({
    page,
    context,
  }, testInfo) => {
    let requests = 0;
    let fail = false;
    let completions = 0;
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        completions++;
        await route.abort();
      },
    );
    await context.route(
      'https://openrouter.ai/api/v1/models',
      async (route) => {
        requests++;
        await route.fulfill(
          fail
            ? {
                status: 503,
                headers: cors,
                json: { error: 'synthetic failure' },
              }
            : {
                headers: cors,
                json: {
                  data: [
                    ...models,
                    {
                      id: 'test/no-tools',
                      name: 'Unsupported model',
                      context_length: 32000,
                      supported_parameters: [],
                    },
                  ],
                },
              },
        );
      },
    );
    await page.goto(base);
    await openAISettings(page);
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await expect(dialog).not.toContainText(
      'Your prompt and selected project metadata',
    );
    await expect(dialog).not.toContainText('Provider charges may apply');
    await dialog
      .getByLabel('OpenRouter API key', { exact: true })
      .fill('synthetic-connection-key');
    await dialog
      .getByRole('button', { name: 'Use API key', exact: true })
      .click();
    await expect(
      dialog.getByText('Key connected', { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('checkbox', { name: 'Allow asset indexing' }),
    ).not.toBeChecked();
    await expect(
      dialog.getByRole('button', { name: 'Refresh models', exact: true }),
    ).toHaveCount(0);
    const picker = dialog.getByRole('combobox', {
      name: 'AI model',
      exact: true,
    });
    await picker.click();
    const search = page.getByRole('combobox', {
      name: 'Search models',
      exact: true,
    });
    await expect(search).toBeFocused();
    await expect(
      page.getByRole('option', { name: /Unsupported model/ }),
    ).toHaveCount(0);
    await search.fill('test/model-119');
    await expect(page.getByRole('option')).toHaveCount(1);
    await search.press('ArrowDown');
    await search.press('Enter');
    await expect(picker).toContainText('Editing model 119');
    await expect(picker).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('connection.png') });
    await picker.click();
    await expect(search).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('model-search.png') });
    await search.fill('no such model');
    await expect(
      page.getByText('No matching models.', { exact: true }),
    ).toBeVisible();
    fail = true;
    await page
      .getByRole('button', { name: 'Refresh models', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(picker).toContainText('Editing model 119');
    fail = false;
    await page
      .getByRole('button', { name: 'Refresh models', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect.poll(() => requests).toBe(3);
    await search.focus();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Data & analytics', exact: true })
      .click();
    const sharing = page.getByRole('dialog', {
      name: 'Data & analytics',
      exact: true,
    });
    await expect(sharing).toBeVisible();
    for (const box of await sharing.getByRole('checkbox').all())
      await expect(box).not.toBeChecked();
    await sharing
      .getByRole('checkbox', { name: 'Share source transcripts', exact: true })
      .click();
    await expect(
      sharing.getByRole('checkbox', {
        name: 'Share source transcripts',
        exact: true,
      }),
    ).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(
      dialog.getByRole('button', { name: 'Data & analytics', exact: true }),
    ).toBeFocused();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await openAISettings(page);
    await expect(
      dialog.getByRole('combobox', { name: 'AI model', exact: true }),
    ).toContainText('Editing model 119');
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('button', { name: 'Workspace settings', exact: true }),
    ).toBeFocused();
    await openAISettings(page);
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Disconnect', exact: true })
      .click();
    await expect(
      dialog.getByLabel('OpenRouter API key', { exact: true }),
    ).toHaveValue('');
    await expect(
      dialog.getByText('Key connected', { exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByLabel('OpenRouter API key', { exact: true })
      .fill('synthetic-second-key');
    await dialog
      .getByRole('button', { name: 'Use API key', exact: true })
      .click();
    await dialog
      .getByRole('button', { name: 'Data & analytics', exact: true })
      .click();
    await expect(
      sharing.getByRole('checkbox', {
        name: 'Share source transcripts',
        exact: true,
      }),
    ).not.toBeChecked();
    expect(completions).toBe(0);
  });
  test(`AI model loading and empty catalog can refresh on a narrow viewport ${base}`, async ({
    page,
    context,
  }) => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    await context.route(
      'https://openrouter.ai/api/v1/models',
      async (route) => {
        requests++;
        if (requests === 1) await barrier;
        await route.fulfill({
          headers: cors,
          json: { data: requests === 1 ? [] : models },
        });
      },
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base);
    await openAISettings(page);
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await dialog
      .getByLabel('OpenRouter API key', { exact: true })
      .fill('synthetic-empty-key');
    await dialog
      .getByRole('button', { name: 'Use API key', exact: true })
      .click();
    await dialog
      .getByRole('combobox', { name: 'AI model', exact: true })
      .click();
    await expect(
      page.getByText('Loading models…', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Refresh models', exact: true }),
    ).toHaveCount(0);
    release();
    await expect(
      page.getByText('No models loaded. Try refreshing.', { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Refresh models', exact: true })
      .click();
    const search = page.getByRole('combobox', {
      name: 'Search models',
      exact: true,
    });
    await search.fill('119');
    const option = page.getByRole('option', {
      name: 'Editing model 119 · test/model-119',
      exact: true,
    });
    await expect(option).toBeVisible();
    const bounds = await page
      .locator('[data-slot="combobox-content"]')
      .boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await option.click();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Workspace settings', exact: true }),
    ).toBeFocused();
  });
}
