import { openAISettings } from './workspace-settings-helper';
import { test, expect } from '@playwright/test';

for (const base of ['/', '/LocalCut/']) {
  test(
    '@journey ' +
      [
        `chat picker matches control heights and reuses empty chats ${base}`,
        `new chat preserves drafts and sent conversations while reusing unused sessions ${base}`,
      ].join(' | '),
    async ({ page, context }, testInfo) => {
      await test.step(`chat picker matches control heights and reuses empty chats ${base}`, async () => {
        await page.goto(base);
        await expect(page.locator('.chat-provider-empty')).toBeVisible();
        await expect(page.locator('.chat-composer')).toHaveCount(0);
        const trigger = page.getByRole('button', {
          name: 'Chat sessions',
          exact: true,
        });
        for (let click = 0; click < 4; click++) {
          await trigger.click();
          const search = page.getByRole('textbox', {
            name: 'Search sessions by title',
            exact: true,
          });
          const plus = page.getByRole('menuitem', {
            name: 'New conversation',
            exact: true,
          });
          const inputBox = await search.boundingBox();
          const plusBox = await plus.boundingBox();
          expect(inputBox).not.toBeNull();
          expect(plusBox).not.toBeNull();
          expect(plusBox!.height).toBe(inputBox!.height);
          expect(plusBox!.width).toBe(plusBox!.height);
          await expect(page.getByRole('menuitemradio')).toHaveCount(1);
          await plus.click();
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page
          .getByRole('navigation', { name: 'Workspace sections' })
          .getByRole('button', { name: 'Chat', exact: true })
          .click();
        await expect(page.locator('#editor-panel')).toBeHidden();
        await trigger.click();
        const popup = page.getByRole('menu', {
          name: 'Chat sessions',
          exact: true,
        });
        await expect(popup).toBeVisible();
        await expect(page.getByRole('menuitemradio')).toHaveCount(1);
        await page.screenshot({
          path: testInfo.outputPath('chat-controls-narrow.png'),
        });
      });
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 1280, height: 720 });
      await test.step(`new chat preserves drafts and sent conversations while reusing unused sessions ${base}`, async () => {
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
          (route) =>
            route.fulfill(
              route.request().method() === 'OPTIONS'
                ? { headers: cors, body: '' }
                : {
                    headers: cors,
                    contentType: 'text/event-stream',
                    body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Ready to edit.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
                  },
            ),
        );
        // Continue in the already-open app.
        await page
          .getByRole('button', { name: 'Workspace settings', exact: true })
          .click();
        await page
          .getByRole('menuitem', { name: 'Project', exact: true })
          .click();
        await page
          .getByRole('menuitem', { name: 'New project', exact: true })
          .click();
        await page.getByLabel('Project name').fill('Chat controls');
        await page.getByRole('button', { name: 'Create project' }).click();
        await openAISettings(page);
        const settings = page.getByRole('dialog', {
          name: 'AI connection',
          exact: true,
        });
        await settings
          .getByLabel('OpenRouter API key')
          .fill('synthetic-chat-controls-key');
        await settings.getByRole('button', { name: 'Use API key' }).click();
        await settings
          .getByRole('combobox', { name: 'AI model', exact: true })
          .click();
        await page
          .getByRole('option', { name: 'Chat model · test/chat', exact: true })
          .click();
        await settings.getByRole('button', { name: 'Done' }).click();
        const composer = page.getByRole('textbox', {
          name: 'Describe your edit',
          exact: true,
        });
        const trigger = page.getByRole('button', {
          name: 'Chat sessions',
          exact: true,
        });
        const rows = page.getByRole('menuitemradio');
        const create = async () => {
          await trigger.click();
          await page
            .getByRole('menuitem', { name: 'New conversation', exact: true })
            .click();
        };
        await expect(page.locator('.chat-composer:visible')).toHaveCSS(
          'border-radius',
          '8px',
        );
        await composer.fill('Draft to keep');
        await create();
        await expect(composer).toHaveValue('');
        const focusComposer = async () => {
          await page
            .getByRole('button', { name: 'Commands', exact: true })
            .click();
          const palette = page.getByRole('dialog', {
            name: 'Commands',
            exact: true,
          });
          await palette.getByRole('combobox').fill('Describe an edit');
          await palette.getByRole('combobox').press('Enter');
          await expect(palette).not.toBeVisible();
          await expect(composer).toBeFocused();
        };
        // Session zero retains a hidden composer; target the selected session instead.
        await focusComposer();
        await page
          .getByRole('button', { name: 'Collapse chat', exact: true })
          .click();
        await focusComposer();
        await expect(composer).toHaveValue('');
        await create();
        await trigger.click();
        await expect(rows).toHaveCount(2);
        await rows.nth(0).click();
        await expect(composer).toHaveValue('Draft to keep');
        // Plus selects the existing unused session even when another chat is active.
        await create();
        await expect(composer).toHaveValue('');
        // A sent chat whose literal title is "New chat" is still an occupied chat.
        await composer.fill('New chat');
        await composer.press('Enter');
        const log = page.getByRole('log', {
          name: 'Conversation messages',
          exact: true,
        });
        await expect(log).toContainText('Ready to edit.');
        await create();
        await expect(composer).toHaveValue('');
        await create();
        await trigger.click();
        await expect(rows).toHaveCount(3);
        await rows.nth(1).click();
        await expect(log).toContainText('New chat');
        await expect(log).toContainText('Ready to edit.');
        await trigger.click();
        await rows.nth(0).click();
        await expect(composer).toHaveValue('Draft to keep');
        // Clearing a draft makes that chat reusable again.
        await composer.fill('');
        await create();
        await trigger.click();
        await expect(rows).toHaveCount(3);
        await expect(rows.nth(0)).toHaveAttribute('aria-checked', 'true');
        await page.screenshot({
          path: testInfo.outputPath('chat-controls-connected.png'),
        });
      });
    },
  );
}
