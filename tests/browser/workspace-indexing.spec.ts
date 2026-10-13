import { selectAISettingsTab } from './workspace-settings-helper';
import { fulfillChatTitle } from './chat-title-fixture';
import { dismissNotifications } from './workspace-notifications-helper';
import { closeMediaImport } from './workspace-import-helper';
import { mediaVideo } from './workspace-video-fixture';
import {
  prepareOpenRouterKey,
  openAISettings,
} from './workspace-settings-helper';
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
const model = 'test/visual-chat';
const label = {
  summary: 'A red image on a plain background',
  subjects: ['red shape'],
  scene: 'plain background',
  style: 'graphic',
  tags: ['red', 'graphic'],
  sound: 'none',
};
async function indexAction(page: Page, name: string, asset = 'red.png') {
  const menu = page.getByRole('menu', {
    name: `Actions for ${asset}`,
    exact: true,
  });
  const trigger = page.getByRole('button', {
    name: `Actions for ${asset}`,
    exact: true,
  });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    // Reopening mobile media focuses its panel. Reveal the hover-only
    // desktop trigger before clicking instead of racing that focus.
    await page
      .getByRole('button', { name: `Asset details for ${asset}`, exact: true })
      .hover({ position: { x: 8, y: 8 }, timeout: 10_000 });
    await trigger.focus();
    await trigger.click();
  }
  await expect(menu).toBeVisible();
  return menu.getByRole('menuitem', { name, exact: true });
}
async function clickIndexAction(page: Page, name: string, asset = 'red.png') {
  await (await indexAction(page, name, asset)).click();
  await expect(
    page.getByRole('menu', { name: `Actions for ${asset}`, exact: true }),
  ).toBeHidden();
}
async function catalog(
  context: BrowserContext,
  audio = false,
  video = true,
  visual = true,
) {
  await context.route('https://openrouter.ai/api/v1/models', (route) =>
    route.fulfill({
      headers: cors,
      json: {
        data: [
          {
            id: model,
            name: 'Visual chat',
            context_length: 512000,
            supported_parameters: ['tools', 'tool_choice'],
            architecture: {
              input_modalities: [
                'text',
                ...(visual ? ['image'] : []),
                ...(video ? ['video'] : []),
                ...(audio ? ['audio'] : []),
              ],
            },
          },
        ],
      },
    }),
  );
}
async function connect(page: Page) {
  await openAISettings(page);
  const dialog = page.getByRole('dialog', {
    name: 'AI connection',
    exact: true,
  });
  await prepareOpenRouterKey(page);
  await dialog
    .getByLabel('OpenRouter API key', { exact: true })
    .fill('synthetic-indexing-key');
  await dialog
    .getByRole('button', { name: 'Use API key', exact: true })
    .click();
  await selectAISettingsTab(page, 'Providers');
  await expect(
    dialog.getByRole('button', { name: 'Verify OpenRouter', exact: true }),
  ).toBeVisible();
  await selectAISettingsTab(page, 'LLM - Chat');
  await dialog.getByRole('combobox', { name: 'AI model', exact: true }).click();
  await page
    .getByRole('option', { name: 'Visual chat · ' + model, exact: true })
    .click();
  return dialog;
}
async function settings(page: Page) {
  await openAISettings(page);
  return page.getByRole('dialog', { name: 'AI connection', exact: true });
}
async function image(page: Page) {
  const bytes = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(128, 72),
      ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'red';
    ctx.fillRect(0, 0, 128, 72);
    return [
      ...new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer()),
    ];
  });
  await page.getByLabel('Import media', { exact: true }).setInputFiles({
    name: 'red.png',
    mimeType: 'image/png',
    buffer: Buffer.from(bytes),
  });
  await closeMediaImport(page);
  await expect(page.locator('.media-item')).toHaveCount(1);
}
for (const base of ['/', '/LocalCut/']) {
  test(`chat indexing requested execution, saved results and automatic authorization ${base}`, async ({
    page,
    context,
  }) => {
    await catalog(context);
    const bodies: Record<string, unknown>[] = [];
    let chatRound = 0;
    let evidenceRequests = 0;
    let sceneRequests = 0;
    let failSummary = true;
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ headers: cors });
          return;
        }
        if (await fulfillChatTitle(route)) return;
        const body = route.request().postDataJSON();
        bodies.push(body);
        let reply: string | null;
        let tool_calls: unknown[] | undefined;
        if (body.tools) {
          const scope = JSON.parse(body.messages[1].content);
          if (
            body.messages.at(-1).role === 'user' &&
            String(body.messages.at(-1).content).endsWith('Reindex from chat')
          )
            chatRound = 0;
          const permitted = scope.skillCatalog.some(
            (skill: { id: string }) => skill.id === 'indexing',
          );
          const last = body.messages.at(-1);
          if (last.role === 'user' && !scope.assetIndex) {
            expect(permitted).toBe(true);
            expect(
              body.tools.some(
                (tool: { function: { name: string } }) =>
                  tool.function.name === 'inspect_capabilities',
              ),
            ).toBe(true);
            reply = null;
            tool_calls = [
              {
                index: 0,
                id: 'indexing-capabilities',
                type: 'function',
                function: { name: 'inspect_capabilities', arguments: '{}' },
              },
            ];
          } else if (!permitted)
            reply = 'No compatible indexing connection is available.';
          else if (chatRound === 0) {
            reply = null;
            tool_calls = [
              {
                index: 0,
                id: 'load-indexing',
                type: 'function',
                function: {
                  name: 'load_skill',
                  arguments: JSON.stringify({ skillId: 'indexing' }),
                },
              },
            ];
            chatRound++;
          } else if (chatRound === 1) {
            const assetId = scope.availableAssetIds[0];
            expect(assetId).toBeTruthy();
            expect(JSON.stringify(body.tools)).toContain('index_asset');
            reply = null;
            tool_calls = [
              {
                index: 0,
                id: 'inspect',
                type: 'function',
                function: {
                  name: 'inspect_asset',
                  arguments: JSON.stringify({ assetId }),
                },
              },
              {
                index: 1,
                id: 'index-proposal',
                type: 'function',
                function: {
                  name: 'propose_action',
                  arguments: JSON.stringify({
                    summary: 'Index the red image',
                    action: {
                      type: 'index_asset',
                      assetId,
                      ...(String(
                        body.messages
                          .filter(
                            (message: { role: string }) =>
                              message.role === 'user',
                          )
                          .at(-1)?.content,
                      ).endsWith('Reindex from chat')
                        ? { restart: true }
                        : {}),
                    },
                  }),
                },
              },
            ];
            chatRound++;
          } else
            reply = scope.assetIndex.assets.length
              ? 'Saved red image observations are available.'
              : 'Indexing failed. Send a new request to retry.';
        } else {
          evidenceRequests++;
          const part = body.messages.at(-1).content;
          const sceneId =
            Array.isArray(part) && part.length > 1
              ? /"sceneId":"(scene-\d+)"/.exec(String(part[0].text))?.[1]
              : undefined;
          if (sceneId) sceneRequests++;
          reply =
            !sceneId && failSummary
              ? '{invalid-summary'
              : JSON.stringify(sceneId ? { sceneId, label } : label);
          if (!sceneId) failSummary = false;
        }
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { ...(reply ? { content: reply } : {}), ...(tool_calls ? { tool_calls } : {}) }, finish_reason: tool_calls ? 'tool_calls' : 'stop' }], model })}\n\ndata: [DONE]\n\n`,
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
    await page
      .getByLabel('Project name', { exact: true })
      .fill('Chat indexing');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Import media', exact: true }).first(),
    ).toBeEnabled();
    await image(page);
    let dialog = await connect(page);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    const assetId = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const project = (await editor.projects.list()).find(
          (item) => item.name === 'Chat indexing',
        )!;
        return (
          await editor.library.forProject(project.id).list()
        ).entries.find((entry) => entry.assetId)!.assetId!;
      } finally {
        await editor.dispose();
      }
    }, base);
    const send = async (text: string) => {
      await dismissNotifications(page);
      // Library-only uploads require an explicit attachment for each chat turn.
      const transfer = await page.evaluateHandle((id) => {
        const data = new DataTransfer();
        data.setData('application/x-localcut-image', id);
        return data;
      }, assetId);
      await page
        .locator('.conversation-session:not([hidden]) .chat-composer')
        .dispatchEvent('drop', { dataTransfer: transfer });
      await transfer.dispose();
      await expect(page.getByLabel('Attached images')).toContainText('red.png');
      await page
        .getByRole('textbox', { name: 'Describe your edit' })
        .fill(text);
      await page
        .getByRole('button', { name: 'Send edit request', exact: true })
        .click();
    };
    await send('Index this image');
    const approve = page.getByRole('button', {
      name: 'Apply proposal',
      exact: true,
    });
    await expect(
      page
        .getByRole('article', { name: 'Assistant response', exact: true })
        .last(),
    ).toContainText('Indexing failed. Send a new request to retry.');
    const response = page
      .getByRole('article', { name: 'Assistant response', exact: true })
      .last();
    await response
      .getByRole('button', { name: '2 of 3 tools completed', exact: true })
      .click();
    await expect(
      response.getByRole('button', {
        name: 'Load skills: Indexing · Completed',
        exact: true,
      }),
    ).toBeVisible();
    await response
      .getByRole('button', { name: '2 of 3 tools completed', exact: true })
      .click();
    await expect(
      page.getByText(/Indexing sends generated stills.*may incur cost/),
    ).toBeVisible();
    expect(evidenceRequests).toBe(2);
    await page.screenshot({
      path: test.info().outputPath('chat-indexing-requested.png'),
    });
    await expect(approve).toHaveCount(0);
    expect(evidenceRequests).toBe(2);
    expect(sceneRequests).toBe(1);
    const runs = () =>
      page.evaluate(async (base) => {
        const { createEditor } = (await import(
          base + 'editor.js'
        )) as typeof import('../../src/editor');
        const engine = await createEditor();
        try {
          return (await engine.assets.indexes.list()).map((run) => ({
            id: run.id,
            status: run.status,
          }));
        } finally {
          await engine.dispose();
        }
      }, base);
    const failedRuns = await runs();
    expect(failedRuns).toHaveLength(1);
    expect(failedRuns[0]!.status).toBe('failed');
    chatRound = 0;
    await send('Retry indexing this image');
    await expect(
      page
        .getByRole('article', { name: 'Assistant response', exact: true })
        .last(),
    ).toContainText('Saved red image observations are available.');
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();
    expect(evidenceRequests).toBe(3);
    expect(sceneRequests).toBe(1);
    expect(await runs()).toEqual([
      { id: failedRuns[0]!.id, status: 'complete' },
    ]);
    await expect(await indexAction(page, 'Reindex')).toBeEnabled();
    await page.keyboard.press('Escape');
    await send('Find the red image');
    await expect(
      response.getByText('Saved red image observations are available.', {
        exact: true,
      }),
    ).toBeVisible();
    expect(JSON.stringify(bodies.at(-1))).toContain(label.summary);
    expect(JSON.stringify(bodies.at(-1))).not.toContain('data:image');
    await clickIndexAction(page, 'View index results');
    const saved = page.getByRole('dialog', {
      name: 'Asset index',
      exact: true,
    });
    await expect(
      saved.getByText(label.summary, { exact: true }).first(),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await send('Reindex from chat');
    await expect(
      page
        .getByRole('article', { name: 'Assistant response', exact: true })
        .last(),
    ).toContainText('Saved red image observations are available.');
    await expect(approve).toHaveCount(0);
    await expect(page.getByText('Completed', { exact: true })).toHaveCount(2);
    const reindexed = await runs();
    expect(reindexed).toHaveLength(2);
    expect(reindexed.find((run) => run.id === failedRuns[0]!.id)).toEqual({
      id: failedRuns[0]!.id,
      status: 'complete',
    });
    expect(reindexed.filter((run) => run.id !== failedRuns[0]!.id)).toEqual([
      { id: expect.any(String), status: 'complete' },
    ]);
    expect(sceneRequests).toBe(2);
    expect(evidenceRequests).toBe(5);
    await page.reload();
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    await expect(await indexAction(page, 'Reindex')).toBeEnabled();
    await page.keyboard.press('Escape');
    dialog = await settings(page);
    await expect(
      dialog.getByRole('checkbox', { name: 'Allow asset indexing' }),
    ).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await send('Find the red image');
    await expect(
      response.getByText('Saved red image observations are available.', {
        exact: true,
      }),
    ).toBeVisible();
    expect(evidenceRequests).toBe(5);
    expect(JSON.stringify(bodies.at(-1))).toContain(label.summary);
  });

  test(`mobile media keeps indexing alive while closed ${base}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await catalog(context);
    let release = () => {};
    const labeling = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested = false;
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ headers: cors });
          return;
        }
        requested = true;
        const part = route.request().postDataJSON().messages.at(-1).content;
        const prompt = Array.isArray(part)
          ? String(part[0]?.text)
          : String(part);
        const sceneId =
          Array.isArray(part) && part.length > 1
            ? /"sceneId":"(scene-\d+)"/.exec(prompt)?.[1]
            : undefined;
        await labeling;
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: JSON.stringify(sceneId ? { sceneId, label } : label) }, finish_reason: 'stop' }], model })}\n\ndata: [DONE]\n\n`,
        });
      },
    );
    try {
      await page.goto(base);
      await page
        .getByRole('button', { name: 'Workspace settings', exact: true })
        .click();
      await page
        .getByRole('menuitem', { name: 'Project', exact: true })
        .click();
      await page
        .getByRole('menuitem', { name: 'New project', exact: true })
        .click();
      await page
        .getByLabel('Project name', { exact: true })
        .fill('Mobile indexing');
      await page
        .getByRole('button', { name: 'Create project', exact: true })
        .click();
      await page
        .getByRole('navigation', { name: 'Workspace sections' })
        .getByRole('button', { name: 'Chat', exact: true })
        .click();
      const connection = await connect(page);
      await connection
        .getByRole('button', { name: 'Done', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Expand media', exact: true })
        .click();
      await image(page);
      await clickIndexAction(page, 'Index');
      await expect.poll(() => requested).toBe(true);
      await expect(
        page.getByRole('status', { name: 'Indexing', exact: true }),
      ).toBeVisible();
      const cancel = await indexAction(page, 'Cancel indexing');
      const popup = page.getByRole('menu', {
        name: 'Actions for red.png',
        exact: true,
      });
      const popupBounds = (await popup.boundingBox())!;
      const toaster = page.locator('[data-sonner-toaster]');
      const toast = toaster.locator('[data-sonner-toast][data-type="loading"]');
      await expect(toast).toBeVisible();
      const originalToasterStyle = await toaster.evaluate((el, box) => {
        const element = el as HTMLElement;
        const original = element.getAttribute('style');
        element.style.setProperty('top', `${box.y}px`, 'important');
        element.style.setProperty('left', `${box.x}px`, 'important');
        element.style.setProperty('right', 'auto', 'important');
        element.style.setProperty('bottom', 'auto', 'important');
        element.style.setProperty('width', `${box.width}px`, 'important');
        element.style.setProperty('height', `${box.height}px`, 'important');
        return original;
      }, popupBounds);
      const originalStyle = await toast.evaluate((el) => {
        const element = el as HTMLElement;
        const original = element.getAttribute('style');
        element.style.setProperty('transform', 'none', 'important');
        element.style.setProperty('top', '0', 'important');
        element.style.setProperty('left', '0', 'important');
        element.style.setProperty('width', '100%', 'important');
        element.style.setProperty('height', '100%', 'important');
        return original;
      });
      const cancelBounds = (await cancel.boundingBox())!;
      const hit = {
        x: cancelBounds.x + cancelBounds.width / 2,
        y: cancelBounds.y + cancelBounds.height / 2,
      };
      const toastBounds = (await toast.boundingBox())!;
      expect(hit.x).toBeGreaterThan(toastBounds.x);
      expect(hit.x).toBeLessThan(toastBounds.x + toastBounds.width);
      expect(hit.y).toBeGreaterThan(toastBounds.y);
      expect(hit.y).toBeLessThan(toastBounds.y + toastBounds.height);
      expect(
        await page.evaluate(
          ({ x, y }) =>
            document
              .elementFromPoint(x, y)
              ?.closest('[role="menu"]')
              ?.getAttribute('aria-label'),
          {
            x: cancelBounds.x + cancelBounds.width / 2,
            y: cancelBounds.y + cancelBounds.height / 2,
          },
        ),
      ).toBe('Actions for red.png');
      await page.screenshot({
        path: test.info().outputPath('menu-over-live-toast.png'),
      });
      await toast.evaluate((el, style) => {
        if (style) el.setAttribute('style', style);
        else el.removeAttribute('style');
      }, originalStyle);
      await toaster.evaluate((el, style) => {
        if (style) el.setAttribute('style', style);
        else el.removeAttribute('style');
      }, originalToasterStyle);
      await page.keyboard.press('Escape');
      await page
        .getByRole('navigation', { name: 'Workspace sections' })
        .getByRole('button', { name: 'Edit', exact: true })
        .click();
      await expect(
        page.getByRole('complementary', { name: 'Media library', exact: true }),
      ).toBeHidden();
      release();
      await expect(
        page.getByText('Asset indexed', { exact: true }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'Expand media', exact: true })
        .click();
      await expect(
        page.getByRole('status', { name: 'Indexed', exact: true }),
      ).toBeVisible();
      await clickIndexAction(page, 'View index results', 'red.png');
      const history = page.getByRole('dialog', {
        name: 'Asset index',
        exact: true,
      });
      await expect(
        history.getByText(label.summary, { exact: true }).first(),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(390);
      await history.getByRole('button', { name: 'Close', exact: true }).focus();
      await page.keyboard.press('Escape');
      await expect(history).toBeHidden();
      await expect(
        page.getByRole('complementary', { name: 'Media library', exact: true }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'Asset details for red.png' })
        .focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(
        page.getByRole('tooltip', { name: /^red\.png / }),
      ).toContainText('red.png');
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('complementary', { name: 'Media library', exact: true }),
      ).toBeHidden();
      await expect(
        page.getByRole('button', { name: 'Expand media', exact: true }),
      ).toBeFocused();
    } finally {
      release();
    }
  });

  test(`workspace indexing connection, retry, retained labels and Klip context ${base}`, async ({
    page,
    context,
  }) => {
    await catalog(context);
    let malformed = true;
    const bodies: Record<string, unknown>[] = [];
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ headers: cors });
          return;
        }
        if (await fulfillChatTitle(route)) return;
        const body = route.request().postDataJSON();
        bodies.push(body);
        const messages = body.messages as { content: unknown }[];
        const part = messages.at(-1)!.content;
        const prompt = Array.isArray(part)
          ? String(part[0]?.text)
          : String(part);
        const sceneId =
          Array.isArray(part) && part.length > 1
            ? /"sceneId":"(scene-\d+)"/.exec(prompt)?.[1]
            : undefined;
        const reply = body.tools
          ? 'I can use the indexed red scene.'
          : malformed && sceneId
            ? '{malformed'
            : JSON.stringify(sceneId ? { sceneId, label } : label);
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: reply }, finish_reason: 'stop' }], model })}\n\ndata: [DONE]\n\n`,
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
    await page
      .getByLabel('Project name', { exact: true })
      .fill('Indexing workspace');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Open project', exact: true }),
    ).toContainText('Indexing workspace');
    await expect(
      page.getByRole('button', { name: 'Import media', exact: true }).first(),
    ).toBeEnabled();
    await image(page);
    await expect(await indexAction(page, 'Index')).toBeDisabled();
    await page.keyboard.press('Escape');
    let dialog = await connect(page);
    await expect(
      dialog.getByRole('checkbox', { name: 'Allow asset indexing' }),
    ).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(await indexAction(page, 'Index')).toBeEnabled();
    expect(bodies).toEqual([]);
    await page.keyboard.press('Escape');
    await clickIndexAction(page, 'Index');
    await expect(await indexAction(page, 'Retry indexing')).toBeVisible();
    malformed = false;
    await clickIndexAction(page, 'Retry indexing');
    await expect(await indexAction(page, 'Reindex')).toBeEnabled();
    await page.screenshot({
      path: `.artifacts/asset-actions/index-menu-${base === '/' ? 'root' : 'pages'}.png`,
    });
    expect(bodies).toHaveLength(3);
    expect(JSON.stringify(bodies)).not.toContain('synthetic-indexing-key');
    expect(JSON.stringify(bodies)).not.toContain('red.png');
    await clickIndexAction(page, 'View index results', 'red.png');
    const index = page.getByRole('dialog', {
      name: 'Asset index',
      exact: true,
    });
    await expect(
      index.getByText(label.summary, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      index.getByRole('img', { name: 'Indexed representative frame' }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath('asset-index.png'),
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await page
      .getByRole('textbox', { name: 'Describe your edit' })
      .fill('Find the red graphic');
    await page.getByRole('button', { name: 'Send edit request' }).click();
    await expect(
      page.getByText('I can use the indexed red scene.'),
    ).toBeVisible();
    expect(JSON.stringify(bodies.at(-1))).toContain('assetIndex');
    expect(JSON.stringify(bodies.at(-1))).not.toContain('data:image');
    expect(JSON.stringify(bodies.at(-1))).toContain('search_asset_index');
    await clickIndexAction(page, 'Reindex');
    await expect(await indexAction(page, 'Reindex')).toBeEnabled();
    await clickIndexAction(page, 'View index results', 'red.png');
    await expect(
      index.getByRole('button', { name: 'Run 2 · complete' }),
    ).toBeVisible();
    await index
      .getByRole('button', { name: 'Delete this run', exact: true })
      .click();
    await expect(
      index.getByRole('button', { name: 'Run 2 · complete' }),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      localStorage.setItem(
        'localcut.asset-index-consent.v1',
        JSON.stringify({ version: 1, provider: 'openrouter', allowed: false }),
      );
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'localcut.asset-index-consent.v1' }),
      );
    });
    await expect(await indexAction(page, 'Reindex')).toBeEnabled();
    await page.keyboard.press('Escape');
    await page
      .getByRole('textbox', { name: 'Describe your edit' })
      .fill('Describe available footage');
    await page.getByRole('button', { name: 'Send edit request' }).click();
    await expect(
      page
        .getByRole('article', { name: 'Assistant response', exact: true })
        .last(),
    ).toContainText('I can use the indexed red scene.');
    expect(JSON.stringify(bodies.at(-1))).toContain('assetIndex');
    expect(JSON.stringify(bodies.at(-1)!.tools)).toContain(
      'search_asset_index',
    );
    await page.reload();
    dialog = await settings(page);
    await expect(
      dialog.getByRole('checkbox', { name: 'Allow asset indexing' }),
    ).toHaveCount(0);
  });
}

