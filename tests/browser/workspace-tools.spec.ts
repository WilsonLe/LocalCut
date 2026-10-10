import { expect, test } from '@playwright/test';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};

for (const base of ['/', '/LocalCut/']) {
  test(`chat independently discloses tool inputs, results and failed validation ${base}`, async ({
    page,
    context,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await context.route('https://openrouter.ai/api/v1/models', (route) =>
      route.fulfill({
        headers: cors,
        json: {
          data: [
            {
              id: 'test/tool-details',
              name: 'Tool details model',
              context_length: 32000,
              supported_parameters: ['tools', 'tool_choice'],
            },
          ],
        },
      }),
    );
    let rounds = 0;
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ headers: cors, body: '' });
          return;
        }
        const requestTools = (
          route.request().postDataJSON() as {
            tools: { function: { name: string } }[];
          }
        ).tools;
        if (
          !requestTools.some((tool) => tool.function.name === 'propose_edits')
        ) {
          await route.fulfill({
            headers: cors,
            contentType: 'text/event-stream',
            body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'load-editing', type: 'function', function: { name: 'load_skill', arguments: '{"skillId":"editing"}' } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`,
          });
          return;
        }
        rounds++;
        const tool = (
          index: number,
          id: string,
          name: string,
          args: unknown,
        ) => ({
          index,
          id,
          type: 'function',
          function: { name, arguments: JSON.stringify(args) },
        });
        const delta =
          rounds === 1
            ? {
                tool_calls: [
                  tool(0, 'first-inspection', 'inspect_project', {}),
                  tool(1, 'second-inspection', 'inspect_project', {}),
                  tool(2, 'failed-validation', 'validate_edits', {
                    operations: [
                      { type: 'removeClip', clipId: 'missing-clip' },
                    ],
                  }),
                ],
              }
            : {
                content:
                  'Checked the project. The requested clip does not exist.',
              };
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: rounds === 1 ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
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
      .fill('Private tool-detail project');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Connect AI', exact: true })
      .first()
      .click();
    const connection = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await connection
      .getByLabel('OpenRouter API key', { exact: true })
      .fill('synthetic-tool-detail-key');
    await connection
      .getByRole('button', { name: 'Use API key', exact: true })
      .click();
    const model = connection.getByRole('combobox', {
      name: 'AI model',
      exact: true,
    });
    await expect(model).toBeEnabled();
    await model.click();
    await page
      .getByRole('option', {
        name: 'Tool details model · test/tool-details',
        exact: true,
      })
      .click();
    await connection.getByRole('button', { name: 'Done', exact: true }).click();
    await page
      .getByLabel('Describe your edit', { exact: true })
      .fill('Inspect twice and check removing the missing clip.');
    await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .click();
    const response = page.getByRole('article', {
      name: 'Assistant response',
      exact: true,
    });
    await expect(
      response.getByText(
        'Checked the project. The requested clip does not exist.',
        { exact: true },
      ),
    ).toBeVisible();
    await response
      .getByRole('button', { name: '3 of 4 tools completed', exact: true })
      .click();
    const inspections = response.locator('[data-tool-name="inspect_project"]');
    await expect(inspections).toHaveCount(2);
    const first = inspections.nth(0),
      second = inspections.nth(1);
    expect(await first.getAttribute('data-tool-call')).not.toEqual(
      await second.getAttribute('data-tool-call'),
    );
    await first
      .getByRole('button', { name: 'inspect project · Completed', exact: true })
      .click();
    await expect(first.getByText('Input', { exact: true })).toBeVisible();
    await expect(first.getByText('Result', { exact: true })).toBeVisible();
    await expect(first.locator('pre').nth(0)).toHaveText('{}');
    await expect(first.locator('pre').nth(1)).toContainText('"revision": 0');
    await expect(first.locator('pre').nth(1)).toContainText('"width": 1920');
    await expect(first.locator('pre').nth(1)).not.toContainText(
      'Private tool-detail project',
    );
    await expect(second.getByText('Result', { exact: true })).toBeHidden();
    await second
      .getByRole('button', { name: 'inspect project · Completed', exact: true })
      .click();
    await expect(second.getByText('Result', { exact: true })).toBeVisible();
    const validation = response.locator('[data-tool-name="validate_edits"]');
    await validation
      .getByRole('button', { name: 'validate edits · Failed', exact: true })
      .click();
    await expect(validation.locator('pre').nth(0)).toContainText(
      '"clipId": "missing-clip"',
    );
    await expect(validation.getByText('Error', { exact: true })).toBeVisible();
    await expect(validation.locator('pre').nth(1)).toContainText(
      '"code": "EDIT_REJECTED"',
    );
    await expect(validation.locator('pre').nth(1)).toContainText(
      '"editorCode": "NOT_FOUND"',
    );
    await expect(
      page.getByRole('button', { name: 'Apply proposal', exact: true }),
    ).toHaveCount(0);
    await expect(response).not.toContainText('synthetic-tool-detail-key');
    expect(rounds).toBe(2);
    expect(errors).toEqual([]);
    await testInfo.attach('expanded tool results and validation error', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  test(`chat cannot cancel a pending atomic edit commit ${base}`, async ({
    page,
    context,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await context.route('https://openrouter.ai/api/v1/models', (route) =>
      route.fulfill({
        headers: cors,
        json: {
          data: [
            {
              id: 'test/atomic-edit',
              name: 'Atomic edit model',
              context_length: 32000,
              supported_parameters: ['tools', 'tool_choice'],
            },
          ],
        },
      }),
    );
    let rounds = 0;
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ headers: cors, body: '' });
          return;
        }
        const requestTools = (
          route.request().postDataJSON() as {
            tools: { function: { name: string } }[];
          }
        ).tools;
        if (
          !requestTools.some((tool) => tool.function.name === 'propose_edits')
        ) {
          await route.fulfill({
            headers: cors,
            contentType: 'text/event-stream',
            body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'load-editing', type: 'function', function: { name: 'load_skill', arguments: '{"skillId":"editing"}' } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`,
          });
          return;
        }
        rounds++;
        const delta =
          rounds === 1
            ? {
                tool_calls: [
                  {
                    index: 0,
                    id: 'add-overlay',
                    type: 'function',
                    function: {
                      name: 'propose_edits',
                      arguments: JSON.stringify({
                        summary: 'Add overlay track',
                        operations: [
                          {
                            type: 'addTrack',
                            track: { id: 'approved-overlay', kind: 'overlay' },
                          },
                        ],
                      }),
                    },
                  },
                ],
              }
            : { content: 'The overlay track is ready for approval.' };
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: rounds === 1 ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
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
      .fill('Atomic commit consumer');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Connect AI', exact: true })
      .first()
      .click();
    const connection = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await connection
      .getByLabel('OpenRouter API key', { exact: true })
      .fill('synthetic-atomic-key');
    await connection
      .getByRole('button', { name: 'Use API key', exact: true })
      .click();
    const model = connection.getByRole('combobox', {
      name: 'AI model',
      exact: true,
    });
    await expect(model).toBeEnabled();
    await model.click();
    await page
      .getByRole('option', {
        name: 'Atomic edit model · test/atomic-edit',
        exact: true,
      })
      .click();
    await connection.getByRole('button', { name: 'Done', exact: true }).click();
    await page
      .getByLabel('Describe your edit', { exact: true })
      .fill('Add an overlay track.');
    await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .click();
    const apply = page.getByRole('button', {
      name: 'Apply proposal',
      exact: true,
    });
    await expect(apply).toBeEnabled();

    // Keep an actual IDB transaction alive to queue the production command,
    // without replacing the editor, command implementation or saved result.
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('localcut-v1');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      let holding = true;
      const tx = db.transaction('projects', 'readwrite');
      const complete = new Promise<void>((resolve) => {
        tx.oncomplete = tx.onabort = () => {
          db.close();
          resolve();
        };
      });
      const target = window as Window & {
        releaseAtomicCommit?: () => Promise<void>;
      };
      target.releaseAtomicCommit = async () => {
        holding = false;
        await complete;
        delete target.releaseAtomicCommit;
      };
      await new Promise<void>((resolve, reject) => {
        const keepAlive = () => {
          const request = tx.objectStore('projects').count();
          request.onsuccess = () => {
            if (holding) keepAlive();
            resolve();
          };
          request.onerror = () => reject(request.error);
        };
        keepAlive();
      });
    });
    try {
      await apply.click();
      await expect(
        page.getByText('Committing edit…', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Cancel action', exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText('Applied at revision 1', { exact: true }),
      ).toHaveCount(0);
    } finally {
      await page.evaluate(async () => {
        const target = window as Window & {
          releaseAtomicCommit?: () => Promise<void>;
        };
        await target.releaseAtomicCommit?.();
      });
    }
    await expect(
      page.getByText('Applied at revision 1', { exact: true }),
    ).toBeVisible();
    const saved = await page.evaluate(async (path) => {
      const { createEditor } = (await import(
        path + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const project = (await editor.projects.list()).find(
          (project) => project.name === 'Atomic commit consumer',
        )!;
        return {
          revision: project.revision,
          tracks: project.tracks.map((track) => track.id),
        };
      } finally {
        await editor.dispose();
      }
    }, base);
    expect(saved.revision).toBe(1);
    expect(saved.tracks).toContain('approved-overlay');
    expect(errors).toEqual([]);
  });
}
