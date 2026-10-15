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
test.use({ hasTouch: true });
for (const base of behaviorBases) {
  test(`chat usage popover attributes background agents and costs per request ${base}`, async ({
    page,
    context,
  }, testInfo) => {
    const firstPrompt = 'Explain the editing workflow';
    const secondPrompt = `Explain a second request with detailed editing steps, keeping the original user message available in the usage tooltip.\nInclude this reference: ${'long-reference-'.repeat(160)}\nEnd of the original user message.`;
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
        const missingCache =
          request.messages[0].content.startsWith(
            'LocalCut request contract:',
          ) &&
          JSON.parse(request.messages[1].content).initialRequest ===
            secondPrompt;
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ model: 'test/usage', choices: [{ index: 0, delta: { content: reply }, finish_reason: 'stop' }], usage: { prompt_tokens: 1200, completion_tokens: 200, total_tokens: 1400, cost: 0.002, prompt_tokens_details: { ...(missingCache ? {} : { cached_tokens: 400 }), cache_write_tokens: 100 }, completion_tokens_details: { reasoning_tokens: 50 } } })}\n\ndata: [DONE]\n\n`,
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
      .fill(firstPrompt);
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
    await expect(popover).toContainText(firstPrompt);
    await expect(popover).toContainText('Est. USD');
    await expect(popover).toContainText('Cache hit rate');
    await expect(popover).toContainText('33.33%');
    const first = popover.locator('[data-usage-request]').first();
    const detail = page.getByRole('dialog', {
      name: 'Message usage',
      exact: true,
    });
    await expect(first).toContainText(firstPrompt);
    await first.focus();
    await expect(page.getByRole('tooltip')).toHaveText(firstPrompt);
    await page.keyboard.press('Enter');
    await expect(detail).toBeVisible();
    await expect(first).toHaveAttribute('aria-expanded', 'true');
    await expect(detail).toContainText(firstPrompt);
    await expect(detail).toContainText('Main agent');
    await expect(detail).toContainText('Goal agent');
    await expect(detail).toContainText('To-do agent');
    await expect(detail).toContainText('Review agent');
    await expect(popover).not.toContainText('Main agent');
    await expect(popover.locator('details, summary')).toHaveCount(0);
    await expect(detail.locator('details, summary')).toHaveCount(0);
    const beforeTitle = completed;
    await expect(first).toContainText(`$${(beforeTitle * 0.002).toFixed(6)}`);
    const main = detail.getByRole('region', {
      name: 'Main agent',
      exact: true,
    });
    await expect(main).toContainText('Input cache');
    await expect(main).toContainText('Cache hit rate');
    await expect(main).toContainText('33.33%');
    await expect(main).toContainText('$0.000160'); // two main requests, cached input at the saved rate
    await page.keyboard.press('Escape');
    await expect(detail).not.toBeVisible();
    await expect(popover).toBeVisible();
    await expect(first).toBeFocused();
    await page.keyboard.press('Space');
    await expect(detail).toBeVisible();
    await detail.getByRole('button', { name: 'Close message usage' }).click();
    await expect(detail).not.toBeVisible();
    await expect(first).toBeFocused();
    // Focus return reveals the existing message tooltip; Escape dismisses it first.
    await expect(page.getByRole('tooltip')).toHaveText(firstPrompt);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).not.toBeVisible();
    await expect(popover).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await page
      .getByLabel('Describe your edit', { exact: true })
      .fill(secondPrompt);
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
    const newestSummary = requests.first();
    await expect(newestSummary).toContainText(secondPrompt);
    await expect(requests.last()).toContainText(firstPrompt);
    const messageLabel = newestSummary.locator('.truncate');
    const expectTruncated = async () => {
      const size = await messageLabel.evaluate((element) => ({
        client: element.clientWidth,
        scroll: element.scrollWidth,
        overflow: getComputedStyle(element).textOverflow,
      }));
      expect(size.scroll).toBeGreaterThan(size.client);
      expect(size.overflow).toBe('ellipsis');
    };
    await expectTruncated();
    await messageLabel.hover();
    await expect(
      page.getByRole('tooltip').filter({ hasText: secondPrompt }),
    ).toHaveText(secondPrompt);
    const tooltipBox = (await page.getByRole('tooltip').boundingBox())!;
    expect(tooltipBox.width).toBeLessThanOrEqual(256);
    expect(tooltipBox.y).toBeGreaterThanOrEqual(0);
    expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(
      page.viewportSize()!.height,
    );
    const fullMessage = page.getByRole('tooltip').locator('span');
    expect(
      await fullMessage.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);
    const expectScrolledToEnd = async () => {
      await expect
        .poll(() =>
          fullMessage.evaluate(
            (element) =>
              element.scrollHeight - element.clientHeight - element.scrollTop,
          ),
        )
        .toBeLessThanOrEqual(1);
    };
    await fullMessage.hover();
    await page.mouse.wheel(0, 10000);
    await expectScrolledToEnd();
    await fullMessage.evaluate((element) => {
      element.scrollTop = 0;
    });
    await fullMessage.focus();
    await page.keyboard.press('End');
    await expectScrolledToEnd();
    await testInfo.attach('usage-message-tooltip', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await requests.last().click();
    await expect(detail).toContainText('Chat title');
    await expect(requests.last()).toContainText(
      `$${((beforeTitle + 1) * 0.002).toFixed(6)}`,
    );
    await newestSummary.click();
    await expect(
      page.getByRole('dialog', { name: 'Message usage' }),
    ).toHaveCount(1);
    await expect(detail).toContainText(secondPrompt);
    await expect(detail).not.toContainText('Chat title');
    await expect(requests.last()).toHaveAttribute('aria-expanded', 'false');
    const expectBounds = async (popup: typeof popover) => {
      const box = (await popup.boundingBox())!;
      const viewport = page.viewportSize()!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    };
    await expectBounds(popover);
    await expectBounds(detail);
    await testInfo.attach('usage-popover-desktop', {
      body: await page.screenshot({
        path: testInfo.outputPath('usage-popover-desktop.png'),
      }),
      contentType: 'image/png',
    });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    const callsBeforeReload = sent;
    await page.reload();
    await trigger.click();
    await expect(detail).not.toBeVisible();
    await expect(popover).toContainText(`$${(completed * 0.002).toFixed(6)}`);
    expect(sent).toBe(callsBeforeReload);
    await expect(
      popover
        .getByText('Cache hit rate', { exact: true })
        .first()
        .locator('..'),
    ).toContainText('Unavailable');
    await expect(popover.locator('[data-usage-request]')).toHaveCount(2);
    await expect(newestSummary).toContainText(secondPrompt);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await trigger.click();
    await expect(popover).toBeVisible();
    await expectTruncated();
    await newestSummary.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(newestSummary).toBeFocused();
    await expect(
      page.getByRole('tooltip').filter({ hasText: secondPrompt }),
    ).toHaveText(secondPrompt);
    await page.keyboard.press('Enter');
    await expect(detail).toBeVisible();
    await expectBounds(popover);
    await expectBounds(detail);
    const original = detail.getByLabel('Original message');
    await original.focus();
    await page.keyboard.press('End');
    await expect
      .poll(() =>
        original.evaluate(
          (element) =>
            element.scrollHeight - element.clientHeight - element.scrollTop,
        ),
      )
      .toBeLessThanOrEqual(1);
    await detail
      .getByRole('region', { name: 'Review agent', exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      detail.getByRole('button', { name: 'Close message usage' }),
    ).toBeInViewport();
    await expectBounds(detail);
    await testInfo.attach('usage-popover-mobile', {
      body: await page.screenshot({
        path: testInfo.outputPath('usage-popover-mobile.png'),
      }),
      contentType: 'image/png',
    });
    await page.keyboard.press('Escape');
    await expect(newestSummary).toBeFocused();
    await newestSummary.tap();
    await expect(detail).toBeVisible();
    await trigger.tap();
    await expect(popover).not.toBeVisible();
    await expect(detail).not.toBeVisible();
    await trigger.tap();
    await expect(popover).toBeVisible();
    await expect(detail).not.toBeVisible();
    expect(sent).toBe(callsBeforeReload);
  });
}
