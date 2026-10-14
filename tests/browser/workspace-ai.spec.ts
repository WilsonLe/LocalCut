import { behaviorBases } from './coverage-bases';
import {
  confirmProviderDisconnect,
  showOpenRouterTerms,
  addOpenRouter,
  prepareOpenRouterKey,
  openAISettings,
  selectAISettingsTab,
} from './workspace-settings-helper';
import { fulfillChatTitle } from './chat-title-fixture';
import { dismissNotifications } from './workspace-notifications-helper';
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page, Route } from '@playwright/test';
import type { Project } from '../../src/core/model';

const model = 'test/workspace-resilience';
const key = 'synthetic-workspace-resilience-key';
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
async function catalog(context: BrowserContext, expectedKey?: string) {
  await context.route('https://openrouter.ai/api/v1/models', (route) => {
    if (expectedKey)
      expect(route.request().headers().authorization).toBe(
        `Bearer ${expectedKey}`,
      );
    return route.fulfill({
      headers: cors,
      json: {
        data: [
          {
            id: model,
            name: 'Resilience test model',
            context_length: 512000,
            supported_parameters: ['tools', 'tool_choice'],
          },
        ],
      },
    });
  });
}
async function createProject(page: Page, name: string) {
  await page
    .getByRole('button', { name: 'Workspace settings', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
  await page
    .getByRole('menuitem', { name: 'New project', exact: true })
    .click();
  await page.getByLabel('Project name', { exact: true }).fill(name);
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Add text', exact: true }),
  ).toBeEnabled();
}
async function snapshot(page: Page, name: string): Promise<Project> {
  return page.evaluate(async (name) => {
    const { createEditor } = (await import(
      String('/LocalCut/editor.js')
    )) as typeof import('../../src/editor');
    const editor = await createEditor();
    try {
      const project = (await editor.projects.list()).find(
        (item) => item.name === name,
      );
      if (!project) throw new Error('Expected persisted UI project');
      return project;
    } finally {
      await editor.dispose();
    }
  }, name);
}
async function chooseModel(page: Page) {
  const dialog = page.getByRole('dialog', {
    name: 'AI connection',
    exact: true,
  });
  await selectAISettingsTab(page, 'Providers');
  await expect(
    dialog.getByRole('button', { name: 'Verify OpenRouter', exact: true }),
  ).toBeVisible();
  await selectAISettingsTab(page, 'LLM - Chat');
  const choice = dialog.getByRole('combobox', {
    name: 'AI model',
    exact: true,
  });
  await expect(choice).toBeEnabled();
  await choice.click();
  await page
    .getByRole('option', {
      name: `Resilience test model · ${model}`,
      exact: true,
    })
    .click();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
}
async function openConnectedSettings(page: Page) {
  await openAISettings(page);
}
async function connect(page: Page) {
  await openAISettings(page);
  const dialog = page.getByRole('dialog', {
    name: 'AI connection',
    exact: true,
  });
  await prepareOpenRouterKey(page);
  await dialog.getByLabel('OpenRouter API key', { exact: true }).fill(key);
  await dialog
    .getByRole('button', { name: 'Use API key', exact: true })
    .click();
  await chooseModel(page);
}
async function send(page: Page, text: string) {
  await page.getByLabel('Describe your edit', { exact: true }).fill(text);
  await page
    .getByRole('button', { name: 'Send edit request', exact: true })
    .click();
}
function proposalResponse(route: Route) {
  const body = route.request().postDataJSON() as {
    messages: { role: string; tool_calls?: { function: { name: string } }[] }[];
    tools: { function: { name: string } }[];
  };
  if (!body.tools.some((tool) => tool.function.name === 'propose_edits'))
    return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'load-editing', type: 'function', function: { name: 'load_skill', arguments: '{"skillId":"editing"}' } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`;
  const completed = body.messages
    .slice(body.messages.map((message) => message.role).lastIndexOf('user') + 1)
    .some(
      (message) =>
        message.role === 'assistant' &&
        message.tool_calls?.some(
          (call) => call.function.name === 'propose_edits',
        ),
    );
  return `data: ${JSON.stringify({
    choices: [
      {
        index: 0,
        delta: completed
          ? { content: 'The new overlay track was added.' }
          : {
              tool_calls: [
                {
                  index: 0,
                  id: 'add-track',
                  type: 'function',
                  function: {
                    name: 'propose_edits',
                    arguments: JSON.stringify({
                      summary: 'Add an overlay track',
                      operations: [
                        {
                          type: 'addTrack',
                          track: { id: 'proposed-overlay', kind: 'overlay' },
                        },
                      ],
                    }),
                  },
                },
              ],
            },
        finish_reason: completed ? 'stop' : 'tool_calls',
      },
    ],
  })}\n\ndata: [DONE]\n\n`;
}
async function fulfillProposal(route: Route) {
  await route.fulfill({
    headers: cors,
    contentType: 'text/event-stream',
    body: proposalResponse(route),
  });
}

test('conversation cancellation rejects late proposals and can start a fresh turn', async ({
  page,
  context,
}) => {
  await catalog(context);
  let holdFirst = true;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let received!: () => void;
  const requestReceived = new Promise<void>((resolve) => {
    received = resolve;
  });
  let finished!: () => void;
  const requestFinished = new Promise<void>((resolve) => {
    finished = resolve;
  });
  await context.route(
    'https://openrouter.ai/api/v1/chat/completions',
    async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ headers: cors, body: '' });
        return;
      }
      if (await fulfillChatTitle(route)) return;
      if (holdFirst) {
        holdFirst = false;
        received();
        await held;
        try {
          await fulfillProposal(route);
        } catch {
          /* The browser may have already aborted the held request. */
        }
        finished();
      } else await fulfillProposal(route);
    },
  );
  await page.goto('/LocalCut/');
  const name = 'Cancelled proposal';
  await createProject(page, name);
  await connect(page);
  await send(page, 'Add an overlay track.');
  await requestReceived;
  await expect(
    page
      .getByRole('article', { name: 'Assistant response' })
      .last()
      .getByRole('status'),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Cancel response', exact: true })
    .click();
  await expect(
    page.getByText('Response stopped. No unfinished proposal was saved.', {
      exact: true,
    }),
  ).toBeVisible();
  release();
  await requestFinished;
  await expect(
    page.getByRole('button', { name: 'Apply proposal', exact: true }),
  ).toHaveCount(0);
  expect((await snapshot(page, name)).revision).toBe(0);
  expect((await snapshot(page, name)).tracks).toEqual([]);
  await send(page, 'Try adding the overlay track again.');
  await expect(
    page.getByText('Applied at revision 1', { exact: true }),
  ).toBeVisible();
  expect((await snapshot(page, name)).revision).toBe(1);
});

test('text clarification waits for a typed reply before executing the requested edit', async ({
  page,
  context,
}) => {
  await catalog(context);
  let clarified = false;
  await context.route(
    'https://openrouter.ai/api/v1/chat/completions',
    async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ headers: cors, body: '' });
        return;
      }
      if (await fulfillChatTitle(route)) return;
      const body = route.request().postDataJSON();
      if (
        String(
          body.messages
            .filter((m: { role: string }) => m.role !== 'system')
            .at(-1)?.content,
        ).includes('Yes, add the track')
      )
        clarified = true;
      if (!clarified)
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Should I add an overlay track?' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
        });
      else await fulfillProposal(route);
    },
  );
  await page.goto('/LocalCut/');
  const name = 'Text clarification';
  await createProject(page, name);
  await connect(page);
  await send(page, 'Improve the opening');
  await expect(
    page.getByText('Should I add an overlay track?', { exact: true }),
  ).toBeVisible();
  expect((await snapshot(page, name)).revision).toBe(0);
  await expect(
    page.getByRole('button', { name: 'Apply proposal', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Discard proposal', exact: true }),
  ).toHaveCount(0);
  await send(page, 'Yes, add the track');
  await expect(
    page.getByText('Applied at revision 1', { exact: true }),
  ).toBeVisible();
  expect(
    (await snapshot(page, name)).tracks.some(
      (track) => track.id === 'proposed-overlay',
    ),
  ).toBe(true);
});

test('rate-limit errors recover silently within the submitted chat turn', async ({
  page,
  context,
}) => {
  await catalog(context);
  let fail = true;
  let requests = 0;
  await context.route(
    'https://openrouter.ai/api/v1/chat/completions',
    async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ headers: cors, body: '' });
        return;
      }
      if (await fulfillChatTitle(route)) return;
      requests++;
      if (fail) {
        fail = false;
        await route.fulfill({
          status: 429,
          headers: cors,
          json: { error: 'Synthetic rate limit' },
        });
      } else await fulfillProposal(route);
    },
  );
  await page.goto('/LocalCut/');
  const name = 'Explicit retry';
  await createProject(page, name);
  await connect(page);
  await send(page, 'Add an overlay track.');
  await expect(
    page.getByText('Applied at revision 1', { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('article', { name: 'Assistant response' })
      .last()
      .getByRole('button', { name: 'Copy response', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('The new overlay track was added.', { exact: true }),
  ).toBeVisible();
  expect(requests).toBe(4);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect((await snapshot(page, name)).revision).toBe(1);
});

test('chat escalated errors preserve applied actions during manual primary retry', async ({
  page,
  context,
}) => {
  await catalog(context);
  const requests: { messages: { role: string; content: string | null }[] }[] =
    [];
  await context.route(
    'https://openrouter.ai/api/v1/chat/completions',
    async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ headers: cors, body: '' });
        return;
      }
      if (await fulfillChatTitle(route)) return;
      const body = route.request().postDataJSON() as (typeof requests)[number];
      requests.push(body);
      if (requests.length <= 2) await fulfillProposal(route);
      else if (
        body.messages
          .filter((message) => message.role === 'user')
          .at(-1)
          ?.content?.startsWith('Retry the unfinished response')
      ) {
        // Only narrate success when the canonical retained context proves the edit committed.
        expect(JSON.stringify(body.messages)).toContain('appliedRevision');
        expect(JSON.stringify(body.messages)).toContain(
          'Never repeat an action with a confirmed completed receipt',
        );
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'The saved overlay track is already added.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
        });
      } else
        await route.fulfill({
          status: 429,
          headers: cors,
          json: { error: 'Synthetic rate limit' },
        });
    },
  );
  await page.goto('/LocalCut/');
  const name = 'Manual retry keeps committed edit';
  await createProject(page, name);
  await connect(page);
  await send(page, 'Add an overlay track.');
  const retry = page.getByRole('button', {
    name: 'Retry response',
    exact: true,
  });
  await expect(retry).toBeEnabled();
  expect(requests).toHaveLength(5);
  await expect(
    page.getByText('Applied at revision 1', { exact: true }),
  ).toHaveCount(1);
  expect((await snapshot(page, name)).revision).toBe(1);
  await dismissNotifications(page);
  await retry.click();
  await expect(
    page
      .getByRole('article', { name: 'Assistant response' })
      .last()
      .getByRole('button', { name: 'Copy response', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('The saved overlay track is already added.', {
      exact: true,
    }),
  ).toBeVisible();
  expect(requests).toHaveLength(6);
  expect((await snapshot(page, name)).revision).toBe(1);
  await expect(
    page.getByText('Applied at revision 1', { exact: true }),
  ).toHaveCount(1);
  await expect(retry).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const { base, openProject } of behaviorBases.flatMap((base) =>
  [false, true].map((openProject) => ({ base, openProject })),
)) {
  test(`OAuth UI navigates back, strips secrets before exchange, and restores saved credentials on reload ${openProject ? 'with open project' : 'without project'} ${base}`, async ({
    page,
    context,
  }) => {
    // Simulate Safari retaining pre-fix stable entries after an app update.
    // The current workspace must never request these unversioned URLs.
    let staleEntryRequests = 0;
    await context.route(/\/(?:ai|editor)\.js(?:\?|$)/, (route) => {
      staleEntryRequests++;
      return route.fulfill({
        contentType: 'application/javascript',
        body: "throw new Error('Cached module from an older release');",
      });
    });
    await catalog(context, key);
    let authorization: URL | undefined;
    let exchanges = 0;
    await context.route('https://openrouter.ai/auth?*', async (route) => {
      authorization = new URL(route.request().url());
      const callback = new URL(authorization.searchParams.get('callback_url')!);
      expect(callback.hash).toBe('');
      callback.searchParams.set('code', 'synthetic-ui-authorization');
      callback.searchParams.set(
        'state',
        new URL(
          authorization.searchParams.get('callback_url')!,
        ).searchParams.get('state')!,
      );
      const href = callback.href
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;');
      await route.fulfill({
        contentType: 'text/html',
        body: `<a href="${href}">Authorize LocalCut</a>`,
      });
    });
    await context.route(
      'https://openrouter.ai/api/v1/auth/keys',
      async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ headers: cors, body: '' });
          return;
        }
        exchanges++;
        expect(new URL(page.url()).search).toBe('?campaign=ui-test');
        expect(new URL(page.url()).hash).toBe('');
        const body = route.request().postDataJSON() as Record<string, string>;
        expect(body.code).toBe('synthetic-ui-authorization');
        expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(body.code_challenge_method).toBe('S256');
        await route.fulfill({ headers: cors, json: { key } });
      },
    );
    await page.goto(base + '?campaign=ui-test');
    if (openProject)
      await createProject(page, 'OAuth project ' + crypto.randomUUID());
    expect(staleEntryRequests).toBe(0);
    const originalHash = new URL(page.url()).hash;
    if (openProject) expect(originalHash).toMatch(/^#\/project\//);
    await openAISettings(page);
    await addOpenRouter(page);
    await page
      .getByRole('button', { name: 'Log in and generate a key', exact: true })
      .click();
    await expect(
      page.getByRole('link', { name: 'Authorize LocalCut', exact: true }),
    ).toBeVisible();
    expect(staleEntryRequests).toBe(0);
    expect(authorization?.searchParams.get('code_challenge_method')).toBe(
      'S256',
    );
    expect(authorization?.searchParams.get('code_challenge')).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    await page
      .getByRole('link', { name: 'Authorize LocalCut', exact: true })
      .click();
    await selectAISettingsTab(page, 'Providers');
    await expect(
      page
        .getByRole('dialog', { name: 'AI connection', exact: true })
        .getByRole('button', { name: 'Verify OpenRouter', exact: true }),
    ).toBeVisible();
    expect(new URL(page.url()).search).toBe('?campaign=ui-test');
    expect(exchanges).toBe(1);
    await expect.poll(() => new URL(page.url()).hash).toBe(originalHash);
    await chooseModel(page);
    if (openProject)
      await expect(
        page.getByRole('button', { name: 'Add text', exact: true }),
      ).toBeEnabled();
    const stored = await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }));
    expect(stored).toEqual({
      local: {
        ...(openProject
          ? {
              'localcut.recent-project.v1': JSON.stringify({
                version: 1,
                projectId: decodeURIComponent(
                  originalHash.slice('#/project/'.length),
                ),
              }),
            }
          : {}),
        'localcut.openrouter-credential.v1': JSON.stringify({
          version: 1,
          key,
        }),
        'localcut.workspace-preferences.v1': JSON.stringify({
          version: 1,
          preferences: {
            chatWidth: 320,
            mediaWidth: 300,
            timelineHeight: 260,
            chatCollapsed: false,
            mediaOpen: false,
            timelineSnapping: true,
            exportFormat: 'mp4',
            aiModel: model,
            aiProviders: JSON.stringify({
              profiles: [
                { id: 'openrouter', name: 'OpenRouter', kind: 'openrouter' },
              ],
              routes: {
                llm: [{ providerId: 'openrouter', model }],
                tts: [{ providerId: 'openrouter', model: '' }],
                stt: [{ providerId: 'local', model: 'whisper' }],
              },
            }),
          },
        }),
      },
      session: {},
    });
    expect(JSON.stringify(stored.session)).not.toContain(key);
    expect(stored.local['localcut.workspace-preferences.v1']).not.toContain(
      key,
    );
    expect(JSON.stringify(stored)).not.toContain('synthetic-ui-authorization');
    expect(await page.locator('body').innerText()).not.toContain(key);
    await page.reload();
    await expect.poll(() => new URL(page.url()).hash).toBe(originalHash);
    if (openProject)
      await expect(
        page.getByRole('button', { name: 'Add text', exact: true }),
      ).toBeEnabled();
    await openConnectedSettings(page);
    await selectAISettingsTab(page, 'Providers');
    await expect(
      page.getByRole('button', { name: 'Verify OpenRouter', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel('OpenRouter API key', { exact: true }),
    ).not.toBeVisible();
    expect(exchanges).toBe(1);
    await selectAISettingsTab(page, 'Providers');
    await page
      .getByRole('button', { name: 'Disconnect OpenRouter', exact: true })
      .click();
    await confirmProviderDisconnect(page);
    await expect(
      page.getByRole('button', { name: 'I have an API key', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        localStorage.getItem('localcut.openrouter-credential.v1'),
      ),
    ).toBeNull();
    await page.reload();
    await openAISettings(page);
    await expect(
      page.getByRole('button', { name: 'Verify OpenRouter', exact: true }),
    ).toHaveCount(0);
    expect(exchanges).toBe(1);
    expect(staleEntryRequests).toBe(0);
  });
}

for (const base of behaviorBases) {
  test(`saved API key restores speech access and full context, and disconnects other tabs ${base}`, async ({
    page,
    context,
  }) => {
    await catalog(context, key);
    let paid = 0;
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      (route) => {
        paid++;
        return route.abort();
      },
    );
    await context.route(
      'https://openrouter.ai/api/v1/audio/speech',
      (route) => {
        paid++;
        return route.abort();
      },
    );
    await page.goto(base);
    const name = 'Persistent speech ' + crypto.randomUUID();
    await createProject(page, name);
    await connect(page);
    await openConnectedSettings(page);
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await selectAISettingsTab(page, 'Providers');
    await expect(
      dialog.getByRole('button', {
        name: 'Disconnect OpenRouter',
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: `.artifacts/persist-openrouter/connection-${base === '/' ? 'root' : 'pages'}.png`,
    });
    const terms1 = await showOpenRouterTerms(page);
    await expect(terms1).toContainText('context categories stay enabled');
    await page
      .getByRole('button', { name: 'OpenRouter connection terms', exact: true })
      .click();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page.reload();
    await openConnectedSettings(page);
    await selectAISettingsTab(page, 'Providers');
    await expect(
      dialog.getByRole('button', { name: 'Verify OpenRouter', exact: true }),
    ).toBeVisible();
    const terms2 = await showOpenRouterTerms(page);
    await expect(terms2).toContainText('including after reload');
    await page
      .getByRole('button', { name: 'OpenRouter connection terms', exact: true })
      .click();
    await expect(
      dialog.getByRole('button', { name: 'Data & analytics' }),
    ).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page
      .getByRole('button', { name: 'Open project', exact: true })
      .click();
    await page
      .getByRole('main', { name: 'Projects', exact: true })
      .getByRole('button')
      .filter({ has: page.getByText(name, { exact: true }) })
      .click();
    await expect(
      page.getByRole('button', { name: 'Open project', exact: true }),
    ).toContainText(name);
    await page.getByRole('button', { name: 'Commands', exact: true }).click();
    const commands = page.getByRole('dialog', {
      name: 'Commands',
      exact: true,
    });
    await commands.getByRole('combobox').fill('Speech');
    await expect(
      commands.getByRole('option', { name: /Text to speech/ }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    const other = await context.newPage();
    await other.goto(base);
    await openConnectedSettings(other);
    await selectAISettingsTab(other, 'Providers');
    await expect(
      other.getByRole('button', { name: 'Verify OpenRouter', exact: true }),
    ).toBeVisible();
    await selectAISettingsTab(other, 'Providers');
    await other
      .getByRole('button', { name: 'Disconnect OpenRouter', exact: true })
      .click();
    await confirmProviderDisconnect(other);
    await openAISettings(page);
    await expect(
      dialog.getByRole('button', { name: 'I have an API key', exact: true }),
    ).toBeVisible();
    await page.reload();
    await openAISettings(page);
    await expect(
      page.getByRole('button', { name: 'Verify OpenRouter', exact: true }),
    ).toHaveCount(0);
    expect(paid).toBe(0);
    await other.close();
  });
  test(`saved credential storage failures are actionable and never connect ${base}`, async ({
    page,
    context,
  }) => {
    await catalog(context, key);
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'localcut.openrouter-credential.v1')
          throw new Error('PRIVATE-storage-error');
        return original.call(this, key, value);
      };
    });
    await page.goto(base);
    await openAISettings(page);
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await prepareOpenRouterKey(page);
    await dialog.getByLabel('OpenRouter API key', { exact: true }).fill(key);
    await dialog
      .getByRole('button', { name: 'Use API key', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toContainText(
      'Allow local browser storage',
    );
    await expect(
      page.getByRole('button', { name: 'Verify OpenRouter', exact: true }),
    ).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toContain(
      'PRIVATE-storage-error',
    );
  });
  test(`saved credential removal failure retires the connection and allows retry ${base}`, async ({
    page,
    context,
  }) => {
    await catalog(context, key);
    await page.goto(base);
    await connect(page);
    await openConnectedSettings(page);
    await page.evaluate(() => {
      const original = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function (key) {
        if (key === 'localcut.openrouter-credential.v1')
          throw new Error('PRIVATE-removal-error');
        return original.call(this, key);
      };
      Object.assign(window, {
        allowCredentialRemoval: () => {
          Storage.prototype.removeItem = original;
        },
      });
    });
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await selectAISettingsTab(page, 'Providers');
    await dialog
      .getByRole('button', { name: 'Disconnect OpenRouter', exact: true })
      .click();
    await confirmProviderDisconnect(page);
    await expect(dialog.getByRole('alert')).toContainText(
      'Allow local browser storage',
    );
    await expect(
      page.getByRole('button', { name: 'Verify OpenRouter', exact: true }),
    ).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toContain(
      'PRIVATE-removal-error',
    );
    expect(
      await page.evaluate(
        () =>
          localStorage.getItem('localcut.openrouter-credential.v1') !== null,
      ),
    ).toBe(true);
    await page.evaluate(() => {
      (
        window as unknown as { allowCredentialRemoval(): void }
      ).allowCredentialRemoval();
    });
    await dialog
      .getByRole('button', { name: 'Retry removing saved key', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        localStorage.getItem('localcut.openrouter-credential.v1'),
      ),
    ).toBeNull();
    await page.reload();
    await openAISettings(page);
    await expect(
      page.getByRole('button', { name: 'Verify OpenRouter', exact: true }),
    ).toHaveCount(0);
  });
  test(`malformed saved credential does not restore or start provider requests ${base}`, async ({
    page,
    context,
  }) => {
    let requests = 0;
    await context.route('https://openrouter.ai/**', (route) => {
      requests++;
      return route.abort();
    });
    await page.goto(base);
    await page.evaluate(() =>
      localStorage.setItem('localcut.openrouter-credential.v1', '{bad'),
    );
    await page.reload();
    await expect(
      page.getByRole('dialog', { name: 'AI connection', exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('dialog', { name: 'AI connection', exact: true })
        .getByRole('alert'),
    ).toContainText('Check credentials and reconnect');
    await expect(
      page.getByRole('button', { name: 'Verify OpenRouter', exact: true }),
    ).toHaveCount(0);
    expect(requests).toBe(0);
  });
}
