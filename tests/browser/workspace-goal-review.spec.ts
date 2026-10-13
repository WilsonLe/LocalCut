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
    body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: calls ? { tool_calls: calls.map((call, index) => ({ index, id: `goal-${index}`, type: 'function', function: call })) } : { content }, finish_reason: calls ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
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
              context_length: 512000,
              top_provider: { max_completion_tokens: 512000 },
              supported_parameters: ['tools', 'tool_choice'],
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
    let executionRejections = 0;
    const sessions: { execution: string[]; review: string[] } = {
      execution: [],
      review: [],
    };
    const contract =
      '## Goal\nAdd overlay track and closing title.\n## Success conditions\n- The track contains the closing title.\n## Stop conditions\n- None';
    const updates: Record<string, unknown>[] = [];
    let todoUpdates = 0;
    const todoRepairs: {
      session_id: string;
      messages: { content: string }[];
    }[] = [];
    let repairedAfterEdit = false;
    const payloads: Record<string, unknown>[] = [];
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ headers: cors, body: '' });
          return;
        }
        const request = route.request().postDataJSON();
        expect(request).not.toHaveProperty('max_tokens');
        const instruction = request.messages[0]?.content ?? '';
        if (instruction.startsWith('LocalCut request contract:')) {
          parses++;
          updates.push(JSON.parse(request.messages[1].content));
          sessions.review.push(request.session_id);
          expect(request.tool_choice).toBe('none');
          expect(request.tools).toBeUndefined();
          if (parses === 1) {
            await reply(
              route,
              '<｜DSML｜ calls><｜DSML｜ invoke name="inspect_capabilities"></｜DSML｜ calls>',
            );
            return;
          }
          await reply(route, contract);
          return;
        }
        if (instruction.startsWith('LocalCut session to-dos:')) {
          todoUpdates++;
          if (todoUpdates <= 2) {
            todoRepairs.push(request);
            if (todoUpdates === 1) {
              await reply(route, 'I will add the requested overlay and title.');
              return;
            }
            expect(request.messages.slice(0, 2)).toEqual(
              todoRepairs[0]!.messages,
            );
            expect(request.session_id).toBe(todoRepairs[0]!.session_id);
            expect(request.messages[2].content).toContain(
              'Markdown task checklist',
            );
            expect(JSON.stringify(request)).not.toContain(
              'I will add the requested overlay and title.',
            );
          }
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
          expect(request.tool_choice).toBe('none');
          const data = JSON.parse(request.messages[1].content);
          const met =
            !exhausted &&
            data.currentContext.selectedProject.tracks.some(
              (track: { id: string; clips: { id: string }[] }) =>
                track.id === 'checked-overlay' &&
                track.clips.some((clip) => clip.id === 'checked-title'),
            );
          if (met && !repairedAfterEdit) {
            repairedAfterEdit = true;
            await reply(route, 'The overlay and title are complete.');
            return;
          }
          await reply(
            route,
            `## To-dos\n1. [${met ? 'x' : ' '}] Add overlay track and closing title`,
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
              ? 'FULFILLED\nPersisted project and edit receipt show the overlay'
              : `The overlay track is still missing.${exhausted ? '\nMissing required user information' : ''}`,
          );
          return;
        }
        if (await fulfillChatTitle(route)) return;
        sessions.execution.push(request.session_id);
        executionRounds++;
        if (exhausted || executionRounds === 1) {
          await reply(
            route,
            'I can add the overlay track and closing title. Would you like me to?',
          );
          return;
        }
        const context = JSON.parse(request.messages[1].content);
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
        name: 'Completion verified · 2',
        exact: true,
      }),
    ).toBeVisible();
    expect(checks).toBe(2);
    expect(parses).toBe(2);
    expect(editCalls).toBe(1);
    expect(titleCalls).toBe(1);
    expect(new Set(sessions.review).size).toBe(1);
    expect(sessions.review[0]).not.toBe(sessions.execution[0]);
    expect(payloads[0]!.initialRequest).toBe(
      'Add an overlay track and closing title',
    );
    expect(payloads[1]!.actions).toHaveLength(2);
    expect(payloads[1]!.actions).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'applied' })]),
    );
    await response
      .getByRole('button', { name: 'Completion verified · 2', exact: true })
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
    await expect(
      page.locator('[data-slot="popover-content"] h4').first(),
    ).toHaveText('Goal');
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('button', { name: 'Session goal', exact: true }),
    ).toBeFocused();
    await page.getByRole('button', { name: 'To-dos', exact: true }).click();
    await expect(
      page.locator('[data-slot="popover-content"] input[type="checkbox"]'),
    ).toBeChecked();
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
        name: 'Completion verified · 2',
        exact: true,
      }),
    ).toBeVisible();
    await restored
      .getByRole('button', { name: 'Completion verified · 2', exact: true })
      .click();
    await expect(restored.locator('[data-completion-review]')).toContainText(
      'Add overlay track and closing title.',
    );
    await expect(restored.locator('[data-completion-review]')).toContainText(
      'FULFILLED',
    );
    await expect(restored.locator('[data-completion-review]')).toContainText(
      'Persisted project and edit receipt show the overlay',
    );
    await page
      .getByRole('button', { name: 'Session goal', exact: true })
      .click();
    await expect(page.locator('[data-slot="popover-content"]')).toContainText(
      'Add overlay track and closing title.',
    );
    await page.keyboard.press('Escape');
    expect(checks).toBe(2);
    expect(parses).toBe(2);
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
    ).toContainText('Request unfinished after 3 completion checks');
    await expect(
      page.getByRole('button', {
        name: 'Completion unfinished · 3',
        exact: true,
      }),
    ).toBeVisible();
    expect(checks).toBe(3);
    expect(parses).toBe(3);
    expect(updates.at(-1)?.existingGoal).toBe(contract);
    expect(todoUpdates).toBeGreaterThan(executionRounds);
    expect(todoRepairs).toHaveLength(2);
    expect(repairedAfterEdit).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('navigation', { name: 'Workspace sections' })
      .getByRole('button', { name: 'Chat', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Completion unfinished · 3', exact: true })
      .click();
    await expect(
      page
        .getByRole('article', { name: 'Assistant response' })
        .last()
        .locator('[data-completion-review]'),
    ).toContainText('Missing required user information');
    await page.getByRole('button', { name: 'To-dos', exact: true }).click();
    const popup = page.locator('[data-slot="popover-content"]');
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
      .getByRole('button', { name: 'Completion verified · 3', exact: true })
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
    expect(parses).toBe(3);

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
        .getByRole('button', { name: 'Completion verified · 1', exact: true }),
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
        .getByRole('button', { name: 'Completion verified · 1', exact: true }),
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
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Retry response', exact: true }),
    ).toBeVisible();
    await expect(page.locator('form [role="alert"]')).toContainText(
      'The to-do update failed',
    );
    await expect(page.locator('body')).not.toContainText('PRIVATE_TODO_ECHO');
    rejectTodos = false;
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
        .getByRole('button', { name: 'Completion verified · 1', exact: true }),
    ).toBeVisible();
    expect(editCalls).toBe(1);
  });
}
