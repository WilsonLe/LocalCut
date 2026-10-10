import { openAISettings } from './workspace-settings-helper';
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
            context_length: 32000,
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
  await expect(
    dialog.getByText('Key connected', { exact: true }),
  ).toBeVisible();
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
          ? { content: 'The new overlay track is ready for review.' }
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
  await expect(page.getByText(/Response in progress/)).toBeVisible();
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
    page.getByRole('button', { name: 'Apply proposal', exact: true }),
  ).toBeEnabled();
  expect((await snapshot(page, name)).revision).toBe(0);
});

test('manual edits make an earlier proposal stale without committing it', async ({
  page,
  context,
}) => {
  await catalog(context);
  await context.route(
    'https://openrouter.ai/api/v1/chat/completions',
    async (route) => {
      if (route.request().method() === 'OPTIONS')
        await route.fulfill({ headers: cors, body: '' });
      else await fulfillProposal(route);
    },
  );
  await page.goto('/LocalCut/');
  const name = 'Stale proposal';
  await createProject(page, name);
  await connect(page);
  await send(page, 'Add an overlay track.');
  const apply = page.getByRole('button', {
    name: 'Apply proposal',
    exact: true,
  });
  await expect(apply).toBeEnabled();
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await page
    .getByRole('button', { name: 'Insert Plain text', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Clip properties', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('dialog', { name: 'Clip properties', exact: true }),
  ).not.toBeVisible();
  await expect(apply).toHaveCount(0);
  await expect(
    page.getByText('Project changed. Ask for a new proposal.', { exact: true }),
  ).toBeVisible();
  const afterManual = await snapshot(page, name);
  expect(afterManual.revision).toBe(1);
  expect(afterManual.tracks.flatMap((track) => track.clips)).toHaveLength(1);
  expect(
    afterManual.tracks.some((track) => track.id === 'proposed-overlay'),
  ).toBe(false);
  await page
    .getByRole('button', { name: 'Discard proposal', exact: true })
    .click();
  await expect(
    page.getByText('Proposal discarded', { exact: true }),
  ).toBeVisible();
  expect(await snapshot(page, name)).toEqual(afterManual);
});

test('rate-limit errors remain visible and retry requires a fresh send', async ({
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
    page.getByRole('alert').filter({ hasText: /rate limiting requests/ }),
  ).toBeVisible();
  expect(requests).toBe(1);
  expect((await snapshot(page, name)).revision).toBe(0);
  await expect(
    page.getByRole('button', { name: 'Apply proposal', exact: true }),
  ).toHaveCount(0);
  await send(page, 'Retry the overlay track request.');
  await expect(
    page.getByRole('button', { name: 'Apply proposal', exact: true }),
  ).toBeEnabled();
  expect(requests).toBe(4);
  expect((await snapshot(page, name)).revision).toBe(0);
});

for (const { base, openProject } of ['/', '/LocalCut/'].flatMap((base) =>
  [false, true].map((openProject) => ({ base, openProject })),
)) {
  test(`OAuth UI navigates back, strips secrets before exchange, and restores saved credentials on reload ${openProject ? 'with open project' : 'without project'} ${base}`, async ({
    page,
    context,
  }) => {
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
        authorization.searchParams.get('state')!,
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
    const originalHash = new URL(page.url()).hash;
    if (openProject) expect(originalHash).toMatch(/^#\/project\//);
    await openAISettings(page);
    await page
      .getByRole('button', { name: 'Connect with OpenRouter', exact: true })
      .click();
    await expect(
      page.getByRole('link', { name: 'Authorize LocalCut', exact: true }),
    ).toBeVisible();
    expect(authorization?.searchParams.get('code_challenge_method')).toBe(
      'S256',
    );
    expect(authorization?.searchParams.get('code_challenge')).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    await page
      .getByRole('link', { name: 'Authorize LocalCut', exact: true })
      .click();
    await expect(
      page
        .getByRole('dialog', { name: 'AI connection', exact: true })
        .getByText('Key connected', { exact: true }),
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
    await expect(
      page.getByText('Key connected', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel('OpenRouter API key', { exact: true }),
    ).toHaveCount(0);
    expect(exchanges).toBe(1);
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(
      page.getByLabel('OpenRouter API key', { exact: true }),
    ).toHaveValue('');
    expect(
      await page.evaluate(() =>
        localStorage.getItem('localcut.openrouter-credential.v1'),
      ),
    ).toBeNull();
    await page.reload();
    await openAISettings(page);
    await expect(page.getByText('Key connected', { exact: true })).toHaveCount(
      0,
    );
    expect(exchanges).toBe(1);
  });
}

for (const base of ['/', '/LocalCut/']) {
  test(`saved API key restores speech access, resets sharing and disconnects other tabs ${base}`, async ({
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
    await expect(
      dialog.getByText('Saved on this device', { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `.artifacts/persist-openrouter/connection-${base === '/' ? 'root' : 'pages'}.png`,
    });
    await dialog
      .getByRole('button', { name: 'Data & analytics', exact: true })
      .click();
    await page
      .getByRole('checkbox', {
        name: 'Share overlay and caption text',
        exact: true,
      })
      .check();
    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page.reload();
    await openConnectedSettings(page);
    await expect(
      dialog.getByText('Key connected', { exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Data & analytics', exact: true })
      .click();
    await expect(
      page.getByRole('checkbox', {
        name: 'Share overlay and caption text',
        exact: true,
      }),
    ).not.toBeChecked();
    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page
      .getByRole('button', { name: 'Open project', exact: true })
      .click();
    await page.getByRole('button', { name: new RegExp(name) }).click();
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
    await expect(
      other.getByText('Key connected', { exact: true }),
    ).toBeVisible();
    await other
      .getByRole('button', { name: 'Disconnect', exact: true })
      .click();
    await openAISettings(page);
    await expect(
      dialog.getByLabel('OpenRouter API key', { exact: true }),
    ).toBeVisible();
    await page.reload();
    await openAISettings(page);
    await expect(page.getByText('Key connected', { exact: true })).toHaveCount(
      0,
    );
    expect(paid).toBe(0);
    await other.close();
  });
  test(`saved connection preserves disabled services and cross-tab removal preserves another provider ${base}`, async ({
    page,
    context,
  }) => {
    await catalog(context, key);
    const paid: string[] = [];
    page.on('request', (request) => {
      if (
        /chat\/completions|audio\/speech|audio\/transcriptions/.test(
          request.url(),
        )
      )
        paid.push(request.url());
    });
    await page.goto(base);
    const routes = {
      llm: [
        { providerId: 'backup', model: 'backup' },
        { providerId: 'openrouter', model },
      ],
      tts: [],
      stt: [{ providerId: 'local', model: 'whisper' }],
    };
    await page.evaluate(
      ({ routes, key }) => {
        localStorage.setItem(
          'localcut.openrouter-credential.v1',
          JSON.stringify({ version: 1, key }),
        );
        localStorage.setItem(
          'localcut.workspace-preferences.v1',
          JSON.stringify({
            version: 1,
            preferences: {
              aiProviders: JSON.stringify({
                profiles: [
                  { id: 'openrouter', name: 'OpenRouter', kind: 'openrouter' },
                  {
                    id: 'backup',
                    name: 'Local backup',
                    kind: 'compatible',
                    baseUrl: 'http://localhost:1234/v1',
                    model: 'backup',
                  },
                ],
                routes,
              }),
            },
          }),
        );
      },
      { routes, key },
    );
    await page.reload();
    await openConnectedSettings(page);
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await expect(
      dialog.getByText('Key connected', { exact: true }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await createProject(page, 'Multi-provider credential isolation');
    await expect(
      page.getByRole('button', { name: 'Text to speech', exact: true }),
    ).toHaveCount(0);
    await openConnectedSettings(page);
    await dialog.getByText('Providers & services', { exact: true }).click();
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    await dialog
      .getByRole('button', { name: 'Connect endpoint', exact: true })
      .click();
    await expect(
      dialog.getByRole('combobox', { name: 'AI model', exact: true }),
    ).toBeEnabled();
    await dialog
      .getByRole('combobox', { name: 'AI model', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'backup · backup', exact: true })
      .click();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(
      page.getByLabel('Describe your edit', { exact: true }),
    ).toBeEnabled();
    const other = await context.newPage();
    await other.goto(base);
    await openConnectedSettings(other);
    await other.evaluate(() =>
      localStorage.removeItem('localcut.openrouter-credential.v1'),
    );
    await openConnectedSettings(page);
    await expect(
      dialog.getByText('Key connected', { exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole('combobox', { name: 'AI model', exact: true }),
    ).toBeEnabled();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(
      page.getByLabel('Describe your edit', { exact: true }),
    ).toBeEnabled();
    const savedRoutes = await page.evaluate(
      () =>
        JSON.parse(
          JSON.parse(localStorage.getItem('localcut.workspace-preferences.v1')!)
            .preferences.aiProviders,
        ).routes,
    );
    expect(savedRoutes).toEqual(routes);
    expect(paid).toEqual([]);
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
    await dialog.getByLabel('OpenRouter API key', { exact: true }).fill(key);
    await dialog
      .getByRole('button', { name: 'Use API key', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toContainText(
      'Allow local browser storage',
    );
    await expect(page.getByText('Key connected', { exact: true })).toHaveCount(
      0,
    );
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
    await dialog
      .getByRole('button', { name: 'Disconnect', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toContainText(
      'Allow local browser storage',
    );
    await expect(page.getByText('Key connected', { exact: true })).toHaveCount(
      0,
    );
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
      .getByRole('button', { name: 'Disconnect', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        localStorage.getItem('localcut.openrouter-credential.v1'),
      ),
    ).toBeNull();
    await page.reload();
    await openAISettings(page);
    await expect(page.getByText('Key connected', { exact: true })).toHaveCount(
      0,
    );
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
    await expect(page.getByText('Key connected', { exact: true })).toHaveCount(
      0,
    );
    expect(requests).toBe(0);
  });
}