for (const base of ['/', '/LocalCut/']) {
  test(`workspace indexing audio card and incompatible model ${base}`, async ({
    page,
    context,
  }) => {
    await catalog(context);
    const bodies: Record<string, unknown>[] = [];
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ headers: cors });
          return;
        }
        const body = route.request().postDataJSON();
        bodies.push(body);
        const part = body.messages.at(-1).content;
        const sceneId =
          Array.isArray(part) && part.length > 1
            ? /"sceneId":"(scene-\d+)"/.exec(part[0].text)?.[1]
            : undefined;
        const audioLabel = {
          ...label,
          summary: 'A steady tone',
          subjects: ['tone'],
          tags: ['tone'],
          sound: 'A steady tone',
        };
        const reply = JSON.stringify(
          sceneId ? { sceneId, label: audioLabel } : audioLabel,
        );
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ choices: [{ delta: { content: reply }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
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
    await page
      .getByRole('textbox', { name: 'Project name' })
      .fill('Audio indexing');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Import media', exact: true }).first(),
    ).toBeEnabled();
    const bytes = Buffer.alloc(44 + 48000 * 2);
    bytes.write('RIFF', 0);
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(48000, 24);
    bytes.writeUInt32LE(96000, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36);
    bytes.writeUInt32LE(96000, 40);
    for (let i = 0; i < 48000; i++)
      bytes.writeInt16LE(
        Math.round(Math.sin((i * Math.PI * 880) / 48000) * 3000),
        44 + i * 2,
      );
    await page.getByLabel('Import media', { exact: true }).setInputFiles({
      name: 'tone.wav',
      mimeType: 'audio/wav',
      buffer: bytes,
    });
    await closeMediaImport(page);
    await expect(page.locator('.media-item')).toHaveCount(1);
    // Simulate interruption after deterministic analysis, before the first label.
    await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const project = (await editor.projects.list()).find(
          (p) => p.name === 'Audio indexing',
        )!;
        const assetId = (
          await editor.library.forProject(project.id).list()
        ).entries.find((entry) => entry.assetId)?.assetId;
        if (!assetId) throw new Error('Expected an imported audio asset');
        const run = await editor.assets.analyze(assetId).completion;
        if (run.status !== 'analyzed')
          throw new Error('Expected a local checkpoint');
      } finally {
        await editor.dispose();
      }
    }, base);
    await page.reload();
    await page
      .getByRole('button', { name: 'Open project', exact: true })
      .click();
    await page
      .getByRole('main', { name: 'Projects', exact: true })
      .getByRole('button', { name: /^Audio indexing/ })
      .click();
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    await page.keyboard.press('Escape');
    let dialog = await connect(page);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.locator('.media-item')).not.toContainText(
      'Choose a chat model supporting audio inputs to index this asset.',
    );
    await page
      .getByRole('button', { name: 'Asset details for tone.wav' })
      .focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('tooltip', { name: /^tone\.wav / }),
    ).toContainText(
      'Choose a chat model supporting audio inputs to index this asset.',
    );
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .focus();
    await expect(await indexAction(page, 'Index', 'tone.wav')).toBeDisabled();
    await page.keyboard.press('Escape');
    expect(bodies).toHaveLength(0);
    await catalog(context, true);
    await page.keyboard.press('Escape');
    dialog = await settings(page);
    await selectAISettingsTab(page, 'LLM - Chat');
    await dialog
      .getByRole('combobox', { name: 'AI model', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Refresh models', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Refresh models', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('option', { name: 'Visual chat · ' + model, exact: true })
      .click();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await clickIndexAction(page, 'Retry indexing', 'tone.wav');
    await expect(await indexAction(page, 'Reindex', 'tone.wav')).toBeVisible();
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[0])).toContain('input_audio');
    expect(JSON.stringify(bodies[0])).not.toContain('image_url');
    await clickIndexAction(page, 'View index results', 'tone.wav');
    const audio = page.getByLabel('Indexed audio excerpt');
    await expect(audio).toBeVisible();
    await expect
      .poll(() => audio.evaluate((el) => (el as HTMLAudioElement).duration))
      .toBe(1);
  });
}

