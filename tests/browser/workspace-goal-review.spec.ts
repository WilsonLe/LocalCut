import { scriptedDocumentReply } from '../goal-review-fixture';
import { behaviorBases } from './coverage-bases';
import { test, expect } from '@playwright/test';
import type { Route } from '@playwright/test';
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
const reply = (
  route: Route,
  content?: string,
  calls?: { name: string; arguments: string }[],
) =>
  route.fulfill({
    headers: cors,
    contentType: 'text/event-stream',
    body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: calls ? { tool_calls: calls.map((call, index) => ({ index, id: `goal-${index}`, type: 'function', function: call })) } : { content: content === undefined ? undefined : scriptedDocumentReply(route.request().postDataJSON(), content) }, finish_reason: calls ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
  });

for (const base of behaviorBases) {
  test(`completion review corrects initial request and persists subtle trace ${base}`, async ({
    page,
    context,
  }, testInfo) => {
    await context.route('https://openrouter.ai/api/v1/models', (route) =>
      route.fulfill({
        headers: cors,
        json: {
          data: [
            {
              id: 'test/review',
              name: 'Review test model',
              context_length: 1048576,
              top_provider: { max_completion_tokens: 512000 },
              supported_parameters: ['tools', 'tool_choice', 'max_tokens'],
            },
          ],
        },
      }),
    );
    let checks = 0,
      executionRounds = 0,
      parses = 0;
    let editCalls = 0;
    let titleCalls = 0;
    let exhausted = false;
    let rejectReview = false;
    let rejectExecution = false;
    let rejectTodos = false;
    let compactionRequests = 0;
    let compactingRetry = false;
    let budgetCorrections = 0;
    let releaseCompaction!: () => void;
    const compactionGate = new Promise<void>((resolve) => {
      releaseCompaction = resolve;
    });
    let executionRejections = 0;
    const sessions: { execution: string[]; review: string[] } = {
      execution: [],
      review: [],
    };
    const contract =
      'Add overlay track and closing title.\nSuccess means the title is present. Keep <direction> literal.';
    const updates: Record<string, unknown>[] = [];
    let todoUpdates = 0;
    const payloads: Record<string, unknown>[] = [];
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ headers: cors, body: '' });
          return;
        }
        const request = route.request().postDataJSON();
        const instruction = request.messages[0]?.content ?? '';
        if (instruction.startsWith('LocalCut context compaction:')) {
          compactionRequests++;
          expect(request.tool_choice).toBe('none');
          const evidence = JSON.parse(request.messages[1].content);
          expect(evidence).not.toHaveProperty('parts');
          expect(Array.isArray(JSON.parse(evidence.fragment))).toBe(true);
          if (compactingRetry) await compactionGate;
          await reply(
            route,
            'The original request is an overlay track and closing title. These are already applied and confirmed. Keep the completed title and video; verify without replay. Latest request checks the saved overlay.',
          );
          return;
        }
        if (compactingRetry && request.max_tokens === undefined) {
          budgetCorrections++;
          await route.fulfill({
            headers: cors,
            status: 400,
            json: {
              error: {
                code: 400,
                metadata: {
                  provider_error_code: 'context_length_exceeded',
                  raw: JSON.stringify({
                    error: {
                      code: 'context_length_exceeded',
                      message:
                        "This model's maximum context length is 512000 tokens, but the request requires 631072 tokens (500000 input including image/vision expansion + 131072 for the completion). Reduce the input length or max_tokens.",
                    },
                  }),
                },
              },
            },
          });
          return;
        }
        if (compactingRetry) expect(request.max_tokens).toBe(12000);
        else expect(request).not.toHaveProperty('max_tokens');
        if (instruction.startsWith('LocalCut request contract:')) {
          parses++;
          updates.push(JSON.parse(request.messages[1].content));
          sessions.review.push(request.session_id);
          expect(request.tool_choice).toBe('none');
          expect(request.tools).toBeUndefined();
          await reply(route, contract);
          return;
        }
        if (instruction.startsWith('LocalCut session to-dos:')) {
          todoUpdates++;
          if (rejectTodos) {
            await route.fulfill({
              headers: cors,
              status: 400,
              json: {
                error: {
                  type: 'context_length_exceeded',
                  param: 'max_tokens',
                  message: 'PRIVATE_TODO_ECHO',
                },
              },
            });
            return;
          }
          if (exhausted) {
            await reply(
              route,
              '## To-dos\n- [ ] Task notes: add the overlay track and closing title.',
            );
            return;
          }
          expect(request.tool_choice).toBe('none');
          const data = JSON.parse(request.messages[1].content);
          expect(data).not.toHaveProperty('capabilityMap');
          expect(data.currentContext.selectedProject).not.toHaveProperty(
            'tracks',
          );
          const met =
            !exhausted &&
            (data.existingTodos?.startsWith(
              'The overlay and title are complete.',
            ) ||
              JSON.stringify(data.conversation).includes('checked-title'));
          await reply(
            route,
            met
              ? 'The overlay and title are complete. No checklist syntax.'
              : 'Task notes: add the overlay track and closing title.',
          );
          return;
        }
        if (instruction.startsWith('LocalCut completion review:')) {
          checks++;
          sessions.review.push(request.session_id);
          expect(request.tool_choice).toBe('none');
          expect(request.tools).toBeUndefined();
          if (rejectReview) {
            await route.fulfill({
              headers: cors,
              status: 400,
              json: {
                error: {
                  message: 'PRIVATE_PROVIDER_ECHO',
                  metadata: { error_type: 'invalid_prompt' },
                  param: 'messages',
                },
              },
            });
            return;
          }
          const data = JSON.parse(request.messages[1].content);
          payloads.push(data);
          const met =
            !exhausted &&
            data.currentContext.selectedProject.tracks.some(
              (track: { id: string; clips: { id: string }[] }) =>
                track.id === 'checked-overlay' &&
                track.clips.some((clip) => clip.id === 'checked-title'),
            );
          await reply(
            route,
            met
              ? 'The persisted project and edit receipt support the requested outcome.'
              : `The overlay track is still missing.${exhausted ? '\nMissing required user information' : ''}`,
          );
          return;
        }
        if (
          instruction.startsWith('Name this video-editing chat') &&
          (await fulfillChatTitle(route))
        )
          return;
        const context = JSON.parse(request.messages.at(-1).content);
        if (exhausted && context.completionDecision) {
          await reply(route, undefined, [
            { name: 'inspect_project', arguments: '{}' },
          ]);
          return;
        }
        sessions.execution.push(request.session_id);
        executionRounds++;
        if (exhausted || executionRounds === 1) {
          await reply(
            route,
            'I can add the overlay track and closing title. Would you like me to?',
          );
          return;
        }
        expect(
          request.messages.some(
            (message: { role: string; content: string }) =>
              message.role === 'system' &&
              message.content.startsWith(
                'Continue the original request in this same turn.',
              ),
          ),
        ).toBe(context.completionReview !== undefined);
        if (
          !request.tools?.some(
            (tool: { function: { name: string } }) =>
              tool.function.name === 'propose_edits',
          )
        ) {
          await reply(route, undefined, [
            { name: 'load_skill', arguments: '{"skillId":"editing"}' },
          ]);
          return;
        }
        if (rejectExecution) {
          executionRejections++;
          await route.fulfill({
            headers: cors,
            status: 400,
            json: {
              error: {
                message: 'PRIVATE_EXECUTION_ECHO',
                type: 'context_length_exceeded',
                param: 'max_tokens',
              },
            },
          });
          return;
        }
        if (
          !context.selectedProject.tracks.some(
            (track: { id: string }) => track.id === 'checked-overlay',
          )
        ) {
          editCalls++;
          await reply(route, undefined, [
            {
              name: 'propose_edits',
              arguments: JSON.stringify({
                summary: 'Add requested overlay',
                operations: [
                  {
                    type: 'addTrack',
                    track: { id: 'checked-overlay', kind: 'overlay' },
                  },
                ],
              }),
            },
          ]);
          return;
        }
        const overlay = context.selectedProject.tracks.find(
          (track: { id: string }) => track.id === 'checked-overlay',
        );
        if (
          !overlay.clips.some(
            (clip: { id: string }) => clip.id === 'checked-title',
          )
        ) {
          titleCalls++;
          await reply(route, undefined, [
            {
              name: 'propose_edits',
              arguments: JSON.stringify({
                summary: 'Add requested closing title',
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
          ]);
          return;
        }
        await reply(
          route,
          'The overlay track and closing title are now added.',
        );
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
    await page.getByLabel('Project name').fill('Completion review');
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
      .fill('synthetic-goal-review-key');
    await dialog.getByRole('button', { name: 'Use API key' }).click();
    await selectAISettingsTab(page, 'LLM - Chat');
    await dialog
      .getByRole('combobox', { name: 'AI model', exact: true })
      .click();
    await page
      .getByRole('option', {
        name: 'Review test model · test/review',
        exact: true,
      })
      .click();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page
      .getByLabel('Describe your edit', { exact: true })
      .fill('Add an overlay track and closing title');
    await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .click();
    const response = page
      .getByRole('article', { name: 'Assistant response' })
      .last();
    await expect(response).toContainText(
      'The overlay track and closing title are now added.',
    );
    await expect(
      response.getByRole('button', {
        name: 'Completion reviewed · 2',
        exact: true,
      }),
    ).toBeVisible();
    expect(checks).toBe(2);
    expect(parses).toBe(1);
    await expect(
      page
        .getByRole('article', { name: 'Assistant response' })
        .last()
        .getByRole('button', { name: 'Copy response', exact: true }),
    ).toBeVisible();
    expect(editCalls).toBe(1);
    expect(titleCalls).toBe(1);
    expect(new Set(sessions.review).size).toBe(2);
    expect(sessions.review[0]).not.toBe(sessions.execution[0]);
    expect(payloads[0]!.initialRequest).toBe(
      'Add an overlay track and closing title',
    );
    expect(payloads[1]!.actions).toHaveLength(2);
    expect(payloads[1]!.actions).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'applied' })]),
    );
    await response
      .getByRole('button', { name: 'Completion reviewed · 2', exact: true })
      .click();
    await expect(
      response.getByText('Session goal · completed', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(response.locator('[data-completion-review]')).toContainText(
      'The overlay track is still missing',
    );
    await page
      .getByRole('button', { name: 'Session goal', exact: true })
      .click();
    await expect(page.locator('[data-slot="popover-content"]')).toContainText(
      contract,
    );
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('button', { name: 'Session goal', exact: true }),
    ).toBeFocused();
    await page.getByRole('button', { name: 'To-dos', exact: true }).click();
    await expect(page.locator('[data-slot="popover-content"]')).toContainText(
      'The overlay and title are complete. No checklist syntax.',
    );
    await page.keyboard.press('Escape');
    await page.screenshot({
      path: testInfo.outputPath('completion-review.png'),
    });
    await page.reload();
    const persisted = await page.evaluate(async (base) => {
      const id = location.hash.split('/project/')[1]!.split('/')[0]!;
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        return await editor.projects.snapshot(id);
      } finally {
        await editor.dispose();
      }
    }, base);
    expect(
      persisted.tracks.find((track) => track.id === 'checked-overlay')?.clips,
    ).toEqual([
      expect.objectContaining({
        id: 'checked-title',
        kind: 'text',
        startUs: 3000000,
        durationUs: 1000000,
        text: expect.objectContaining({ text: 'The end' }),
      }),
    ]);
    const restored = page
      .getByRole('article', { name: 'Assistant response' })
      .last();
    await expect(
      restored.getByRole('button', {
        name: 'Completion reviewed · 2',
        exact: true,
      }),
    ).toBeVisible();
    await restored
      .getByRole('button', { name: 'Completion reviewed · 2', exact: true })
      .click();
    await expect(restored.locator('[data-completion-review]')).toContainText(
      'Add overlay track and closing title.',
    );
    await expect(restored.locator('[data-completion-review]')).toContainText(
      'The persisted project and edit receipt support the requested outcome.',
    );
    await page
      .getByRole('button', { name: 'Session goal', exact: true })
      .click();
    await expect(page.locator('[data-slot="popover-content"]')).toContainText(
      'Add overlay track and closing title.',
    );
    await page.keyboard.press('Escape');
    expect(checks).toBe(2);
    expect(parses).toBe(1);
    exhausted = true;
    checks = 0;
    await page
      .getByLabel('Describe your edit', { exact: true })
      .fill('Add another overlay, waiting for details');
    await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .click();
    await expect(
      page.getByRole('article', { name: 'Assistant response' }).last(),
    ).toContainText('Request stopped after 3 completion checks');
    await expect(
      page.getByRole('button', {
        name: 'Completion reviewed · 3',
        exact: true,
      }),
    ).toBeVisible();
    expect(checks).toBe(3);
    expect(parses).toBe(2);
    expect(updates.at(-1)?.existingGoal).toBe(contract);
    expect(todoUpdates).toBeLessThan(executionRounds);
    expect(todoUpdates).toBeGreaterThan(executionRounds / 2);
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('navigation', { name: 'Workspace sections' })
      .getByRole('button', { name: 'Chat', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Completion reviewed · 3', exact: true })
      .click();
    await expect(
      page
        .getByRole('article', { name: 'Assistant response' })
        .last()
        .locator('[data-completion-review]'),
    ).toContainText('Missing required user information');
    await page.getByRole('button', { name: 'To-dos', exact: true }).click();
    const popup = page.locator('[data-slot="popover-content"]');
    await expect(popup).toContainText(
      'Task notes: add the overlay track and closing title.',
    );
    await expect(popup.locator('input[type="checkbox"]')).not.toBeChecked();
    const box = await popup.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath('mobile-todos.png') });
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('button', { name: 'To-dos', exact: true }),
    ).toBeFocused();
    await page.setViewportSize({ width: 1920, height: 1080 });
    // Exercise an actual pre-string sidecar without rewriting it on restore.
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('localcut-chats-v1');
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction('sessions', 'readwrite');
          const store = transaction.objectStore('sessions');
          const rows = store.getAll();
          rows.onsuccess = () => {
            for (const row of rows.result) {
              for (const message of row.content.messages) {
                for (const tool of message.tools ?? []) {
                  if (tool.name === 'request_contract')
                    tool.result = {
                      goal: 'Legacy overlay goal',
                      successConditions: ['Legacy overlay outcome'],
                      stopConditions: [],
                    };
                  else if (tool.name === 'completion_check') {
                    if (tool.input) delete tool.input.todosCleared;
                    tool.result = {
                      conditions: [
                        {
                          conditionIndex: 0,
                          status: 'met',
                          evidence: 'Legacy persisted receipt',
                        },
                      ],
                      stopReason: null,
                    };
                  }
                }
              }
              store.put(row);
            }
          };
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      } finally {
        db.close();
      }
    });
    await page.reload();
    const legacy = page
      .getByRole('article', { name: 'Assistant response' })
      .last();
    await legacy
      .getByRole('button', { name: 'Completion reviewed · 3', exact: true })
      .click();
    await expect(legacy.locator('[data-completion-review]')).toContainText(
      'Legacy overlay goal',
    );
    await expect(legacy.locator('[data-completion-review]')).toContainText(
      'Legacy overlay outcome',
    );
    await expect(legacy.locator('[data-completion-review]')).toContainText(
      'Legacy persisted receipt',
    );
    expect(checks).toBe(3);
    expect(parses).toBe(2);

    // A provider completion rejection preserves the generated answer and edit;
    // reload and primary Retry resume the same request without applying again.
    rejectReview = true;
    await page
      .getByLabel('Describe your edit', { exact: true })
      .fill('Check the earlier overlay again');
    await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .click();
    const failed = page
      .getByRole('article', { name: 'Assistant response' })
      .last();
    await expect(page.locator('form [role="alert"]')).toContainText(
      'The completion check failed after the assistant response',
    );
    await expect(page.locator('form [role="alert"]')).toContainText(
      'provider rejected the message format',
    );
    await failed
      .getByRole('button', { name: 'Completion check failed', exact: true })
      .click();
    await expect(failed).toContainText(
      'The completion check failed after the assistant response',
    );
    await expect(failed).toContainText('provider rejected the message format');
    await expect(page.locator('body')).not.toContainText(
      'PRIVATE_PROVIDER_ECHO',
    );
    await page.screenshot({
      path: testInfo.outputPath('completion-rejection.png'),
    });
    await page.reload();
    await page
      .getByRole('article', { name: 'Assistant response' })
      .last()
      .getByRole('button', { name: 'Completion check failed', exact: true })
      .click();
    await expect(
      page.getByRole('article', { name: 'Assistant response' }).last(),
    ).toContainText('The completion check failed after the assistant response');
    rejectReview = false;
    exhausted = false;
    await dismissNotifications(page);
    await page
      .getByRole('button', { name: 'Retry response', exact: true })
      .click();
    await expect(
      page.getByRole('article', { name: 'Assistant response' }).last(),
    ).toContainText('The overlay track and closing title are now added.');
    await expect(
      page
        .getByRole('article', { name: 'Assistant response' })
        .last()
        .getByRole('button', { name: 'Completion reviewed · 1', exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('article', { name: 'Assistant response' })
        .last()
        .getByRole('button', { name: 'Copy response', exact: true }),
    ).toBeVisible();
    expect(editCalls).toBe(1);
    expect(titleCalls).toBe(1);

    // Match the exported failure boundary: goal check and skill loading succeed,
    // then the expanded main round fails. Keep permanent errors explicit.
    rejectExecution = true;
    await page
      .getByLabel('Describe your edit', { exact: true })
      .fill('Recheck the saved title');
    await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .click();
    await expect(page.locator('form [role="alert"]')).toContainText(
      'The assistant response failed',
    );
    await expect(page.locator('form [role="alert"]')).toContainText(
      'conversation size',
    );
    expect(executionRejections).toBe(1);
    const beforeReload = executionRounds;
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Retry response', exact: true }),
    ).toBeVisible();
    await expect(page.locator('form [role="alert"]')).toContainText(
      'conversation size',
    );
    expect(executionRounds).toBe(beforeReload);
    await expect(page.locator('body')).not.toContainText(
      'PRIVATE_EXECUTION_ECHO',
    );
    rejectExecution = false;
    await dismissNotifications(page);
    await page
      .getByRole('button', { name: 'Retry response', exact: true })
      .click();
    await expect(
      page.getByRole('article', { name: 'Assistant response' }).last(),
    ).toContainText('The overlay track and closing title are now added.');
    await expect(
      page
        .getByRole('article', { name: 'Assistant response' })
        .last()
        .getByRole('button', { name: 'Completion reviewed · 1', exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('article', { name: 'Assistant response' })
        .last()
        .getByRole('button', { name: 'Copy response', exact: true }),
    ).toBeVisible();
    expect(editCalls).toBe(1);
    expect(executionRejections).toBe(1);

    // New persistent checklists are separate inference; their error stage must
    // survive the queue and reload, without replaying a completed edit.
    rejectTodos = true;
    await page
      .getByLabel('Describe your edit', { exact: true })
      .fill('Verify the saved overlay');
    await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .click();
    await expect(page.locator('form [role="alert"]')).toContainText(
      'The to-do update failed',
    );
    await expect(page.locator('form [role="alert"]')).toContainText(
      'conversation size',
    );
    // A synthetic old snapshot pushes the working history across 192k while
    // keeping the original completed receipts in native IndexedDB.
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
            message.exchange.unshift({
              role: 'user',
              content: 'ARCHIVE_ONLY_SNAPSHOT_' + 'x'.repeat(700000),
            });
            store.put(row);
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Retry response', exact: true }),
    ).toBeVisible();
    await expect(page.locator('form [role="alert"]')).toContainText(
      'The to-do update failed',
    );
    await expect(page.locator('body')).not.toContainText('PRIVATE_TODO_ECHO');
    rejectTodos = false;
    compactingRetry = true;
    await dismissNotifications(page);
    await page
      .getByRole('button', { name: 'Retry response', exact: true })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Compacting chat context…' }),
    ).toBeVisible();
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
    // Hiding Chat at the responsive transition preserves the existing pause
    // contract. Explicit Resume restarts the unfinished compaction safely.
    const beforeResumeCompactions = compactionRequests;
    await page
      .getByRole('button', { name: 'Resume response', exact: true })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Compacting chat context…' }),
    ).toHaveText('Compacting chat context…');
    await page.screenshot({
      path: testInfo.outputPath('compacting-context-mobile.png'),
    });
    releaseCompaction();
    await expect(
      page.getByRole('article', { name: 'Assistant response' }).last(),
    ).toContainText('The overlay track and closing title are now added.');
    await expect(
      page
        .getByRole('article', { name: 'Assistant response' })
        .last()
        .getByRole('button', { name: 'Completion reviewed · 1', exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('article', { name: 'Assistant response' })
        .last()
        .getByRole('button', { name: 'Copy response', exact: true }),
    ).toBeVisible();
    expect(editCalls).toBe(1);
    expect(compactionRequests).toBe(beforeResumeCompactions + 1);
    expect(budgetCorrections).toBeGreaterThan(2);
    const completedCompactions = compactionRequests;
    await page.reload();
    await page
      .getByRole('navigation', { name: 'Workspace sections' })
      .getByRole('button', { name: 'Chat', exact: true })
      .click();
    expect(compactionRequests).toBe(completedCompactions);
    await page
      .getByLabel('Describe your edit', { exact: true })
      .fill('Verify the saved title again');
    await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .click();
    await expect(
      page
        .getByRole('article', { name: 'Assistant response' })
        .last()
        .getByRole('button', { name: 'Copy response', exact: true }),
    ).toBeVisible();
    expect(compactionRequests).toBe(completedCompactions);
    expect(editCalls).toBe(1);
    const compactionPersistence = await page.evaluate(async () => {
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
        hasOriginal: rows[0]!.content.messages.some(
          (message: { exchange?: { content?: string }[] }) =>
            message.exchange?.some(
              (entry) =>
                entry.content?.startsWith('ARCHIVE_ONLY_SNAPSHOT_') &&
                entry.content.length > 700000,
            ),
        ),
      };
    });
    expect(compactionPersistence.checkpoint.summary).toContain(
      'completed title',
    );
    expect(compactionPersistence.hasOriginal).toBe(true);
    // Compatible response branches must save the reused checkpoint, even when
    // the live assistant does not need another compaction operation.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page
      .getByRole('article', { name: 'Assistant response' })
      .last()
      .getByRole('button', { name: 'Branch response', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Chat sessions', exact: true }),
    ).toContainText('Branch of');
    await page
      .getByRole('textbox', { name: 'Describe your edit', exact: true })
      .fill('Verify the title in this branch');
    await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .click();
    await expect(
      page
        .getByRole('article', { name: 'Assistant response' })
        .last()
        .getByRole('button', { name: 'Copy response', exact: true }),
    ).toBeVisible();
    expect(compactionRequests).toBe(completedCompactions);
    await page.reload();
    await page
      .getByRole('textbox', { name: 'Describe your edit', exact: true })
      .fill('Verify the branch again after reload');
    await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .click();
    await expect(
      page
        .getByRole('article', { name: 'Assistant response' })
        .last()
        .getByRole('button', { name: 'Copy response', exact: true }),
    ).toBeVisible();
    expect(compactionRequests).toBe(completedCompactions);
    expect(editCalls).toBe(1);
  });
}
