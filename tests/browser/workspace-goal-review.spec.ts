import { behaviorBases } from './coverage-bases';
import { test, expect } from '@playwright/test';
import {
  prepareOpenRouterKey,
  openAISettings,
  selectAISettingsTab,
} from './workspace-settings-helper';
import { fulfillChatTitle } from './chat-title-fixture';
import { dismissNotifications } from './workspace-notifications-helper';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
for (const base of behaviorBases) {
  test(`single agent edits despite failed notes and restores receipt progress ${base}`, async ({
    page,
    context,
  }, testInfo) => {
    await context.route('https://openrouter.ai/api/v1/models', (route) =>
      route.fulfill({
        headers: cors,
        json: {
          data: [
            {
              id: 'test/lifecycle',
              name: 'Lifecycle model',
              context_length: 1048576,
              supported_parameters: ['tools', 'tool_choice'],
            },
          ],
        },
      }),
    );
    let mainRounds = 0,
      edits = 0,
      reviews = 0,
      bookkeeping = 0;
    let restoredProgress: unknown;
    let compactionRequests = 0;
    let releaseCompaction!: () => void;
    const compactionGate = new Promise<void>((resolve) => {
      releaseCompaction = resolve;
    });
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ headers: cors, body: '' });
          return;
        }
        const request = route.request().postDataJSON();
        const instruction: string = request.messages[0].content;
        if (
          instruction.startsWith('Name this video-editing chat') &&
          (await fulfillChatTitle(route))
        )
          return;
        if (instruction.startsWith('LocalCut context compaction:')) {
          compactionRequests++;
          const evidence = JSON.parse(request.messages[1].content);
          expect(request.tool_choice).toBe('none');
          expect(evidence.fragment).toContain('ARCHIVE_ONLY_SOURCE_');
          // Completed receipts remain exact in the recent suffix; they need not
          // enter this older prefix merely to satisfy a message-count heuristic.
          expect(evidence.fragment).not.toContain('checked-title');
          expect(evidence.fragment).not.toContain('OLD_CHANGING_SNAPSHOT_');
          expect(evidence.fragment.length).toBeLessThan(720000);
          if (compactionRequests === 1) {
            await route.fulfill({
              headers: cors,
              status: 400,
              json: {
                error: {
                  code: 'bad_request',
                  message: 'PRIVATE_COMPACTION_ECHO',
                },
              },
            });
            return;
          }
          await compactionGate;
          await route.fulfill({
            headers: cors,
            contentType: 'text/event-stream',
            body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Earlier reference material has been summarized. Preserve current saved work; verify without replay.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
          });
          return;
        }
        if (/^LocalCut (request contract|session to-dos):/.test(instruction)) {
          bookkeeping++;
          throw new Error('Bookkeeping must never run');
        }
        let content = '',
          calls: { name: string; arguments: string }[] | undefined;
        if (instruction.startsWith('LocalCut completion review:')) {
          reviews++;
          const data = JSON.parse(request.messages[1].content);
          expect(data.currentContext.selectedProject.revision).toBe(2);
          expect(data.recordedProgress.actions).toEqual([
            expect.objectContaining({ kind: 'edit', revision: 1 }),
            expect.objectContaining({ kind: 'edit', revision: 2 }),
          ]);
          content =
            'Current saved project and receipts confirm the closing title. Notes are advisory.';
        } else {
          const scope = JSON.parse(request.messages.at(-1).content);
          if (
            request.messages.some(
              (m: { role: string; content: string }) =>
                m.role === 'user' &&
                m.content === 'Verify the saved title without changing it.',
            )
          ) {
            if (compactionRequests)
              expect(
                request.messages.some(
                  (message: { role: string; content: string }) =>
                    message.role === 'tool' &&
                    message.content.includes('checked-title'),
                ),
              ).toBe(true);
            restoredProgress = scope.recordedProgress;
            content = 'The saved closing title is retained.';
          } else if (scope.completionDecision)
            content = 'Created and verified the closing title.';
          else {
            const plans = [
              [
                {
                  name: 'load_skill',
                  arguments: JSON.stringify({ skillId: 'editing' }),
                },
                {
                  name: 'update_session_notes',
                  arguments: JSON.stringify({
                    expectedRevision: 0,
                    todos: [{ oldText: '', newText: 'Check the saved title.' }],
                  }),
                },
              ],
              [
                {
                  name: 'update_session_notes',
                  arguments: JSON.stringify({
                    expectedRevision: 1,
                    todos: [
                      {
                        oldText: 'missing exact anchor',
                        newText: 'should not publish',
                      },
                    ],
                  }),
                },
                {
                  name: 'propose_edits',
                  arguments: JSON.stringify({
                    summary: 'Add overlay',
                    operations: [
                      {
                        type: 'addTrack',
                        track: { id: 'checked-overlay', kind: 'overlay' },
                      },
                    ],
                  }),
                },
              ],
              [
                {
                  name: 'propose_edits',
                  arguments: JSON.stringify({
                    summary: 'Add closing title',
                    operations: [
                      {
                        type: 'insertClip',
                        trackId: 'checked-overlay',
                        clip: {
                          id: 'checked-title',
                          kind: 'text',
                          startUs: 3000000,
                          durationUs: 1000000,
                          text: { text: 'The end' },
                        },
                      },
                    ],
                  }),
                },
              ],
              [{ name: 'inspect_project', arguments: '{}' }],
            ];
            calls = plans[mainRounds++];
            if (calls)
              edits += calls.filter((c) => c.name === 'propose_edits').length;
            else content = 'Created and verified the closing title.';
          }
        }
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: calls ? { tool_calls: calls.map((call, index) => ({ index, id: `lifecycle-${index}`, type: 'function', function: call })) } : { content }, finish_reason: calls ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
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
    await page.getByLabel('Project name').fill('Single agent lifecycle');
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
      .fill('synthetic-lifecycle-key');
    await dialog.getByRole('button', { name: 'Use API key' }).click();
    await selectAISettingsTab(page, 'LLM - Chat');
    await dialog
      .getByRole('combobox', { name: 'AI model', exact: true })
      .click();
    await page
      .getByRole('option', {
        name: 'Lifecycle model · test/lifecycle',
        exact: true,
      })
      .click();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Describe your edit', exact: true })
      .fill('Add a closing title.');
    await page
      .getByRole('textbox', { name: 'Describe your edit', exact: true })
      .press('Enter');
    const response = page
      .getByRole('article', { name: 'Assistant response' })
      .last();
    await expect(
      response.getByRole('button', { name: 'Copy response', exact: true }),
    ).toBeVisible();
    await expect(response).toContainText(
      'Created and verified the closing title.',
    );
    expect(bookkeeping).toBe(0);
    expect(edits).toBe(2);
    expect(reviews).toBe(1);
    await response.getByRole('button', { name: /tools completed/ }).click();
    await expect(
      response.getByRole('button', {
        name: 'update session notes · Failed',
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'To-dos', exact: true }).click();
    await expect(page.locator('[data-slot="popover-content"]')).toContainText(
      'Check the saved title.',
    );
    await expect(
      page.locator('[data-slot="popover-content"]'),
    ).not.toContainText('should not publish');
    await page.keyboard.press('Escape');
    await page.screenshot({
      path: testInfo.outputPath('single-agent-notes-and-timeline.png'),
    });
    await page.reload();
    const persisted = await page.evaluate(async (path) => {
      const id = location.hash.split('/project/')[1]!.split('/')[0]!;
      const { createEditor } = (await import(
        path + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        return await editor.projects.snapshot(id);
      } finally {
        await editor.dispose();
      }
    }, base);
    expect(persisted.revision).toBe(2);
    expect(
      persisted.tracks.find((t) => t.id === 'checked-overlay')?.clips,
    ).toEqual([
      expect.objectContaining({
        id: 'checked-title',
        startUs: 3000000,
        durationUs: 1000000,
      }),
    ]);
    await page
      .getByRole('textbox', { name: 'Describe your edit', exact: true })
      .fill('Verify the saved title without changing it.');
    await page
      .getByRole('textbox', { name: 'Describe your edit', exact: true })
      .press('Enter');
    await expect(
      page
        .getByRole('article', { name: 'Assistant response' })
        .last()
        .getByRole('button', { name: 'Copy response', exact: true }),
    ).toBeVisible();
    expect(restoredProgress).toMatchObject({
      source: 'completed_tool_receipts',
      actions: [
        expect.objectContaining({ kind: 'edit', revision: 1 }),
        expect.objectContaining({ kind: 'edit', revision: 2 }),
      ],
    });
    expect(edits).toBe(2);
    expect(bookkeeping).toBe(0);
    // Preserve real completed receipts while seeding a legacy long archive.
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('localcut-chats-v1');
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('sessions', 'readwrite'),
          store = tx.objectStore('sessions'),
          rows = store.getAll();
        rows.onsuccess = () => {
          for (const row of rows.result) {
            const message = row.content.messages.find(
              (entry: { exchange?: unknown[] }) => entry.exchange?.length,
            );
            message.exchange.unshift(
              {
                role: 'user',
                content: 'ARCHIVE_ONLY_SOURCE_' + 'x'.repeat(700000),
              },
              ...Array.from({ length: 40 }, (_, revision) => ({
                role: 'system',
                content: JSON.stringify({
                  selectedProject: {
                    id: 'old',
                    revision,
                    tracks: 'OLD_CHANGING_SNAPSHOT_'.repeat(1000),
                  },
                  availableAssetIds: [],
                  capabilityMap: {},
                }),
              })),
            );
            store.put(row);
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    await page.reload();
    const verify = async () => {
      await page
        .getByRole('textbox', { name: 'Describe your edit', exact: true })
        .fill('Verify the saved title without changing it.');
      await page
        .getByRole('textbox', { name: 'Describe your edit', exact: true })
        .press('Enter');
    };
    await verify();
    await expect(page.locator('form [role="alert"]')).toContainText(
      'Chat context compaction failed',
    );
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Retry response', exact: true }),
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText(
      'PRIVATE_COMPACTION_ECHO',
    );
    await dismissNotifications(page);
    await page
      .getByRole('button', { name: 'Retry response', exact: true })
      .click();
    const compacting = page
      .getByRole('status')
      .filter({ hasText: 'Compacting chat context…' });
    await expect(compacting).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Cancel response', exact: true }),
    ).toBeEnabled();
    await page.screenshot({
      path: testInfo.outputPath('compacting-context.png'),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('navigation', { name: 'Workspace sections' })
      .getByRole('button', { name: 'Chat', exact: true })
      .click();
    const beforeResume = compactionRequests;
    await page
      .getByRole('button', { name: 'Resume response', exact: true })
      .click();
    await expect(compacting).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('compacting-context-mobile.png'),
    });
    releaseCompaction();
    await expect(
      response.getByRole('button', { name: 'Copy response', exact: true }),
    ).toBeVisible();
    expect(compactionRequests).toBe(beforeResume + 1);
    const completedCompactions = compactionRequests;
    await page.reload();
    await page
      .getByRole('navigation', { name: 'Workspace sections' })
      .getByRole('button', { name: 'Chat', exact: true })
      .click();
    expect(compactionRequests).toBe(completedCompactions);
    await verify();
    await expect(
      response.getByRole('button', { name: 'Copy response', exact: true }),
    ).toBeVisible();
    const stored = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const open = indexedDB.open('localcut-chats-v1');
        open.onsuccess = () => resolve(open.result);
      });
      const rows = await new Promise<
        {
          content: {
            compaction: { summary: string };
            messages: { exchange?: { content?: string }[] }[];
          };
        }[]
      >((resolve) => {
        const request = db
          .transaction('sessions')
          .objectStore('sessions')
          .getAll();
        request.onsuccess = () => resolve(request.result);
      });
      db.close();
      return {
        checkpoint: rows[0]!.content.compaction,
        hasOriginal: rows[0]!.content.messages.some((message) =>
          message.exchange?.some(
            (entry) =>
              entry.content?.startsWith('ARCHIVE_ONLY_SOURCE_') &&
              entry.content.length > 700000,
          ),
        ),
        hasSnapshot: rows[0]!.content.messages.some((message) =>
          message.exchange?.some((entry) =>
            entry.content?.includes('OLD_CHANGING_SNAPSHOT_'),
          ),
        ),
      };
    });
    expect(stored.checkpoint.summary).toContain('Earlier reference material');
    expect(stored.hasOriginal).toBe(true);
    expect(stored.hasSnapshot).toBe(true);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await response
      .getByRole('button', { name: 'Branch response', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Chat sessions', exact: true }),
    ).toContainText('Branch of');
    await verify();
    await expect(
      response.getByRole('button', { name: 'Copy response', exact: true }),
    ).toBeVisible();
    await page.reload();
    await verify();
    await expect(
      response.getByRole('button', { name: 'Copy response', exact: true }),
    ).toBeVisible();
    expect(compactionRequests).toBe(completedCompactions);
    expect(edits).toBe(2);
    expect(bookkeeping).toBe(0);
  });
}
