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
async function catalog(context: BrowserContext) {
  await context.route('https://openrouter.ai/api/v1/models', (route) =>
    route.fulfill({
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
    }),
  );
}
async function createProject(page: Page, name: string) {
  await page.getByRole('button', { name: 'New project', exact: true }).click();
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
async function connect(page: Page) {
  await page
    .getByRole('button', { name: 'Connect AI', exact: true })
    .first()
    .click();
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
    messages: { role: string }[];
  };
  const completed = body.messages.some((message) => message.role === 'tool');
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
  await expect(
    page.getByRole('dialog', { name: 'Clip properties', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('dialog', { name: 'Clip properties', exact: true }),
  ).not.toBeVisible();
  await expect(apply).toBeDisabled();
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
    page
      .getByRole('alert')
      .filter({ hasText: 'OpenRouter is rate limiting requests.' }),
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
  expect(requests).toBe(3);
  expect((await snapshot(page, name)).revision).toBe(0);
});

for (const base of ['/', '/LocalCut/']) {
  test(`OAuth UI navigates back, strips secrets before exchange, and forgets credentials on reload ${base}`, async ({
    page,
    context,
  }) => {
    await catalog(context);
    let authorization: URL | undefined;
    let exchanges = 0;
    await context.route('https://openrouter.ai/auth?*', async (route) => {
      authorization = new URL(route.request().url());
      const callback = new URL(authorization.searchParams.get('callback_url')!);
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
        const body = route.request().postDataJSON() as Record<string, string>;
        expect(body.code).toBe('synthetic-ui-authorization');
        expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(body.code_challenge_method).toBe('S256');
        await route.fulfill({ headers: cors, json: { key } });
      },
    );
    await page.goto(base + '?campaign=ui-test');
    await page
      .getByRole('button', { name: 'Connect AI', exact: true })
      .first()
      .click();
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
    await chooseModel(page);
    const stored = await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }));
    expect(stored).toEqual({
      local: {
        'localcut.workspace-preferences.v1': JSON.stringify({
          version: 1,
          preferences: {
            chatWidth: 320,
            chatCollapsed: false,
            mediaOpen: false,
            exportFormat: 'mp4',
            aiModel: model,
          },
        }),
      },
      session: {},
    });
    expect(JSON.stringify(stored)).not.toContain(key);
    expect(JSON.stringify(stored)).not.toContain('synthetic-ui-authorization');
    expect(await page.locator('body').innerText()).not.toContain(key);
    await page.reload();
    await page
      .getByRole('button', { name: 'Connect AI', exact: true })
      .first()
      .click();
    await expect(
      page.getByLabel('OpenRouter API key', { exact: true }),
    ).toHaveValue('');
    await expect(page.getByText('Key connected', { exact: true })).toHaveCount(
      0,
    );
    expect(exchanges).toBe(1);
  });
}
