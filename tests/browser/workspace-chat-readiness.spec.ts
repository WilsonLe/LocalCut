import {
  showOpenRouterTerms,
  selectAISettingsTab,
  prepareOpenRouterKey,
  openAISettings,
} from './workspace-settings-helper';
import { fulfillChatTitle } from './chat-title-fixture';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { SavedChatSession } from '../../src/storage/chats';

async function savedChats(page: Page): Promise<SavedChatSession[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('localcut-chats-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('sessions');
        const request = tx.objectStore('sessions').getAll();
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });
}

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
for (const base of ['/', '/LocalCut/']) {
  test(`chat readiness and persisted sessions recover after connecting and reloading ${base}`, async ({
    page,
    context,
  }, testInfo) => {
    let completions = 0;
    let titles = 0;
    const requests: { role: string; content: string }[][] = [];
    await context.route('https://openrouter.ai/api/v1/models', (route) =>
      route.fulfill({
        headers: cors,
        json: {
          data: [
            {
              id: 'test/chat',
              name: 'Chat model',
              context_length: 512000,
              supported_parameters: ['tools', 'tool_choice'],
            },
            {
              id: 'test/alternative',
              name: 'Alternative model',
              context_length: 512000,
              supported_parameters: ['tools', 'tool_choice'],
            },
          ],
        },
      }),
    );
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        if (route.request().method() === 'OPTIONS')
          return route.fulfill({ headers: cors, body: '' });
        expect(route.request().postDataJSON().model).toBe('test/chat');
        if (await fulfillChatTitle(route)) {
          titles++;
          return;
        }
        completions++;
        requests.push(route.request().postDataJSON().messages);
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
    await expect(composer).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Connect provider', exact: true }),
    ).toBeVisible();
    await openAISettings(page);
    const settings = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await prepareOpenRouterKey(page);
    await settings
      .getByLabel('OpenRouter API key', { exact: true })
      .fill('synthetic-readiness-key');
    await settings
      .getByRole('button', { name: 'Use API key', exact: true })
      .click();
    await selectAISettingsTab(page, 'Providers');
    await expect(
      settings.getByRole('button', { name: 'Verify OpenRouter', exact: true }),
    ).toBeVisible();
    await settings.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(
      page.getByText('Choose an AI model to start chatting.', { exact: true }),
    ).toBeVisible();
    await expect(composer).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Choose AI model', exact: true })
      .click();
    await expect(
      settings.getByRole('combobox', {
        name: 'AI settings section',
        exact: true,
      }),
    ).toContainText('LLM - Chat');
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
    await test.step('legacy indexing choices migrate without hiding either chat history', async () => {
      await expect.poll(async () => (await savedChats(page)).length).toBe(1);
      const original = (await savedChats(page))[0]!;
      await page.evaluate(async (original) => {
        const request = indexedDB.open('localcut-chats-v1');
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const tx = db.transaction(['sessions', 'selection'], 'readwrite');
        const scope = JSON.parse(original.scope);
        for (const allowed of [false, true]) {
          const legacyScope = JSON.stringify([
            ...scope.slice(0, 4),
            false,
            false,
            false,
            allowed,
          ]);
          tx.objectStore('sessions').put({
            ...original,
            scope: legacyScope,
            id: `legacy-${allowed}`,
            title: `Legacy indexing ${allowed}`,
            titleLocked: true,
            content: {
              prompt: `Draft ${allowed}`,
              attachmentIds: [],
              messages: [
                {
                  id: `u-${allowed}`,
                  role: 'user',
                  text: `Question ${allowed}`,
                  status: 'complete',
                },
                {
                  id: `a-${allowed}`,
                  role: 'assistant',
                  text: `Answer ${allowed}`,
                  status: 'complete',
                },
              ],
            },
          });
          tx.objectStore('selection').put(`legacy-${allowed}`, legacyScope);
          tx.objectStore('sessions').put({
            ...original,
            scope: legacyScope,
            id: `archived-${allowed}`,
            title: `Archived ${allowed}`,
            archived: true,
          });
        }
        tx.objectStore('selection').delete(original.scope);
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        db.close();
        localStorage.setItem(
          'localcut.asset-index-consent.v1',
          JSON.stringify({
            version: 1,
            provider: 'openrouter',
            allowed: false,
          }),
        );
      }, original);
      await page.reload();
      await expect(composer).toHaveValue('Draft true');
      const picker = page.getByRole('button', {
        name: 'Chat sessions',
        exact: true,
      });
      await picker.click();
      await expect(
        page.getByRole('menuitemradio', { name: /Legacy indexing true/ }),
      ).toBeVisible();
      await page
        .getByRole('menuitemradio', { name: /Legacy indexing false/ })
        .click();
      await expect(composer).toHaveValue('Draft false');
      await expect(
        page.getByRole('log', { name: 'Conversation messages' }),
      ).toContainText('Answer false');
      await page.reload();
      await expect(composer).toHaveValue('Draft false');
      await expect.poll(async () => (await savedChats(page)).length).toBe(5);
      const migrated = await savedChats(page);
      expect(migrated.every((chat) => chat.scope === original.scope)).toBe(
        true,
      );
      expect(migrated.filter((chat) => chat.archived)).toHaveLength(2);
      expect(
        migrated
          .filter((chat) => chat.id.startsWith('legacy-'))
          .every((chat) => chat.titleLocked),
      ).toBe(true);
      expect(completions).toBe(0);
      await picker.click();
      await page
        .getByRole('menuitemradio', { name: 'New chat', exact: true })
        .click();
    });
    await composer.fill('Hello');
    await send.click();
    await expect(
      page.getByRole('log', { name: 'Conversation messages' }),
    ).toContainText('Ready to edit.');
    expect(completions).toBe(1);
    await expect(
      page.getByRole('button', { name: 'Chat sessions', exact: true }),
    ).toContainText('Editing session title');
    await composer.fill('An unsent draft');
    await expect
      .poll(async () =>
        (await savedChats(page)).some(
          (chat) =>
            chat.content.prompt === 'An unsent draft' &&
            chat.content.messages.some(
              (message) => message.text === 'Ready to edit.',
            ),
        ),
      )
      .toBe(true);
    await page.reload();
    await expect(composer).toBeEnabled();
    await expect(composer).toHaveValue('An unsent draft');
    await expect(
      page.getByRole('log', { name: 'Conversation messages' }),
    ).toContainText('Hello');
    await expect(
      page.getByRole('log', { name: 'Conversation messages' }),
    ).toContainText('Ready to edit.');
    expect(completions).toBe(1);
    // Bare startup restores the recent project without another inference request.
    await page.goto(base);
    await expect(composer).toBeEnabled();
    await expect(page).toHaveURL(/#\/project\/[^/]+$/);
    expect(completions).toBe(1);
    await composer.fill('Hello again');
    await composer.press('Enter');
    await expect(
      page.getByRole('log', { name: 'Conversation messages' }),
    ).toContainText('Ready to edit.');
    await expect(
      page.getByRole('button', { name: 'Branch response', exact: true }),
    ).toHaveCount(2);
    expect(completions).toBe(2);
    expect(requests[1]).toContainEqual({ role: 'user', content: 'Hello' });
    expect(requests[1]).toContainEqual({
      role: 'assistant',
      content: 'Ready to edit.',
    });
    expect(requests[1]!.some((message) => message.role === 'tool')).toBe(false);

    // Branches retain transcript and selection through a fresh UI/assistant.
    await page
      .getByRole('button', { name: 'Branch response', exact: true })
      .last()
      .click();
    await expect(
      page.getByRole('button', { name: 'Chat sessions', exact: true }),
    ).toContainText('Branch of Editing session title');
    await composer.fill('A branch draft');
    await expect
      .poll(async () =>
        (await savedChats(page)).some(
          (chat) => chat.content.prompt === 'A branch draft',
        ),
      )
      .toBe(true);
    await page.reload();
    await expect(composer).toHaveValue('A branch draft');
    await expect(
      page.getByRole('button', { name: 'Chat sessions', exact: true }),
    ).toContainText('Branch of Editing session title');
    expect(completions).toBe(2);

    await test.step('rename, fork, archive and restore retain independent sessions', async () => {
      const picker = page.getByRole('button', {
        name: 'Chat sessions',
        exact: true,
      });
      await picker.click();
      for (const name of [
        'New conversation',
        'Rename chat',
        'Fork chat',
        'Archive chat',
      ]) {
        const action = page.getByRole('menuitem', { name, exact: true });
        await expect(action).toHaveText('');
        await expect(action.locator('svg')).toHaveCount(1);
        await expect(action).not.toHaveClass(/bg-primary/);
        const box = await action.boundingBox();
        expect(box?.width).toBe(36);
        expect(box?.height).toBe(36);
      }
      await page.screenshot({
        path: testInfo.outputPath('chat-icon-actions.png'),
      });
      const rename = page.getByRole('menuitem', {
        name: 'Rename chat',
        exact: true,
      });
      await rename.hover();
      await expect(page.getByRole('tooltip')).toHaveText('Rename chat');
      await rename.focus();
      await rename.press('Enter');
      const dialog = page.getByRole('dialog', {
        name: 'Rename chat',
        exact: true,
      });
      await dialog.getByLabel('Chat title', { exact: true }).fill('   ');
      await expect(
        dialog.getByRole('button', { name: 'Save title', exact: true }),
      ).toHaveCount(0);
      await expect(dialog.getByRole('status')).toContainText('Enter a title');
      await dialog
        .getByLabel('Chat title', { exact: true })
        .fill('  My project edit  ');
      await dialog.getByLabel('Chat title', { exact: true }).press('Enter');
      await expect(picker).toContainText('My project edit');
      await expect(picker).toBeFocused();
      await picker.click();
      await page
        .getByRole('menuitem', { name: 'Fork chat', exact: true })
        .click();
      await expect(picker).toContainText('Fork of My project edit');
      await expect(composer).toHaveValue('A branch draft');
      await expect(
        page.getByRole('log', { name: 'Conversation messages' }),
      ).toContainText('Hello again');
      await composer.fill('Fork-only draft');
      await expect
        .poll(async () =>
          (await savedChats(page)).some(
            (chat) =>
              chat.title === 'Fork of My project edit' &&
              chat.content.prompt === 'Fork-only draft',
          ),
        )
        .toBe(true);
      await picker.click();
      await page
        .getByRole('menuitem', { name: 'Archive chat', exact: true })
        .click();
      await expect(picker).not.toContainText('Fork of My project edit');
      await expect
        .poll(async () =>
          (await savedChats(page)).some(
            (chat) => chat.title === 'Fork of My project edit' && chat.archived,
          ),
        )
        .toBe(true);
      await page.reload();
      await expect(composer).toBeEnabled();
      await picker.click();
      await expect(
        page.getByRole('menuitemradio', {
          name: 'Fork of My project edit',
          exact: true,
        }),
      ).toHaveCount(0);
      await page
        .getByRole('button', { name: 'Show archived chats', exact: true })
        .click();
      await page.screenshot({
        path: testInfo.outputPath('chat-archive-picker.png'),
      });
      await page
        .getByRole('menuitem', {
          name: 'Restore Fork of My project edit',
          exact: true,
        })
        .click();
      await expect(picker).toContainText('Fork of My project edit');
      await expect(composer).toHaveValue('Fork-only draft');
      await expect
        .poll(async () =>
          (await savedChats(page)).some(
            (chat) =>
              chat.title === 'Fork of My project edit' && !chat.archived,
          ),
        )
        .toBe(true);
      await page.reload();
      await expect(picker).toContainText('Fork of My project edit');
      await picker.click();
      await page
        .getByRole('menuitemradio', { name: 'My project edit', exact: true })
        .click();
      await expect(composer).toHaveValue('A branch draft');
      expect(completions).toBe(2);
      expect(titles).toBe(1);
    });

    // Tabs create distinct sessions and patch only their own record.
    await page
      .getByRole('button', { name: 'Chat sessions', exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'New conversation', exact: true })
      .click();
    await composer.fill('First tab draft');
    await expect
      .poll(async () =>
        (await savedChats(page)).some(
          (chat) => chat.content.prompt === 'First tab draft',
        ),
      )
      .toBe(true);
    const second = await context.newPage();
    const projectUrl = page.url();
    await second.goto(projectUrl);
    await expect(
      second.getByRole('textbox', { name: 'Describe your edit', exact: true }),
    ).toHaveValue('First tab draft');
    await second
      .getByRole('button', { name: 'Chat sessions', exact: true })
      .click();
    await second
      .getByRole('menuitem', { name: 'New conversation', exact: true })
      .click();
    await second
      .getByRole('textbox', { name: 'Describe your edit', exact: true })
      .fill('Second tab draft');
    await expect
      .poll(
        async () =>
          (await savedChats(page)).filter((chat) =>
            ['First tab draft', 'Second tab draft'].includes(
              chat.content.prompt,
            ),
          ).length,
      )
      .toBe(2);
    await page.reload();
    await expect(composer).toHaveValue('Second tab draft');

    // OpenRouter context sharing is stable across restored connections.
    await openAISettings(page);
    await expect(
      settings.getByRole('button', { name: 'Data & analytics' }),
    ).toHaveCount(0);
    const terms1 = await showOpenRouterTerms(page);
    await expect(terms1).toContainText('including after reload');
    await page
      .getByRole('button', { name: 'OpenRouter connection terms', exact: true })
      .click();
    await settings.getByRole('button', { name: 'Done', exact: true }).click();
    await page.reload();
    await expect(composer).toHaveValue('Second tab draft');
    expect(completions).toBe(2);

    // Model changes keep a separate context and restore it on return.
    await openAISettings(page);
    await selectAISettingsTab(page, 'LLM - Chat');
    await settings
      .getByRole('combobox', { name: 'AI model', exact: true })
      .click();
    await page
      .getByRole('option', {
        name: 'Alternative model · test/alternative',
        exact: true,
      })
      .click();
    await settings.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(composer).toHaveValue('');
    await composer.fill('Alternative model draft');
    await expect
      .poll(async () =>
        (await savedChats(page)).some(
          (chat) => chat.content.prompt === 'Alternative model draft',
        ),
      )
      .toBe(true);
    await openAISettings(page);
    await selectAISettingsTab(page, 'LLM - Chat');
    await settings
      .getByRole('combobox', { name: 'AI model', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'Chat model · test/chat', exact: true })
      .click();
    await settings.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(composer).toHaveValue('Second tab draft');

    // A real imported image remains an explicit unsent local reference after reload.
    const imageId = await page.evaluate(async (base) => {
      const { createEditor } = await import(base + 'editor.js');
      const editor = await createEditor();
      try {
        const canvas = new OffscreenCanvas(16, 16);
        canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
        const asset = await editor.assets.import(
          await canvas.convertToBlob({ type: 'image/png' }),
          'Saved reference.png',
        ).completion;
        return asset.id;
      } finally {
        await editor.dispose();
      }
    }, base);
    const imageDrop = await page.evaluateHandle((id) => {
      const transfer = new DataTransfer();
      transfer.setData('application/x-localcut-image', id);
      return transfer;
    }, imageId);
    await page
      .locator('.conversation-session:not([hidden]) .chat-composer')
      .dispatchEvent('drop', { dataTransfer: imageDrop });
    await imageDrop.dispose();
    await expect(page.getByLabel('Attached images')).toContainText(
      'Saved reference.png',
    );
    await expect
      .poll(async () =>
        (await savedChats(page)).some(
          (chat) =>
            chat.content.prompt === 'Second tab draft' &&
            chat.content.attachmentIds.length === 1,
        ),
      )
      .toBe(true);
    await page.reload();
    await expect(page.getByLabel('Attached images')).toContainText(
      'Saved reference.png',
    );
    expect(completions).toBe(2);
    expect(titles).toBe(1);

    // A temporary save failure preserves usable draft state and offers recovery.
    await page.evaluate(() => {
      const original = IDBDatabase.prototype.transaction;
      (window as unknown as { rejectChatWrites: boolean }).rejectChatWrites =
        true;
      IDBDatabase.prototype.transaction = function (
        ...args: Parameters<typeof original>
      ) {
        if (
          this.name === 'localcut-chats-v1' &&
          args[1] === 'readwrite' &&
          (window as unknown as { rejectChatWrites: boolean }).rejectChatWrites
        )
          throw new DOMException(
            'Synthetic quota failure',
            'QuotaExceededError',
          );
        return original.apply(this, args);
      };
    });
    await composer.fill('Draft retained after failed save');
    await expect(
      page.getByText('Chat changes are not saved.', { exact: false }),
    ).toBeVisible();
    await expect(composer).toHaveValue('Draft retained after failed save');
    await page.screenshot({
      path: testInfo.outputPath('chat-storage-retry.png'),
    });
    // Dirty titles, archives and drafts stay recoverable across scope switches.
    const picker = page.getByRole('button', {
      name: 'Chat sessions',
      exact: true,
    });
    await picker.click();
    await page
      .getByRole('menuitem', { name: 'Rename chat', exact: true })
      .click();
    const rename = page.getByRole('dialog', {
      name: 'Rename chat',
      exact: true,
    });
    await rename
      .getByLabel('Chat title', { exact: true })
      .fill('Unstored title');
    await rename.getByLabel('Chat title', { exact: true }).press('Enter');
    await picker.click();
    await page
      .getByRole('menuitem', { name: 'Archive chat', exact: true })
      .click();
    const chooseModel = async (name: string) => {
      await openAISettings(page);
      await selectAISettingsTab(page, 'LLM - Chat');
      await settings
        .getByRole('combobox', { name: 'AI model', exact: true })
        .click();
      await page.getByRole('option', { name, exact: true }).click();
      await settings.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(composer).toBeEnabled();
    };
    await chooseModel('Alternative model · test/alternative');
    await expect(composer).toHaveValue('Alternative model draft');
    await composer.fill('Failed alternative draft');
    await chooseModel('Chat model · test/chat');
    await picker.click();
    await page
      .getByRole('button', { name: 'Show archived chats', exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'Restore Unstored title', exact: true })
      .click();
    await expect(picker).toContainText('Unstored title');
    await expect(composer).toHaveValue('Draft retained after failed save');
    await chooseModel('Alternative model · test/alternative');
    await expect(composer).toHaveValue('Failed alternative draft');
    await page.evaluate(() => {
      (window as unknown as { rejectChatWrites: boolean }).rejectChatWrites =
        false;
    });
    await page
      .getByRole('button', { name: 'Retry saving', exact: true })
      .click();
    await expect(
      page.getByText('Chat changes are not saved.', { exact: false }),
    ).toHaveCount(0);
    await expect
      .poll(async () =>
        (await savedChats(page)).some(
          (chat) => chat.content.prompt === 'Draft retained after failed save',
        ),
      )
      .toBe(true);
    await expect
      .poll(async () =>
        (await savedChats(page)).some(
          (chat) => chat.content.prompt === 'Failed alternative draft',
        ),
      )
      .toBe(true);
    await chooseModel('Chat model · test/chat');
    await expect(composer).toHaveValue('Draft retained after failed save');
    await page.reload();
    await expect(composer).toHaveValue('Draft retained after failed save');
    await expect(picker).toContainText('Unstored title');

    // Returning from another project restores this project's context.
    await second.goto(`${base}#/projects`);
    await second
      .getByRole('button', { name: 'New project', exact: true })
      .click();
    await second.getByLabel('Project name').fill('Separate chat project');
    await second
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    const otherComposer = second.getByRole('textbox', {
      name: 'Describe your edit',
      exact: true,
    });
    await expect(otherComposer).toHaveValue('');
    await otherComposer.fill('Another project draft');
    await expect
      .poll(async () =>
        (await savedChats(page)).some(
          (chat) => chat.content.prompt === 'Another project draft',
        ),
      )
      .toBe(true);
    await second.goto(projectUrl);
    await expect(otherComposer).toHaveValue('Draft retained after failed save');
    expect(completions).toBe(2);
    await second.close();
    const retained = (await savedChats(page)).find(
      (chat) => chat.content.prompt === 'Draft retained after failed save',
    )!;
    await page.evaluate(
      async ({ scope, id }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('localcut-chats-v1');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const tx = db.transaction('sessions', 'readwrite');
        const store = tx.objectStore('sessions');
        const chat = await new Promise<SavedChatSession>((resolve, reject) => {
          const request = store.get([scope, id]);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        store.put({
          ...chat,
          content: {
            ...chat.content,
            messages: [
              {
                id: 'interrupted-user',
                role: 'user',
                text: 'Unfinished request',
                status: 'complete',
              },
              {
                id: 'interrupted-assistant',
                role: 'assistant',
                text: 'Partial saved reply',
                status: 'streaming',
                proposalIds: ['must-not-restore'],
                tools: [
                  {
                    callId: 'unfinished-tool',
                    name: 'propose_edits',
                    phase: 'started',
                  },
                ],
              },
            ],
          },
        });
        store.put({ ...chat, id: 'unsupported-record', version: 999 });
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      },
      { scope: retained.scope, id: retained.id },
    );
    await page.reload();
    await expect(
      page.getByRole('log', { name: 'Conversation messages' }),
    ).toContainText('Partial saved reply');
    await expect(
      page.getByRole('log', { name: 'Conversation messages' }),
    ).toContainText('Stopped · No pending changes');
    await expect(
      page.getByRole('button', { name: 'Apply proposal', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Resume response', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel('Attached images')).toContainText(
      'Saved reference.png',
    );
    expect(completions).toBe(2);
    await test.step('archiving the final active chat creates an empty usable chat', async () => {
      const picker = page.getByRole('button', {
        name: 'Chat sessions',
        exact: true,
      });
      const count = (await savedChats(page)).filter(
        (chat) =>
          chat.version === 1 && chat.scope === retained.scope && !chat.archived,
      ).length;
      for (let i = 0; i < count; i++) {
        await picker.click();
        await page
          .getByRole('menuitem', { name: 'Archive chat', exact: true })
          .click();
      }
      await expect(composer).toHaveValue('');
      await expect(picker).toHaveText('New chat');
      await expect
        .poll(
          async () =>
            (await savedChats(page)).filter(
              (chat) =>
                chat.version === 1 &&
                chat.scope === retained.scope &&
                !chat.archived,
            ).length,
        )
        .toBe(1);
      await page.reload();
      await expect(composer).toHaveValue('');
      await expect(picker).toHaveText('New chat');
      expect(completions).toBe(2);
      expect(titles).toBe(1);
    });
  });
}