for (const base of ['/', '/LocalCut/']) {
  for (const framesOnly of [false, true]) {
    test(`workspace indexing video ${framesOnly ? 'frames with image model' : 'clips with video model'} ${base}`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await catalog(context, false, !framesOnly);
      const bodies: { messages: { content: unknown }[] }[] = [];
      await context.route(
        'https://openrouter.ai/api/v1/chat/completions',
        async (route) => {
          if (route.request().method() === 'OPTIONS') {
            await route.fulfill({ headers: cors });
            return;
          }
          const body = route.request().postDataJSON();
          bodies.push(body);
          const content = body.messages.at(-1).content;
          const prompt = Array.isArray(content) ? content[0].text : content;
          const sceneId =
            Array.isArray(content) && content.length > 1
              ? /"sceneId":"(scene-\d+)"/.exec(prompt)?.[1]
              : undefined;
          await route.fulfill({
            headers: cors,
            contentType: 'text/event-stream',
            body: `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(sceneId ? { sceneId, label } : label) }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
          });
        },
      );
      await page.goto(base);
      await page
        .getByRole('button', { name: 'Workspace settings', exact: true })
        .click();
      await page
        .getByRole('menuitem', { name: 'Project', exact: true })
        .click();
      await page
        .getByRole('menuitem', { name: 'New project', exact: true })
        .click();
      await page
        .getByLabel('Project name', { exact: true })
        .fill('Video indexing');
      await page
        .getByRole('button', { name: 'Create project', exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: 'Undo', exact: true }),
      ).toBeVisible();
      const dialog = await connect(page);
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
      await page.locator('#mobile-media-trigger').click();
      await page
        .getByLabel('Import media', { exact: true })
        .setInputFiles(await mediaVideo(page));
      await closeMediaImport(page);
      const thumbnail = page.getByRole('img', {
        name: 'Thumbnail for green.webm',
      });
      await expect(thumbnail).toBeVisible();
      await expect
        .poll(() =>
          thumbnail.evaluate((el) => (el as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(0);
      const action = framesOnly ? 'Index video frames' : 'Index';
      if (framesOnly) {
        await indexAction(page, action, 'green.webm');
        await expect(
          page.getByText('Labels use still frames.', { exact: false }),
        ).toBeVisible();
      }
      await clickIndexAction(page, action, 'green.webm');
      await expect(
        page.getByRole('status', { name: 'Indexed', exact: true }),
      ).toBeVisible();
      expect(bodies).toHaveLength(2);
      const request = JSON.stringify(bodies[0]);
      expect(request).toContain('image_url');
      if (framesOnly) {
        expect(request).not.toContain('video_url');
        expect(request).toContain('do not infer motion or sound');
      } else expect(request).toContain('video_url');
      await clickIndexAction(page, 'View index results', 'green.webm');
      const history = page.getByRole('dialog', {
        name: 'Asset index',
        exact: true,
      });
      await expect(
        history.getByRole('img', { name: 'Indexed representative frame' }),
      ).toBeVisible();
      await expect(history.locator('video')).toBeVisible();
      if (framesOnly)
        await expect(
          history.getByText('Not assessed from still frames', { exact: true }),
        ).toBeVisible();
      await page.keyboard.press('Escape');
      await page.reload();
      await page.locator('#mobile-media-trigger').click();
      await expect(
        page.getByRole('status', { name: 'Indexed', exact: true }),
      ).toBeVisible();
      await expect(thumbnail).toBeVisible();
      await clickIndexAction(page, 'View index results', 'green.webm');
      await history
        .getByRole('button', { name: 'Delete this run', exact: true })
        .click();
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('status', { name: 'Indexed', exact: true }),
      ).toHaveCount(0);
      if (framesOnly) {
        await catalog(context, false, false, false);
        const configuration = await settings(page);
        await selectAISettingsTab(page, 'LLM - Chat');
        await configuration
          .getByRole('combobox', { name: 'AI model', exact: true })
          .click();
        await page
          .getByRole('button', { name: 'Refresh models', exact: true })
          .click();
        await page
          .getByRole('option', { name: 'Visual chat · ' + model, exact: true })
          .click();
        await configuration
          .getByRole('button', { name: 'Done', exact: true })
          .click();
        const preview = page.getByRole('button', {
          name: 'Asset details for green.webm',
        });
        await preview.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await expect(
          page.getByRole('tooltip', { name: /^green\.webm / }),
        ).toContainText(
          'Choose a chat model supporting image inputs to index this asset.',
        );
        await expect(
          await indexAction(page, 'Index', 'green.webm'),
        ).toBeDisabled();
        expect(bodies).toHaveLength(2);
      }
    });
  }
}

for (const base of ['/', '/LocalCut/']) {
  test(`chat resolves named nested Media without attachments before evidence storyboard ${base}`, async ({
    page,
    context,
  }) => {
    await catalog(context);
    let step = 0;
    let evidenceRequests = 0;
    let assetId = '';
    let folderId = '';
    let libraryRevision = -1;
    const manifests: Record<string, unknown>[] = [];
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ headers: cors });
          return;
        }
        if (await fulfillChatTitle(route)) return;
        const body = route.request().postDataJSON();
        let reply: string | null = null;
        let tool_calls: object[] | undefined;
        if (body.tools) {
          const scope = JSON.parse(body.messages[1].content);
          const loaded = scope.capabilityMap.loadedSkills as string[];
          const invoke = (name: string, args: unknown) => {
            expect(
              body.tools.map(
                (tool: { function: { name: string } }) => tool.function.name,
              ),
            ).toContain(name);
            tool_calls = [
              {
                index: 0,
                id: crypto.randomUUID(),
                type: 'function',
                function: { name, arguments: JSON.stringify(args) },
              },
            ];
          };
          if (step < 5 && !loaded.includes('indexing'))
            invoke('load_skill', { skillId: 'indexing' });
          else if (step === 0) {
            expect(scope.availableAssetIds).toEqual([]);
            invoke('inspect_library', {});
            step++;
          } else if (step === 1) {
            const tree = JSON.parse(body.messages.at(-1).content);
            expect(tree).toMatchObject({
              status: 'assets_withheld',
              childrenResolved: false,
              registeredAssetCount: 1,
              authorizedAssetCount: 0,
            });
            expect(
              tree.entries.find(
                (entry: { id: string }) => entry.id === folderId,
              ),
            ).toMatchObject({
              name: 'Sydney',
              assetCount: 1,
              childrenResolved: false,
            });
            invoke('resolve_library_assets', {
              folderId,
              expectedRevision: libraryRevision,
              recursive: true,
            });
            step++;
          } else if (step === 2) {
            const manifest = JSON.parse(body.messages.at(-1).content);
            manifests.push(manifest);
            expect(manifest).toMatchObject({
              assetIds: [assetId],
              assetCount: 1,
              status: 'resolved',
              indexingSubmitted: false,
            });
            expect(evidenceRequests).toBe(0);
            expect(scope.availableAssetIds).toEqual([assetId]);
            invoke('inspect_asset', { assetId });
            step++;
          } else if (step === 3) {
            reply = `Resolved 1 Sydney asset: ${assetId}.`;
            invoke('propose_action', {
              summary: 'Index the resolved Sydney image',
              action: { type: 'index_asset', assetId },
            });
            step++;
          } else if (step === 4) {
            expect(scope.assetIndex.assets[0]).toMatchObject({
              assetId,
              summary: label.summary,
            });
            invoke('read_asset_index', { assetId });
            step++;
          } else if (step === 5) {
            expect(JSON.stringify(body.messages)).toContain(label.summary);
            invoke('load_skill', { skillId: 'storyboard' });
            step++;
          } else if (step === 6) {
            invoke('propose_edits', {
              summary: 'Build a shot note from saved evidence',
              operations: [
                {
                  type: 'upsertStoryboardElements',
                  elements: [
                    {
                      id: 'observed-note',
                      type: 'text',
                      x: 0,
                      y: 0,
                      text: `${label.summary} · ${assetId}`,
                    },
                  ],
                },
              ],
            });
            step++;
          } else
            reply =
              'Indexed the Sydney image and saved an evidence-based shot note.';
        } else {
          evidenceRequests++;
          const part = body.messages.at(-1).content;
          const sceneId =
            Array.isArray(part) && part.length > 1
              ? /"sceneId":"(scene-\d+)"/.exec(String(part[0].text))?.[1]
              : undefined;
          reply = JSON.stringify(sceneId ? { sceneId, label } : label);
        }
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { ...(reply ? { content: reply } : {}), ...(tool_calls ? { tool_calls } : {}) }, finish_reason: tool_calls ? 'tool_calls' : 'stop' }], model })}\n\ndata: [DONE]\n\n`,
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
    await page
      .getByLabel('Project name', { exact: true })
      .fill('Container evidence');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Import media', exact: true }).first(),
    ).toBeEnabled();
    await image(page);
    const state = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const project = (await editor.projects.list()).find(
          (item) => item.name === 'Container evidence',
        )!;
        const owner = editor.library.forProject(project.id);
        let library = await owner.list();
        const entry = library.entries.find((entry) => entry.assetId)!;
        library = await owner.apply(
          { type: 'create', parentId: null, name: 'Sydney' },
          library.revision,
        );
        const folderId = library.entries.find(
          (entry) => entry.name === 'Sydney',
        )!.id;
        library = await owner.apply(
          { type: 'create', parentId: folderId, name: 'Day 1' },
          library.revision,
        );
        const nested = library.entries.find(
          (entry) => entry.name === 'Day 1',
        )!.id;
        library = await owner.apply(
          { type: 'move', entryId: entry.id, parentId: nested },
          library.revision,
        );
        library = await owner.apply(
          { type: 'copy', entryId: folderId, parentId: null },
          library.revision,
        );
        const copy = library.entries.find(
          (item) =>
            item.parentId === null &&
            item.id !== folderId &&
            item.kind === 'folder',
        )!;
        library = await owner.apply(
          { type: 'trash', entryId: copy.id },
          library.revision,
        );
        return {
          clips: (await editor.projects.snapshot(project.id)).tracks.flatMap(
            (track) => track.clips,
          ),
          folderId,
          assetId: entry.assetId!,
          revision: library.revision,
        };
      } finally {
        await editor.dispose();
      }
    }, base);
    expect(state.clips).toEqual([]);
    assetId = state.assetId;
    folderId = state.folderId;
    libraryRevision = state.revision;
    await page.reload();
    const dialog = await connect(page);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Describe your edit' })
      .fill(
        'Index all media in Sydney and build a storyboard from the observed footage.',
      );
    await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .click();
    await expect(
      page
        .getByRole('article', { name: 'Assistant response', exact: true })
        .last(),
    ).toContainText('saved an evidence-based shot note');
    expect(manifests).toHaveLength(1);
    expect(evidenceRequests).toBe(2);
    expect(step).toBe(7);
    await page.reload();
    const persisted = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const project = (await editor.projects.list()).find(
          (item) => item.name === 'Container evidence',
        )!;
        const saved = await editor.projects.snapshot(project.id);
        return {
          text: saved.storyboard?.elements.find(
            (element) => element.id === 'observed-note',
          )?.text,
          clips: saved.tracks.flatMap((track) => track.clips),
          indexes: (await editor.assets.indexes.list())
            .filter((run) => run.status === 'complete')
            .map((run) => run.assetId),
        };
      } finally {
        await editor.dispose();
      }
    }, base);
    expect(persisted).toEqual({
      text: `${label.summary} · ${assetId}`,
      clips: [],
      indexes: [assetId],
    });
  });
}
