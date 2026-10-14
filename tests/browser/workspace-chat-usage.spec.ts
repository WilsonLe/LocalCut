import { test, expect } from '@playwright/test';
import { behaviorBases } from './coverage-bases';
import { goalReviewReply } from '../goal-review-fixture';
import {
  openAISettings,
  prepareOpenRouterKey,
  selectAISettingsTab,
} from './workspace-settings-helper';
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
for (const base of behaviorBases) {
  test(`chat usage popover attributes background agents and costs per request ${base}`, async ({
    page,
    context,
  }, testInfo) => {
    await context.route('https://openrouter.ai/api/v1/models', (route) =>
      route.fulfill({
        headers: cors,
        json: {
          data: [
            {
              id: 'test/usage',
              name: 'Usage model',
              context_length: 10000,
              supported_parameters: ['tools', 'tool_choice'],
              pricing: {
                prompt: '0.000002',
                completion: '0.000004',
                input_cache_read: '0.0000002',
                input_cache_write: '0.0000025',
              },
            },
          ],
        },
      }),
    );
    let releaseTitle: (() => void) | undefined;
    let completed = 0;
    let sent = 0;
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ headers: cors, body: '' });
          return;
        }
        sent++;
        const request = route.request().postDataJSON();
        const title = request.messages[0].content.startsWith(
          'Name this video-editing chat',
        );
        if (title)
          await new Promise<void>((resolve) => {
            releaseTitle = resolve;
          });
        const reply = title
          ? 'Usage chat'
          : (goalReviewReply(request)?.content ?? 'Workflow answer.');
        completed++;
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ model: 'test/usage', choices: [{ index: 0, delta: { content: reply }, finish_reason: 'stop' }], usage: { prompt_tokens: 1200, completion_tokens: 200, total_tokens: 1400, cost: 0.002, prompt_tokens_details: { cached_tokens: 400, cache_write_tokens: 100 }, completion_tokens_details: { reasoning_tokens: 50 } } })}\n\ndata: [DONE]\n\n`,
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
    await page.getByLabel('Project name').fill('Usage accounting');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await openAISettings(page);
    await prepareOpenRouterKey(page);
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await dialog.getByLabel('OpenRouter API key').fill('synthetic-usage-key');
    await dialog.getByRole('button', { name: 'Use API key' }).click();
    await selectAISettingsTab(page, 'LLM - Chat');
    await dialog
      .getByRole('combobox', { name: 'AI model', exact: true })
      .click();
    await page
      .getByRole('option', {
        name: 'Usage model · test/usage',
        exact: true,
      })
      .click();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page
      .getByLabel('Describe your edit', { exact: true })
      .fill('Explain the editing workflow');
    await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Cancel response', exact: true }),
    ).toHaveCount(0);
    const trigger = page.getByRole('button', {
      name: 'Context and costs',
      exact: true,
    });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const popover = page.getByRole('dialog', {
      name: 'Context and costs',
      exact: true,
    });
    await expect(popover).toBeVisible();
    await expect(popover).toContainText('1,200 / 10,000 · 12.0%');
    await expect(popover).not.toContainText('Latest completed main prompt');
    await expect(popover).not.toContainText('Totals are provider-reported');
    await expect(popover).not.toContainText('Explain the editing workflow');
    await expect(popover).toContainText('Est. USD');
    const first = popover.locator('[data-usage-request]').first();
    await first.locator(':scope > summary').click();
    await expect(first).toContainText('Main agent');
    await expect(first).toContainText('Goal agent');
    await expect(first).toContainText('To-do agent');
    await expect(first).toContainText('Review agent');
    const beforeTitle = completed;
    await expect(first.locator(':scope > summary')).toContainText(
      `$${(beforeTitle * 0.002).toFixed(6)}`,
    );
    const main = first
      .locator('details')
      .filter({ has: page.locator('summary', { hasText: 'Main agent' }) });
    await main.locator('summary').click();
    await expect(main).toContainText('Input cache');
    await expect(main).toContainText('$0.000160'); // two main requests, cached input at the saved rate
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await page
      .getByLabel('Describe your edit', { exact: true })
      .fill('Explain a second request');
    await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Cancel response', exact: true }),
    ).toHaveCount(0);
    releaseTitle!();
    await expect.poll(() => completed).toBe(sent);
    await trigger.click();
    const requests = popover.locator('[data-usage-request]');
    await expect(requests).toHaveCount(2);
    await expect(popover).not.toContainText('Explain a second request');
    await requests.last().locator(':scope > summary').click();
    await expect(requests.last()).toContainText('Chat title');
    await expect(requests.last().locator(':scope > summary')).toContainText(
      `$${((beforeTitle + 1) * 0.002).toFixed(6)}`,
    );
    await expect(requests.first()).not.toContainText('Chat title');
    await testInfo.attach('usage-popover-desktop', {
      body: await popover.screenshot({
        path: testInfo.outputPath('usage-popover-desktop.png'),
      }),
      contentType: 'image/png',
    });
    await page.keyboard.press('Escape');
    const callsBeforeReload = sent;
    await page.reload();
    await trigger.click();
    await expect(popover).toContainText(`$${(completed * 0.002).toFixed(6)}`);
    expect(sent).toBe(callsBeforeReload);
    await expect(popover.locator('[data-usage-request]')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await trigger.click();
    await expect(popover).toBeVisible();
    const box = (await popover.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    await testInfo.attach('usage-popover-mobile', {
      body: await popover.screenshot(),
      contentType: 'image/png',
    });
  });
}
