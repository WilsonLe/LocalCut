import { expect, test } from '@playwright/test';
import { openAISettings } from './workspace-settings-helper';
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
            context_length: 32000,
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
  test(`chat response actions, branch isolation, dictation and image dragging ${base}`, async ({
    page,
    context,
  }) => {
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
    const asset = await page.evaluate(async (base) => {
      const { createEditor } = await import(base + 'editor.js');
      const editor = await createEditor();
      try {
        const canvas = new OffscreenCanvas(32, 32);
        canvas.getContext('2d')!.fillRect(0, 0, 32, 32);
        return await editor.assets.import(
          await canvas.convertToBlob({ type: 'image/png' }),
          'Reference.png',
        ).completion;
      } finally {
        await editor.dispose();
      }
    }, base);
    const transfer = await page.evaluateHandle((id) => {
      const data = new DataTransfer();
      data.setData('application/x-localcut-image', id);
      return data;
    }, asset.id);
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
