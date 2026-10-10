import { expect, test } from '@playwright/test';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
for (const base of ['/', '/LocalCut/']) {
  test(`chat readiness recovers after connecting and reloading ${base}`, async ({
    page,
    context,
  }, testInfo) => {
    let completions = 0;
    await context.route('https://openrouter.ai/api/v1/models', (route) =>
      route.fulfill({
        headers: cors,
        json: {
          data: [
            {
              id: 'test/chat',
              name: 'Chat model',
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
        completions++;
        expect(route.request().postDataJSON().model).toBe('test/chat');
        return route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Ready to edit.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
        });
      },
    );
    await page.goto(base);
    const composer = page.getByRole('textbox', {
      name: 'Describe your edit',
      exact: true,
    });
    const send = page.getByRole('button', {
      name: 'Send edit request',
      exact: true,
    });
    await expect(composer).toBeDisabled();
    await page.getByRole('button', { name: 'Connect AI', exact: true }).click();
    const settings = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await settings
      .getByLabel('OpenRouter API key', { exact: true })
      .fill('synthetic-readiness-key');
    await settings
      .getByRole('button', { name: 'Use API key', exact: true })
      .click();
    await expect(
      settings.getByText('Key connected', { exact: true }),
    ).toBeVisible();
    await settings.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(
      page.getByText('Choose an AI model to start chatting.', { exact: true }),
    ).toBeVisible();
    await expect(composer).toBeDisabled();
    await page
      .getByRole('button', { name: 'Choose AI model', exact: true })
      .click();
    await settings
      .getByRole('combobox', { name: 'AI model', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'Chat model · test/chat', exact: true })
      .click();
    await settings.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(
      page.getByText('Create or open a project to start chatting.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(send).toHaveCount(0);
    expect(completions).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath('chat-project-recovery.png'),
    });
    await page
      .getByRole('button', { name: 'Create project for chat', exact: true })
      .click();
    await page.getByLabel('Project name').fill('Chat readiness');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await expect(composer).toBeEnabled();
    await composer.fill('Hello');
    await send.click();
    await expect(
      page.getByRole('log', { name: 'Conversation messages' }),
    ).toContainText('Ready to edit.');
    expect(completions).toBe(1);
    await page.reload();
    await expect(
      page.getByText('Create or open a project to start chatting.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(settings).not.toBeVisible();
    await expect(composer).toBeDisabled();
    expect(completions).toBe(1);
    await page
      .getByRole('button', { name: 'Open project for chat', exact: true })
      .click();
    await page.getByRole('button', { name: /^Chat readiness/ }).click();
    await expect(composer).toBeEnabled();
    await composer.fill('Hello again');
    await composer.press('Enter');
    await expect(
      page.getByRole('log', { name: 'Conversation messages' }),
    ).toContainText('Ready to edit.');
    expect(completions).toBe(2);
  });
}
