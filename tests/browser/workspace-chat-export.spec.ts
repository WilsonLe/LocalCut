import { selectAISettingsTab } from './workspace-settings-helper';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from '@playwright/test';
import type { Download, Page, BrowserContext } from '@playwright/test';
import {
  openAISettings,
  prepareOpenRouterKey,
} from './workspace-settings-helper';
import { fulfillChatTitle } from './chat-title-fixture';
import type { ChatExportSnapshot } from '../../src/services/chat-export';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
async function setup(page: Page, context: BrowserContext, base: string) {
  await context.route('https://openrouter.ai/api/v1/models', (route) =>
    route.fulfill({
      headers: cors,
      json: {
        data: [
          {
            id: 'test/export',
            name: 'Export model',
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
  await page.getByLabel('Project name').fill('Chat export project');
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await openAISettings(page);
  await prepareOpenRouterKey(page);
  const settings = page.getByRole('dialog', {
    name: 'AI connection',
    exact: true,
  });
  await settings.getByLabel('OpenRouter API key').fill('synthetic-export-key');
  await settings
    .getByRole('button', { name: 'Use API key', exact: true })
    .click();
  await selectAISettingsTab(page, 'LLM - Chat');
  await settings
    .getByRole('combobox', { name: 'AI model', exact: true })
    .click();
  await page
    .getByRole('option', { name: 'Export model · test/export', exact: true })
    .click();
  await settings.getByRole('button', { name: 'Done', exact: true }).click();
}
async function archive(download: Download) {
  expect(download.suggestedFilename()).toMatch(/^localcut-chat-.+\.zip$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const files = unzipSync(new Uint8Array(Buffer.concat(chunks)));
  expect(Object.keys(files)).toEqual(['chat.md', 'chat.json']);
  return {
    snapshot: JSON.parse(strFromU8(files['chat.json']!)) as ChatExportSnapshot,
    markdown: strFromU8(files['chat.md']!),
  };
}
async function save(page: Page, label: string | RegExp) {
  const row = page.getByRole('row', { name: label, exact: true });
  await expect(row).toContainText('completed');
  await row.getByRole('button', { name: 'Task details', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Save result', exact: true }).click();
  return archive(await downloaded);
}

for (const base of ['/', '/LocalCut/']) {
  test(`chat export recovers an abandoned running archive before chat UI loads ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const namespace = `test-chat-export-${crypto.randomUUID()}`;
    const outcome = await page.evaluate(
      async ({ base, namespace }) => {
        const id = 'abandoned-chat-export';
        const captured = {
          version: 1,
          sessionId: 'old-session',
          projectId: 'old-project',
          title: 'Original capture',
          exportedAt: '2026-10-12T01:00:00.000Z',
          messages: [
            {
              id: 'message-1',
              role: 'user',
              text: 'Retained before closing',
              status: 'complete',
              proposalIds: [],
            },
          ],
          proposals: [],
          draft: { text: '', attachments: [] },
        };
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(`${namespace}-tasks-v1`, 1);
          request.onupgradeneeded = () => {
            request.result.createObjectStore('tasks', { keyPath: 'id' });
            request.result.createObjectStore('inputs');
            request.result.createObjectStore('results');
          };
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(['tasks', 'inputs'], 'readwrite');
            tx.objectStore('tasks').add({
              version: 1,
              id,
              kind: 'chat.export.v1',
              label: 'Abandoned export',
              lane: 'chat-export',
              state: 'running',
              stage: 'Preparing chat archive…',
              attempts: 1,
              maxAttempts: 3,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
            tx.objectStore('inputs').add(captured, id);
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error);
          });
        } finally {
          db.close();
        }
        const { createEditor } = await import(base + 'editor.js');
        const editor = await createEditor({ namespace });
        try {
          let task;
          for (let attempt = 0; attempt < 100; attempt++) {
            await editor.tasks.poll();
            task = await editor.tasks.get(id);
            if (['completed', 'interrupted', 'failed'].includes(task?.state))
              break;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          const result = await editor.tasks.result(id);
          return {
            state: task?.state,
            error: task?.error,
            bytes: result?.file
              ? Array.from(new Uint8Array(await result.file.arrayBuffer()))
              : [],
          };
        } finally {
          await editor.dispose();
        }
      },
      { base, namespace },
    );
    expect(outcome.state).toBe('completed');
    expect(outcome.error).toBeUndefined();
    const zip = unzipSync(Uint8Array.from(outcome.bytes));
    expect(JSON.parse(strFromU8(zip['chat.json']!))).toMatchObject({
      title: 'Original capture',
      messages: [{ text: 'Retained before closing' }],
    });
    await expect(
      page.getByRole('textbox', { name: 'Describe your edit', exact: true }),
    ).toHaveCount(0);
  });
  test(`chat export captures an unfinished response without stopping it ${base}`, async ({
    page,
    context,
  }) => {
    let release!: () => void;
    let requested!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const arrived = new Promise<void>((resolve) => {
      requested = resolve;
    });
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        if (route.request().method() === 'OPTIONS')
          return route.fulfill({ headers: cors, body: '' });
        if (await fulfillChatTitle(route, 'Unfinished edit')) return;
        requested();
        await pending;
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Finished later.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
        });
      },
    );
    try {
      await setup(page, context, base);
      const input = page.getByRole('textbox', {
        name: 'Describe your edit',
        exact: true,
      });
      await input.fill('Take your time');
      await input.press('Enter');
      await arrived;
      await page
        .getByRole('button', { name: 'Export chat', exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: 'Cancel response', exact: true }),
      ).toBeVisible();
      release();
      await expect(
        page.getByRole('article', { name: 'Assistant response' }),
      ).toContainText('Finished later.');
      await page
        .getByRole('button', { name: 'Task queue', exact: true })
        .click();
      const saved = await save(page, /^Export chat:/);
      expect(saved.snapshot.messages[1]).toMatchObject({
        status: 'streaming',
        text: '',
      });
      expect(saved.markdown).not.toContain('Finished later.');
    } finally {
      release();
    }
  });
  test(`chat export queues isolated snapshots, recovers after reload and saves archives ${base}`, async ({
    page,
    context,
  }, testInfo) => {
    let requests = 0;
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        if (route.request().method() === 'OPTIONS')
          return route.fulfill({ headers: cors, body: '' });
        requests++;
        if (await fulfillChatTitle(route, 'My exported edit')) return;
        const final =
          route.request().postDataJSON().messages.at(-1).role === 'tool';
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: final ? { content: 'Ready **to edit**. Tiếng Việt.' } : { tool_calls: [{ index: 0, id: 'inspect', type: 'function', function: { name: 'inspect_project', arguments: '{}' } }] }, finish_reason: final ? 'stop' : 'tool_calls' }] })}\n\ndata: [DONE]\n\n`,
        });
      },
    );
    await setup(page, context, base);
    const input = page.getByRole('textbox', {
      name: 'Describe your edit',
      exact: true,
    });
    const exportButton = page.getByRole('button', {
      name: 'Export chat',
      exact: true,
    });
    await expect(exportButton).toHaveCount(0);
    await input.fill('First unsent draft');
    await expect(
      page
        .locator('.conversation-heading')
        .getByRole('button', { name: 'Export chat', exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator('.workspace-header')
        .getByRole('button', { name: 'Export chat', exact: true }),
    ).toHaveCount(0);
    // Hold only this task lane, so capture and reload recovery are observable.
    await page.evaluate(async () => {
      await new Promise<void>((acquired) => {
        void navigator.locks.request(
          'localcut-tasks-lane-chat-export',
          async () => {
            acquired();
            await new Promise<void>((resolve) =>
              Object.assign(window, { releaseChatExportLane: resolve }),
            );
          },
        );
      });
    });
    await exportButton.focus();
    await page.keyboard.press('Enter');
    await input.fill('Changed after capture');
    await page.getByRole('button', { name: 'Task queue', exact: true }).click();
    const queue = page.getByRole('dialog', { name: 'Task queue', exact: true });
    const firstRow = queue.getByRole('row', {
      name: 'Export chat: New chat',
      exact: true,
    });
    await expect(firstRow).toContainText('queued');
    await firstRow
      .getByRole('button', { name: 'Cancel task', exact: true })
      .click();
    await expect(firstRow).toContainText('cancelled');
    await firstRow
      .getByRole('button', { name: 'Retry task', exact: true })
      .click();
    await expect(firstRow).toContainText('queued');
    await page.reload(); // Releases the lane and resumes from the durable input.
    await page.getByRole('button', { name: 'Task queue', exact: true }).click();
    const first = await save(page, 'Export chat: New chat');
    expect(first.snapshot.messages).toEqual([]);
    expect(first.snapshot.draft.text).toBe('First unsent draft');
    expect(first.markdown).not.toContain('Changed after capture');
    expect(requests).toBe(0);
    await page
      .getByRole('dialog', { name: 'Task queue', exact: true })
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await input.fill('Please inspect');
    await input.press('Enter');
    await expect(
      page.getByRole('article', { name: 'Assistant response' }),
    ).toContainText('Ready to edit. Tiếng Việt.');
    await expect(
      page.getByRole('button', { name: 'Chat sessions', exact: true }),
    ).toContainText('My exported edit');
    await input.fill('Second unsent draft');
    const countBeforeExport = requests;
    await page.reload();
    await expect(input).toHaveValue('Second unsent draft');
    await expect(
      page.getByRole('article', { name: 'Assistant response' }),
    ).toContainText('Ready to edit. Tiếng Việt.');
    expect(requests).toBe(countBeforeExport);
    await page.screenshot({
      path: testInfo.outputPath('chat-export-desktop.png'),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('navigation', { name: 'Workspace sections' })
      .getByRole('button', { name: 'Chat', exact: true })
      .click();
    await expect(exportButton).toBeVisible();
    const bounds = await exportButton.boundingBox();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    const titleBounds = await page
      .getByRole('button', { name: 'Chat sessions', exact: true })
      .boundingBox();
    expect(titleBounds!.width).toBeGreaterThan(150);
    await page.screenshot({
      path: testInfo.outputPath('chat-export-mobile.png'),
    });
    await page.setViewportSize({ width: 320, height: 740 });
    const smallest = await exportButton.boundingBox();
    const collapse = await page
      .getByRole('button', { name: 'Collapse chat', exact: true })
      .boundingBox();
    expect(smallest!.x + smallest!.width).toBeLessThanOrEqual(collapse!.x);
    await exportButton.click();
    // Switch away from the exported session without changing its captured state.
    await page
      .getByRole('button', { name: 'Chat sessions', exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'New conversation', exact: true })
      .click();
    await expect(input).toHaveValue('');
    await expect(exportButton).toHaveCount(0);
    await page.getByRole('button', { name: 'Task queue', exact: true }).click();
    const complete = await save(page, 'Export chat: My exported edit');
    expect(complete.snapshot.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(complete.snapshot.messages[1]!.tools![0]).toMatchObject({
      name: 'inspect_project',
      phase: 'completed',
    });
    expect(complete.markdown).toContain('Ready **to edit**. Tiếng Việt.');
    expect(complete.snapshot.draft.text).toBe('Second unsent draft');
    expect(JSON.stringify(complete.snapshot)).not.toContain(
      'synthetic-export-key',
    );
    expect(requests).toBe(countBeforeExport);
    await page.reload();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole('button', { name: 'Task queue', exact: true }).click();
    expect(
      (await save(page, 'Export chat: My exported edit')).snapshot,
    ).toEqual(complete.snapshot);
  });
}
