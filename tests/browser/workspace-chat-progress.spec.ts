import { scriptedDocumentReply } from '../goal-review-fixture';
import { test, expect } from '@playwright/test';
import { behaviorBases } from './coverage-bases';
import { fulfillChatTitle } from './chat-title-fixture';
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
  test(`chat streams auxiliary drafts with glowing thinking text ${base}`, async ({
    page,
    context,
  }, testInfo) => {
    await context.route('https://openrouter.ai/api/v1/models', (route) =>
      route.fulfill({
        headers: cors,
        json: {
          data: [
            {
              id: 'test/progress',
              name: 'Progress model',
              context_length: 512000,
              top_provider: { max_completion_tokens: 512000 },
              supported_parameters: ['tools', 'tool_choice'],
            },
          ],
        },
      }),
    );
    let requests = 0;
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ headers: cors, body: '' });
          return;
        }
        requests++;
        const request = route.request().postDataJSON();
        const instruction = request.messages[0].content;
        if (
          !instruction.startsWith('LocalCut request contract:') &&
          !instruction.startsWith('LocalCut session to-dos:') &&
          !instruction.startsWith('LocalCut completion review:') &&
          (await fulfillChatTitle(route))
        )
          return;
        const data = JSON.parse(
          instruction.startsWith('LocalCut ')
            ? request.messages[1].content
            : request.messages.at(-1).content,
        );
        const content = instruction.startsWith('LocalCut request contract:')
          ? '## Goal\nExplain the editing workflow.\n## Success conditions\n- Answer the question.\n## Stop conditions\n- None'
          : instruction.startsWith('LocalCut session to-dos:')
            ? `## To-dos\n- [${data.conversation?.some((message: { role: string }) => message.role === 'assistant') ? 'x' : ' '}] Answer the question with supported information.`
            : instruction.startsWith('LocalCut completion review:')
              ? 'The answer explains the workflow and needs no project changes.'
              : 'Import footage into Media, then place it on the timeline to edit.';
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: scriptedDocumentReply(request, content) }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
        });
      },
    );
    // Split the first response of each auxiliary stage at a deterministic gate.
    // Real provider parsing and production assistant events still run in Chrome.
    await page.addInitScript(() => {
      const original = window.fetch.bind(window);
      const seen = new Set<string>();
      const gates: Record<string, () => void> = {};
      Object.assign(window, {
        releaseReview: (name: string) => gates[name]?.(),
        pendingReviews: () => Object.keys(gates),
      });
      window.fetch = async (...args) => {
        const response = await original(...args);
        if (!String(args[0]).includes('/chat/completions') || !args[1]?.body)
          return response;
        const request = JSON.parse(String(args[1].body));
        const instruction = request.messages?.[0]?.content ?? '';
        const name = instruction.startsWith('LocalCut request contract:')
          ? 'request_contract'
          : instruction.startsWith('LocalCut session to-dos:')
            ? 'session_todos'
            : instruction.startsWith('LocalCut completion review:')
              ? 'completion_check'
              : '';
        if (!name || seen.has(name)) return response;
        seen.add(name);
        const raw = await response.text();
        const frame = JSON.parse(raw.split('\n')[0]!.slice(6));
        const text: string = frame.choices[0].delta.content;
        const cut = Math.floor(text.length / 2);
        const encode = (content: string, finish: boolean) =>
          new TextEncoder().encode(
            `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: finish ? 'stop' : null }] })}\n\n${finish ? 'data: [DONE]\n\n' : ''}`,
          );
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encode(text.slice(0, cut), false));
              gates[name] = () => {
                controller.enqueue(encode(text.slice(cut), true));
                controller.close();
                delete gates[name];
              };
            },
            cancel() {
              delete gates[name];
            },
          }),
          { headers: response.headers },
        );
      };
    });
    await page.goto(base);
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
    await page
      .getByRole('menuitem', { name: 'New project', exact: true })
      .click();
    await page.getByLabel('Project name').fill('Streaming progress');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await openAISettings(page);
    await prepareOpenRouterKey(page);
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await dialog
      .getByLabel('OpenRouter API key')
      .fill('synthetic-progress-key');
    await dialog.getByRole('button', { name: 'Use API key' }).click();
    await selectAISettingsTab(page, 'LLM - Chat');
    await dialog
      .getByRole('combobox', { name: 'AI model', exact: true })
      .click();
    await page
      .getByRole('option', {
        name: 'Progress model · test/progress',
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
    const article = page
      .getByRole('article', { name: 'Assistant response' })
      .last();
    const goal = article.locator('[data-chat-review-draft="request_contract"]');
    await expect(goal).toContainText('Explain the editing workflow.');
    await expect(article.locator('[data-chat-response-text]')).toHaveCount(0);
    await expect(
      article.locator('svg.animate-spin, svg.motion-safe\\:animate-spin'),
    ).toHaveCount(0);
    const glow = article.locator('.chat-thinking-glow').last();
    await expect(glow).toHaveCSS('display', 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(glow).toHaveCSS('animation-name', 'chat-thinking-glow');
    const before = await glow.evaluate(
      (element) => getComputedStyle(element).backgroundPositionX,
    );
    await expect
      .poll(() =>
        glow.evaluate(
          (element) => getComputedStyle(element).backgroundPositionX,
        ),
      )
      .not.toBe(before);
    await page.screenshot({ path: testInfo.outputPath('goal-streaming.png') });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() =>
      (
        window as unknown as { releaseReview: (name: string) => void }
      ).releaseReview('request_contract'),
    );
    await expect(goal).toHaveCount(0);
    const todos = article.locator('[data-chat-review-draft="session_todos"]');
    await expect(todos).toContainText('Answer the');
    await page.evaluate(() =>
      (
        window as unknown as { releaseReview: (name: string) => void }
      ).releaseReview('session_todos'),
    );
    const review = article.locator(
      '[data-chat-review-draft="completion_check"]',
    );
    await expect(review).toContainText('The answer explains');
    await expect(article.locator('[data-chat-response-text]')).toHaveText(
      'Import footage into Media, then place it on the timeline to edit.',
    );
    await page.evaluate(() =>
      (
        window as unknown as { releaseReview: (name: string) => void }
      ).releaseReview('completion_check'),
    );
    await expect(article.locator('[data-chat-review-draft]')).toHaveCount(0);
    await expect(article.locator('.chat-thinking')).toHaveCount(0);
    await expect(
      article.getByRole('button', { name: 'Completion reviewed · 1' }),
    ).toBeVisible();
    const settled = requests;
    await page.reload();
    await expect(
      page.getByRole('article', { name: 'Assistant response' }).last(),
    ).toContainText('Import footage into Media');
    expect(requests).toBe(settled);
    await expect(page.locator('[data-chat-review-draft]')).toHaveCount(0);

    // A delayed auxiliary session can be cancelled without publishing its tail
    // or overwriting the earlier accepted goal after navigation/reload.
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('navigation', { name: 'Workspace sections' })
      .getByRole('button', { name: 'Chat', exact: true })
      .click();
    await page
      .getByLabel('Describe your edit', { exact: true })
      .fill('Explain it again');
    await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .click();
    const stopped = page
      .getByRole('article', { name: 'Assistant response' })
      .last();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as unknown as { pendingReviews: () => string[] }
          ).pendingReviews(),
        ),
      )
      .toContain('request_contract');
    // Existing-document edits stay private until the entire envelope validates.
    await expect(stopped.locator('[data-chat-review-draft]')).toHaveCount(0);
    const mobileThinking = stopped.locator('.chat-thinking').last();
    await expect(mobileThinking).toBeVisible();
    expect(
      await mobileThinking.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('mobile-goal-update.png'),
    });
    await page
      .getByRole('button', { name: 'Cancel response', exact: true })
      .click();
    await expect(stopped).toContainText('Stopped');
    await page.evaluate(() =>
      (
        window as unknown as { releaseReview: (name: string) => void }
      ).releaseReview('request_contract'),
    );
    await expect(stopped.locator('[data-chat-review-draft]')).toHaveCount(0);
    await expect(stopped.locator('.chat-thinking')).toHaveCount(0);
    await expect(stopped.locator('[data-chat-response-text]')).toHaveCount(0);
  });
}
