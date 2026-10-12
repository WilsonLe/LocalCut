import { closeMediaImport } from './workspace-import-helper';
import { dismissNotifications } from './workspace-notifications-helper';
import { expect, test } from '@playwright/test';
import {
  prepareOpenRouterKey,
  openAISettings,
} from './workspace-settings-helper';
import type { BrowserContext, Page } from '@playwright/test';
const model = 'test/chat-improvements';
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
async function setup(page: Page, context: BrowserContext, base: string) {
  await context.route('https://openrouter.ai/api/v1/models**', (route) =>
    route.fulfill({
      headers: cors,
      json: {
        data: [
          {
            id: model,
            name: 'Chat test',
            context_length: 512000,
            supported_parameters: ['tools', 'tool_choice'],
          },
        ],
      },
    }),
  );
  await page.goto(base);
  await page
    .getByRole('button', { name: 'Workspace settings', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
  await page
    .getByRole('menuitem', { name: 'New project', exact: true })
    .click();
  await page
    .getByLabel('Project name', { exact: true })
    .fill('Chat improvements');
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'New project', exact: true }),
  ).not.toBeVisible();
  await openAISettings(page);
  const settings = page.getByRole('dialog', {
    name: 'AI connection',
    exact: true,
  });
  await prepareOpenRouterKey(page);
  await settings
    .getByLabel('OpenRouter API key', { exact: true })
    .fill('synthetic-chat-key');
  await settings
    .getByRole('button', { name: 'Use API key', exact: true })
    .click();
  await settings
    .getByRole('combobox', { name: 'AI model', exact: true })
    .click();
  await page
    .getByRole('option', { name: `Chat test · ${model}`, exact: true })
    .click();
  await settings.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Expand media', exact: true }).click();
}
for (const base of ['/', '/LocalCut/']) {
  test(`chat title runs asynchronously once with animated scoped replacement ${base}`, async ({
    page,
    context,
  }, testInfo) => {
    const naming: {
      model: string;
      tools: unknown[];
      messages: { role: string; content: string }[];
    }[] = [];
    const pending: (() => void)[] = [];
    const reply = (text: string) =>
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        const body = route.request().postDataJSON() as (typeof naming)[number];
        if (!body.tools.length) {
          naming.push(body);
          const first = body.messages.at(-1)!.content;
          if (first === 'Fail naming') {
            await route.fulfill({
              headers: cors,
              status: 500,
              body: 'unavailable',
            });
            return;
          }
          await new Promise<void>((resolve) => pending.push(resolve));
          await route
            .fulfill({
              headers: cors,
              contentType: 'text/event-stream',
              body: reply(
                first === 'Second chat message'
                  ? 'Second cinematic edit'
                  : 'Beach trip highlights',
              ),
            })
            .catch(() => {});
        } else {
          await route.fulfill({
            headers: cors,
            contentType: 'text/event-stream',
            body: reply('Ready to edit.'),
          });
        }
      },
    );
    await setup(page, context, base);
    expect(naming).toHaveLength(0);
    const input = page.getByRole('textbox', {
      name: 'Describe your edit',
      exact: true,
    });
    const trigger = page.getByRole('button', {
      name: 'Chat sessions',
      exact: true,
    });
    const responses = page.getByRole('article', { name: 'Assistant response' });
    const create = async () => {
      await trigger.click();
      await page
        .getByRole('menuitem', { name: 'New conversation', exact: true })
        .click();
    };
    await input.fill('Make a short video of my beach trip');
    await input.press('Enter');
    await expect(responses.last()).toContainText('Ready to edit.');
    await expect.poll(() => pending.length).toBe(1);
    await expect(trigger).toContainText('Make a short video of my beach trip');
    expect(naming[0]!.model).toBe(model);
    expect(naming[0]!.tools).toEqual([]);
    expect(naming[0]!.messages).toHaveLength(2);
    expect(naming[0]!.messages[1]).toEqual({
      role: 'user',
      content: 'Make a short video of my beach trip',
    });
    expect(JSON.stringify(naming[0])).not.toContain('Chat improvements');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await trigger.click();
    await expect(
      page.getByRole('menu', { name: 'Chat sessions', exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      const records: { name: string; duration: string; oldHidden: boolean }[] =
        [];
      Object.assign(window, { titleAnimations: records });
      const observer = new MutationObserver(() => {
        document.querySelectorAll('.chat-title-in').forEach((element) => {
          const style = getComputedStyle(element);
          records.push({
            name: style.animationName,
            duration: style.animationDuration,
            oldHidden:
              element
                .parentElement!.querySelector('.chat-title-out')
                ?.getAttribute('aria-hidden') === 'true',
          });
        });
      });
      observer.observe(document.body, { subtree: true, childList: true });
      Object.assign(window, { titleObserver: observer });
    });
    pending.shift()!();
    await expect(trigger).toContainText('Beach trip highlights');
    await expect(
      page.getByRole('menuitemradio', {
        name: 'Beach trip highlights',
        exact: true,
      }),
    ).toBeVisible();
    const animations = await page.evaluate(
      () =>
        (
          window as unknown as {
            titleAnimations: {
              name: string;
              duration: string;
              oldHidden: boolean;
            }[];
          }
        ).titleAnimations,
    );
    expect(
      animations.some(
        (entry) =>
          entry.name === 'chat-title-in' &&
          entry.duration === '0.42s' &&
          entry.oldHidden,
      ),
    ).toBe(true);
    await page
      .getByRole('textbox', { name: 'Search sessions by title', exact: true })
      .fill('Beach trip');
    await expect(page.getByRole('menuitemradio')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.chat-title-out')).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('generated-chat-title.png'),
    });
    await input.fill('Another request in the same chat');
    await input.press('Enter');
    await expect(responses).toHaveCount(2);
    await expect(responses.last()).toContainText('Ready to edit.');
    expect(naming).toHaveLength(1);
    // Branches already own their inherited conversation and title.
    await responses.last().hover();
    await responses
      .last()
      .getByRole('button', { name: 'Branch response', exact: true })
      .click();
    await expect(trigger).toContainText('Branch of Beach trip highlights');
    await input.fill('Continue the branch');
    await input.press('Enter');
    await expect(responses.last()).toContainText('Ready to edit.');
    expect(naming).toHaveLength(1);
    await create();
    await input.fill('Second chat message');
    await input.press('Enter');
    await expect(responses.last()).toContainText('Ready to edit.');
    await expect.poll(() => pending.length).toBe(1);
    await trigger.click();
    await page
      .getByRole('menuitemradio', {
        name: 'Beach trip highlights',
        exact: true,
      })
      .click();
    pending.shift()!();
    await expect(trigger).toHaveText('Beach trip highlights');
    await trigger.click();
    await expect(
      page.getByRole('menuitemradio', {
        name: 'Second cinematic edit',
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole('menuitemradio', {
        name: 'Second cinematic edit',
        exact: true,
      })
      .click();
    await expect(trigger).toHaveText('Second cinematic edit');
    await expect(trigger.locator('.chat-title-in')).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await create();
    await input.fill('Reduced motion message');
    await input.press('Enter');
    await expect(responses.last()).toContainText('Ready to edit.');
    await expect.poll(() => pending.length).toBe(1);
    pending.shift()!();
    await expect(trigger).toContainText('Beach trip highlights');
    const reduced = await page.evaluate(
      () =>
        (window as unknown as { titleAnimations: { name: string }[] })
          .titleAnimations,
    );
    expect(reduced.some((entry) => entry.name === 'none')).toBe(true);
    await create();
    await input.fill('Fail naming');
    await input.press('Enter');
    await expect(responses.last()).toContainText('Ready to edit.');
    await expect.poll(() => naming.length).toBe(4);
    await expect(trigger).toHaveText('Fail naming');
    await input.fill('Still works after naming failure');
    await input.press('Enter');
    await expect(responses.last()).toContainText('Ready to edit.');
    expect(naming).toHaveLength(4);
    await expect(trigger).toHaveText('Fail naming');
    // Retiring the scope prevents delayed naming from updating its replacement.
    await create();
    await input.fill('Retired request');
    await input.press('Enter');
    await expect(responses.last()).toContainText('Ready to edit.');
    await expect.poll(() => pending.length).toBe(1);
    await page.reload();
    pending.shift()!();
    await expect(trigger).toHaveText('New chat');
    expect(naming).toHaveLength(5);
  });
  test(`chat navigation pauses quietly with Resume and Send composer actions ${base}`, async ({
    page,
    context,
  }) => {
    const requests: { messages: { role: string; content: string | null }[] }[] =
      [];
    const pending: (() => void)[] = [];
    const pausedAttempts = new Map<string, number>();
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        const body = route
          .request()
          .postDataJSON() as (typeof requests)[number];
        requests.push(body);
        const prompt = body.messages
          .filter((message) => message.role === 'user')
          .at(-1)?.content;
        const attempt = pausedAttempts.get(prompt ?? '') ?? 0;
        if (
          prompt?.startsWith('Pause') &&
          attempt < (prompt.endsWith('collapse') ? 2 : 1)
        ) {
          pausedAttempts.set(prompt, attempt + 1);
          await new Promise<void>((resolve) => pending.push(resolve));
          await route.abort('failed').catch(() => {});
        } else if (prompt === 'Fail in foreground') {
          await route.abort('failed');
        } else {
          await route.fulfill({
            headers: cors,
            contentType: 'text/event-stream',
            body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Ready to continue.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
          });
        }
      },
    );
    await setup(page, context, base);
    const input = page.getByRole('textbox', {
      name: 'Describe your edit',
      exact: true,
    });
    const send = page.getByRole('button', {
      name: 'Send edit request',
      exact: true,
    });
    const responses = page.getByRole('article', { name: 'Assistant response' });
    await input.fill('Completed context');
    await send.click();
    await expect(responses.last()).toContainText('Ready to continue.');

    for (const navigation of [
      'collapse',
      'mobile tab',
      'hidden tab',
      'pagehide',
    ]) {
      await test.step(navigation, async () => {
        const count = requests.length;
        if (navigation === 'mobile tab') {
          await page.setViewportSize({ width: 390, height: 844 });
          await page
            .getByRole('navigation', { name: 'Workspace sections' })
            .getByRole('button', { name: 'Chat', exact: true })
            .click();
        }
        await input.fill(`Pause for ${navigation}`);
        await send.click();
        await expect.poll(() => pending.length).toBe(1);
        if (navigation === 'collapse') {
          await page
            .getByRole('button', { name: 'Collapse chat', exact: true })
            .click();
          pending.shift()!();
          await page
            .getByRole('button', { name: 'Expand chat', exact: true })
            .click();
        } else if (navigation === 'mobile tab') {
          await input.blur();
          await page
            .getByRole('navigation', { name: 'Workspace sections' })
            .getByRole('button', { name: 'Expand media', exact: true })
            .click();
          pending.shift()!();
          await page
            .getByRole('navigation', { name: 'Workspace sections' })
            .getByRole('button', { name: 'Chat', exact: true })
            .click();
        } else {
          await page.evaluate((navigation) => {
            if (navigation === 'hidden tab') {
              Object.defineProperty(document, 'visibilityState', {
                configurable: true,
                value: 'hidden',
              });
              document.dispatchEvent(new Event('visibilitychange'));
            } else
              window.dispatchEvent(
                new PageTransitionEvent('pagehide', { persisted: true }),
              );
          }, navigation);
          pending.shift()!();
          await page.evaluate(() => {
            delete (document as unknown as { visibilityState?: string })
              .visibilityState;
            document.dispatchEvent(new Event('visibilitychange'));
            window.dispatchEvent(
              new PageTransitionEvent('pageshow', { persisted: true }),
            );
          });
        }
        await expect(responses.last()).toContainText('Paused');
        await expect(
          page.getByRole('button', { name: 'Cancel response', exact: true }),
        ).toHaveCount(0);
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expect(
          page.locator('[data-sonner-toast][data-type="error"]'),
        ).toHaveCount(0);
        expect(requests).toHaveLength(count + 1);
        const originalRequest = requests.at(-1)!;
        const messageCount = await page
          .getByRole('article', { name: 'Your message' })
          .count();
        const responseCount = await responses.count();
        const resume = page.getByRole('button', {
          name: 'Resume response',
          exact: true,
        });
        await expect(resume).toBeEnabled();
        await expect(input).toHaveValue('');
        await input.fill('New direction');
        await expect(send).toBeEnabled();
        await expect(resume).toHaveCount(0);
        await input.fill(' ');
        await expect(send).toHaveCount(0);
        await input.press('Enter');
        expect(requests).toHaveLength(count + 1);
        await expect(resume).toHaveCount(0);
        await input.fill('');
        await expect(resume).toBeEnabled();
        if (navigation === 'hidden tab') await input.press('Enter');
        else await resume.click();
        if (navigation === 'collapse') {
          await expect.poll(() => pending.length).toBe(1);
          await page
            .getByRole('button', { name: 'Collapse chat', exact: true })
            .click();
          pending.shift()!();
          await page
            .getByRole('button', { name: 'Expand chat', exact: true })
            .click();
          await expect(responses.last()).toContainText('Paused');
          await expect(resume).toBeEnabled();
          await resume.click();
        }
        await expect(responses.last()).toContainText('Ready to continue.');
        await expect(resume).toHaveCount(0);
        await expect(
          page.getByRole('article', { name: 'Your message' }),
        ).toHaveCount(messageCount);
        await expect(responses).toHaveCount(responseCount);
        expect(requests.at(-1)?.messages).toEqual(originalRequest.messages);
        expect(JSON.stringify(requests.at(-1)?.messages)).toContain(
          'Completed context',
        );
        // Typing a new request after a pause must send that request, not resume the old one.
        await input.fill(`New request after ${navigation}`);
        await expect(send).toBeEnabled();
        await send.click();
        await expect(responses.last()).toContainText('Ready to continue.');
        expect(requests.at(-1)?.messages.at(-1)?.content).toBe(
          `New request after ${navigation}`,
        );
        await page.setViewportSize({ width: 1440, height: 900 });
      });
    }
    await test.step('typed draft sends a new request instead of resuming', async () => {
      await input.fill('Pause for a different request');
      await send.click();
      await expect.poll(() => pending.length).toBe(1);
      await input.fill('Changed direction');
      await page
        .getByRole('button', { name: 'Collapse chat', exact: true })
        .click();
      pending.shift()!();
      await page
        .getByRole('button', { name: 'Expand chat', exact: true })
        .click();
      await expect(responses.last()).toContainText('Paused');
      await expect(input).toHaveValue('Changed direction');
      await expect(
        page.getByRole('button', { name: 'Resume response', exact: true }),
      ).toHaveCount(0);
      const count = requests.length;
      await send.click();
      await expect(responses.last()).toContainText('Ready to continue.');
      expect(requests).toHaveLength(count + 1);
      expect(requests.at(-1)?.messages.at(-1)?.content).toBe(
        'Changed direction',
      );
    });
    await input.fill('Fail in foreground');
    await send.click();
    await expect(responses.last()).toContainText('Incomplete response');
    await expect(page.getByRole('alert')).toContainText('could not be reached');
    await expect(
      page.locator('[data-sonner-toast][data-type="error"]').filter({
        hasText: 'Assistant response: Task could not complete (NETWORK_ERROR)',
      }),
    ).toBeVisible();
  });
  test(`uncapped typed and dictated chat draft ${base}`, async ({
    page,
    context,
  }) => {
    await context.addInitScript(() => {
      class Recognition {
        onresult?: (event: unknown) => void;
        onend?: () => void;
        start() {
          queueMicrotask(() =>
            this.onresult?.({
              resultIndex: 0,
              results: [{ isFinal: true, 0: { transcript: 'Dictated tail' } }],
            }),
          );
        }
        stop() {
          this.onend?.();
        }
        abort() {
          this.onend?.();
        }
      }
      Object.assign(window, {
        SpeechRecognition: Recognition,
        webkitSpeechRecognition: Recognition,
      });
    });
    await setup(page, context, base);
    const input = page.getByRole('textbox', {
      name: 'Describe your edit',
      exact: true,
    });
    const draft = 'x'.repeat(100001);
    await input.fill(draft);
    await expect(input).toHaveValue(draft);
    await page
      .getByRole('button', { name: 'Dictate message', exact: true })
      .click();
    await expect(input).toHaveValue(draft + ' Dictated tail');
    await page
      .getByRole('button', { name: 'Stop dictation', exact: true })
      .click();
  });

  test(`chat response actions, branch isolation, dictation and image dragging ${base}`, async ({
    page,
    context,
  }, info) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await context.addInitScript(() => {
      class Recognition {
        lang = '';
        continuous = false;
        interimResults = false;
        onresult?: (event: unknown) => void;
        onend?: () => void;
        start() {
          queueMicrotask(() =>
            this.onresult?.({
              resultIndex: 0,
              results: [{ isFinal: true, 0: { transcript: 'Dictated idea' } }],
            }),
          );
        }
        stop() {
          this.onend?.();
        }
        abort() {
          this.onend?.();
        }
      }
      Object.assign(window, {
        SpeechRecognition: Recognition,
        webkitSpeechRecognition: Recognition,
      });
    });
    const requests: {
      messages: { role: string; content: string | null }[];
      tools: { function: { name: string } }[];
    }[] = [];
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      (route) => {
        const body = route
          .request()
          .postDataJSON() as (typeof requests)[number];
        requests.push(body);
        const current = body.messages.at(-1);
        const final = current?.role === 'tool';
        const answer = String(
          body.messages.filter((m) => m.role === 'user').at(-1)?.content,
        ).includes('Alternative')
          ? 'Alternative reply.'
          : 'Short reply.';
        return route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: final ? { content: answer } : { tool_calls: [{ index: 0, id: 'inspect', type: 'function', function: { name: 'inspect_project', arguments: '{}' } }] }, finish_reason: final ? 'stop' : 'tool_calls' }], ...(final ? { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.001 } } : {}) })}\n\ndata: [DONE]\n\n`,
        });
      },
    );
    await setup(page, context, base);
    const input = page.getByRole('textbox', {
      name: 'Describe your edit',
      exact: true,
    });
    await expect(
      page.getByText('What would you like to create?', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Send edit request', exact: true }),
    ).toHaveCount(0);
    const mic = page.getByRole('button', {
      name: 'Dictate message',
      exact: true,
    });
    const composerBounds = (await page
      .locator('.chat-composer')
      .boundingBox())!;
    const emptyMic = (await mic.boundingBox())!;
    expect(
      composerBounds.x + composerBounds.width - emptyMic.x - emptyMic.width,
    ).toBeLessThan(20);
    await expect(
      page.getByRole('button', { name: 'Record screen', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath('chat-empty-controls.png') });
    await expect(
      page.getByRole('button', { name: 'Request context' }),
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Dictate message', exact: true })
      .click();
    await expect(input).toHaveValue('Dictated idea');
    await page
      .getByRole('button', { name: 'Stop dictation', exact: true })
      .click();
    await input.fill('First idea');
    const micBounds = (await mic.boundingBox())!;
    const sendBounds = (await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .boundingBox())!;
    expect(micBounds.x + micBounds.width).toBeLessThanOrEqual(sendBounds.x);
    expect(Math.abs(micBounds.y - sendBounds.y)).toBeLessThan(2);
    const queue = page.getByRole('button', { name: 'Task queue', exact: true });
    await expect(
      page
        .locator('.workspace-header')
        .getByRole('button', { name: 'Task queue', exact: true }),
    ).toBeVisible();
    expect((await queue.boundingBox())!.x).toBeLessThan(
      (await page
        .getByRole('button', { name: 'Commands', exact: true })
        .boundingBox())!.x,
    );
    await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .click();
    const response = page
      .getByRole('article', { name: 'Assistant response' })
      .first();
    await expect(
      response.getByText('Short reply.', { exact: true }),
    ).toBeVisible();
    const tools = response.getByRole('button', {
      name: 'inspect project',
      exact: true,
    });
    const toolsBox = await tools.boundingBox(),
      textBox = await response
        .getByText('Short reply.', { exact: true })
        .boundingBox();
    expect(toolsBox!.y).toBeLessThan(textBox!.y);
    await response.hover();
    await response
      .getByRole('button', { name: 'Copy response', exact: true })
      .click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'Short reply.',
    );
    await response
      .getByRole('button', { name: 'Response details', exact: true })
      .hover();
    await expect(page.getByRole('tooltip')).toContainText('15 tokens');
    await page.mouse.move(1, 1);
    await input.fill('Later original idea');
    await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .click();
    await expect(
      page.getByRole('article', { name: 'Assistant response' }),
    ).toHaveCount(2);
    await expect(
      page.getByRole('button', { name: 'Cancel response', exact: true }),
    ).not.toBeVisible();
    await response.hover();
    await response
      .getByRole('button', { name: 'Branch response', exact: true })
      .click();
    const branchInput = page.getByRole('textbox', {
      name: 'Describe your edit',
      exact: true,
    });
    await branchInput.fill('Alternative');
    await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .click();
    await expect(
      page.getByText('Alternative reply.', { exact: true }),
    ).toBeVisible();
    const last = JSON.stringify(requests.at(-1)?.messages);
    expect(last).toContain('First idea');
    expect(last).not.toContain('Later original idea');
    expect(last).toContain('Keep replies short and concise');
    await page
      .getByRole('button', { name: 'Chat sessions', exact: true })
      .click();
    await page
      .getByRole('menuitemradio', { name: 'First idea', exact: true })
      .click();
    await expect(
      page.getByRole('article', { name: 'Assistant response' }),
    ).toHaveCount(2);
    await expect(
      page.getByText('Alternative reply.', { exact: true }),
    ).not.toBeVisible();
    // Import a real local image into the draft; only its metadata/ID may travel remotely.
    const imageBytes = await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(32, 32);
      canvas.getContext('2d')!.fillRect(0, 0, 32, 32);
      return [
        ...new Uint8Array(
          await (
            await canvas.convertToBlob({ type: 'image/png' })
          ).arrayBuffer(),
        ),
      ];
    });
    await page.getByLabel('Import media', { exact: true }).setInputFiles({
      name: 'Reference.png',
      mimeType: 'image/png',
      buffer: Buffer.from(imageBytes),
    });
    await closeMediaImport(page);
    const source = page.getByRole('button', {
      name: 'Asset details for Reference.png',
      exact: true,
    });
    await expect(source).toBeVisible();
    await expect(source.locator('img')).toBeVisible();
    await dismissNotifications(page);
    const asset = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const summary = (await editor.projects.list()).find(
          (item) => item.name === 'Chat improvements',
        )!;
        const project = await editor.projects.snapshot(summary.id);
        const id = project.tracks
          .flatMap((track) => track.clips)
          .find((clip) => clip.assetId)?.assetId;
        return await editor.assets.inspect(id!);
      } finally {
        await editor.dispose();
      }
    }, base);
    const transfer = await page.evaluateHandle((id) => {
      const data = new DataTransfer();
      data.setData('application/x-localcut-image', id);
      return data;
    }, asset.id);
    await dismissNotifications(page);
    const from = (await source.boundingBox())!;
    const to = (await input.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
      steps: 12,
    });
    await expect(
      page.locator('.conversation-session:not([hidden]) .chat-composer'),
    ).toHaveAttribute('data-dropping', 'true');
    await page.mouse.up();
    await expect(page.getByLabel('Attached images')).toContainText(
      'Reference.png',
    );
    await page
      .getByRole('button', { name: 'Remove Reference.png', exact: true })
      .click();
    // Remove the placed clip before checking that an unsent attachment grants no context.
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await input.fill('No attachment in this request');
    await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Cancel response', exact: true }),
    ).not.toBeVisible();
    expect(JSON.stringify(requests.at(-1))).not.toContain(asset.id);
    await page
      .locator('.conversation-session:not([hidden]) .chat-composer')
      .dispatchEvent('drop', { dataTransfer: transfer });
    await expect(page.getByLabel('Attached images')).toContainText(
      'Reference.png',
    );
    await input.fill('Use the attached image');
    await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Cancel response', exact: true }),
    ).not.toBeVisible();
    expect(JSON.stringify(requests.at(-1))).toContain(asset.id);
    expect(JSON.stringify(requests.at(-1))).not.toMatch(/data:image|base64/);
    const overflow = await page.evaluate(async (base) => {
      const { createEditor } = await import(base + 'editor.js');
      const editor = await createEditor();
      try {
        const canvas = new OffscreenCanvas(16, 16);
        const assets = [];
        for (let i = 0; i < 9; i++) {
          const context = canvas.getContext('2d')!;
          context.fillStyle = `rgb(${i * 20}, 0, 0)`;
          context.fillRect(0, 0, 16, 16);
          assets.push(
            await editor.assets.import(
              await canvas.convertToBlob({ type: 'image/png' }),
              `Image${i}.png`,
            ).completion,
          );
        }
        return assets;
      } finally {
        await editor.dispose();
      }
    }, base);
    await input.fill('Use only the visible attached images');
    for (const image of overflow) {
      const data = await page.evaluateHandle((id) => {
        const transfer = new DataTransfer();
        transfer.setData('application/x-localcut-image', id);
        return transfer;
      }, image.id);
      await page
        .locator('.conversation-session:not([hidden]) .chat-composer')
        .dispatchEvent('drop', { dataTransfer: data });
      await expect(page.getByLabel('Attached images')).toContainText(
        image.name,
      );
      await expect(
        page.getByRole('button', { name: 'Send edit request', exact: true }),
      ).toBeEnabled();
      await data.dispose();
    }
    await expect(
      page.getByRole('button', { name: 'Remove Image8.png', exact: true }),
    ).toHaveCount(1);
    await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Cancel response', exact: true }),
    ).not.toBeVisible();
    const allowed = JSON.stringify(requests.at(-1));
    for (const image of overflow) expect(allowed).toContain(image.id);
    expect(allowed).toContain(asset.id); // Previously sent context remains available.
    await input.fill('Next draft');
    const sendBox = await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .boundingBox();
    const composerBox = await page
      .locator('.conversation-session:not([hidden]) .chat-composer')
      .boundingBox();
    expect(
      composerBox!.x + composerBox!.width - sendBox!.x - sendBox!.width,
    ).toBeLessThan(20);
    await page.getByRole('button', { name: 'Task queue', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Task queue' }),
    ).toContainText('Assistant response');
  });
}
