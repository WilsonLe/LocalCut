import { expect, test } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import type { OpenRouter, Assistant } from '../../src/ai';

declare global {
  interface Window {
    aiProvider: OpenRouter;
    aiAssistant: Assistant;
    aiPending: Promise<string>;
  }
}
const model = 'test/tool-model';
const syntheticKey = 'test-key-not-a-real-credential';
const sse = (values: unknown[]) =>
  values.map((value) => `data: ${JSON.stringify(value)}\r\n\r\n`).join('') +
  'data: [DONE]\r\n\r\n';
const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
async function mockCatalog(context: BrowserContext) {
  await context.route('https://openrouter.ai/api/v1/models', (route) =>
    route.fulfill({
      headers,
      json: {
        data: [
          {
            id: model,
            name: 'Test model',
            context_length: 32000,
            supported_parameters: ['tools', 'tool_choice'],
            architecture: {
              input_modalities: ['text'],
              output_modalities: ['text'],
            },
          },
        ],
      },
    }),
  );
}

for (const base of ['/', '/LocalCut/']) {
  test(`AI entry is inert and OAuth survives only its tab callback ${base}`, async ({
    page,
    context,
  }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.goto(base);
    await expect(page.locator('.workspace')).toBeVisible();
    const before = await page.evaluate(async (path) => {
      const ai = (await import(
        path + 'ai.js'
      )) as typeof import('../../src/ai');
      window.aiProvider = ai.createOpenRouter();
      return {
        workspace: !!document.querySelector('.workspace'),
        databases: await indexedDB.databases(),
        local: Object.keys(localStorage),
        session: Object.keys(sessionStorage),
        status: window.aiProvider.status(),
      };
    }, base);
    expect(before).toEqual({
      workspace: true,
      databases: [],
      local: [],
      session: [],
      status: { connected: false },
    });
    expect(requests.filter((url) => url.startsWith('https:'))).toEqual([]);
    const pending = await page.evaluate(async () => {
      const callback = new URL(location.href);
      callback.search = '?project=example';
      const auth = await window.aiProvider.beginAuthorization({
        callbackUrl: callback.href,
      });
      return {
        ...auth,
        callback: callback.href,
        session: Object.values(sessionStorage),
      };
    });
    const authUrl = new URL(pending.authorizationUrl);
    expect(authUrl.origin).toBe('https://openrouter.ai');
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authUrl.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    expect(
      new URL(authUrl.searchParams.get('callback_url')!).searchParams.get(
        'state',
      ),
    ).toMatch(/^[\w-]{43}$/);
    expect(authUrl.searchParams.has('state')).toBe(false);
    await page.reload();
    await context.route(
      'https://openrouter.ai/api/v1/auth/keys',
      async (route) => {
        const body = route.request().postDataJSON() as Record<string, string>;
        expect(body.code).toBe('synthetic-code');
        expect(body.code_verifier).toBeTruthy();
        expect(body.code_challenge_method).toBe('S256');
        await route.fulfill({ headers, json: { key: syntheticKey } });
      },
    );
    const callback = new URL(authUrl.searchParams.get('callback_url')!);
    callback.searchParams.set('code', 'synthetic-code');
    const connected = await page.evaluate(
      async ({ path, callback }) => {
        const ai = (await import(
          path + 'ai.js'
        )) as typeof import('../../src/ai');
        window.aiProvider = ai.createOpenRouter();
        await window.aiProvider.completeAuthorization({
          callbackUrl: callback,
        });
        return {
          status: window.aiProvider.status(),
          local: Object.values(localStorage),
          session: Object.values(sessionStorage),
        };
      },
      { path: base, callback: callback.href },
    );
    expect(connected).toEqual({
      status: { connected: true },
      local: [],
      session: [],
    });
    await page.reload();
    expect(
      await page.evaluate(async (path) => {
        const { createOpenRouter } = (await import(
          path + 'ai.js'
        )) as typeof import('../../src/ai');
        return createOpenRouter().status();
      }, base),
    ).toEqual({ connected: false });
    const cancelledCallback = await page.evaluate(async (path) => {
      const { createOpenRouter } = (await import(
        path + 'ai.js'
      )) as typeof import('../../src/ai');
      const original = createOpenRouter();
      const auth = await original.beginAuthorization({
        callbackUrl: location.href,
      });
      const callback = new URL(
        new URL(auth.authorizationUrl).searchParams.get('callback_url')!,
      );
      callback.searchParams.set('code', 'must-not-exchange');
      const fresh = createOpenRouter();
      fresh.disconnect();
      const error = await fresh
        .completeAuthorization({ callbackUrl: callback.href })
        .then(
          () => 'unexpected',
          (error: { code: string }) => error.code,
        );
      const result = {
        error,
        connected: fresh.status().connected,
        session: Object.values(sessionStorage),
      };
      fresh.dispose();
      original.dispose();
      return result;
    }, base);
    expect(cancelledCallback).toEqual({
      error: 'AUTH_FLOW_INVALID',
      connected: false,
      session: [],
    });
    await expect(
      page.getByRole('heading', { name: 'Start with your footage.' }),
    ).toBeVisible();
  });

  test(`AI proposal uses real persisted engine, explicit apply and Undo ${base}`, async ({
    page,
    context,
  }) => {
    await mockCatalog(context);
    const requests: Record<string, unknown>[] = [];
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        const requestTools = (
          route.request().postDataJSON() as {
            tools: { function: { name: string } }[];
          }
        ).tools;
        if (
          !requestTools.some((tool) => tool.function.name === 'propose_edits')
        ) {
          await route.fulfill({
            headers: headers,
            contentType: 'text/event-stream',
            body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'load-editing', type: 'function', function: { name: 'load_skill', arguments: '{"skillId":"editing"}' } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`,
          });
          return;
        }
        requests.push(body);
        const first = requests.length % 2 === 1;
        const events = first
          ? [
              {
                choices: [
                  {
                    index: 0,
                    delta: {
                      reasoning_details: [
                        {
                          type: 'reasoning.encrypted',
                          data: 'opaque-provider-state',
                          id: 'reasoning-1',
                          format: 'anthropic-claude-v1',
                          index: 0,
                        },
                      ],
                      tool_calls: [
                        {
                          index: 0,
                          id: 'proposal',
                          type: 'function',
                          function: {
                            name: 'propose_edits',
                            arguments: '{"summary":"Add title",',
                          },
                        },
                      ],
                    },
                  },
                ],
              },
              {
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          function: {
                            arguments:
                              '"operations":[{"type":"addTrack","track":{"id":"title-track","kind":"overlay"}}]}',
                          },
                        },
                      ],
                    },
                    finish_reason: 'tool_calls',
                  },
                ],
              },
            ]
          : [
              {
                choices: [
                  {
                    index: 0,
                    delta: { content: 'A proposal is ready for review.' },
                    finish_reason: 'stop',
                  },
                ],
              },
              {
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                usage: {
                  prompt_tokens: 30,
                  completion_tokens: 10,
                  total_tokens: 40,
                  cost: 0.001,
                },
              },
            ];
        await route.fulfill({
          headers,
          contentType: 'text/event-stream',
          body: ': keepalive\r\n\r\n' + sse(events),
        });
      },
    );
    await page.goto(base);
    const result = await page.evaluate(
      async ({ path, key, model }) => {
        const { createEditor } = (await import(
          path + 'editor.js'
        )) as typeof import('../../src/editor');
        const { createOpenRouter, createAssistant } = (await import(
          path + 'ai.js'
        )) as typeof import('../../src/ai');
        const namespace = 'test-ai-' + crypto.randomUUID();
        const editor = await createEditor({ namespace });
        const project = await editor.projects.create('PRIVATE PROJECT NAME');
        await editor.commands.apply({
          projectId: project.id,
          requestId: 'setup',
          expectedRevision: 0,
          operations: [
            {
              type: 'addTrack',
              track: {
                id: 'private-overlay',
                kind: 'overlay',
                clips: [
                  {
                    id: 'private-text',
                    kind: 'text',
                    startUs: 0,
                    durationUs: 1000000,
                    text: { text: 'PRIVATE OVERLAY TEXT' },
                    cues: [
                      {
                        id: 'cue',
                        timeUs: 0,
                        endUs: 1,
                        text: 'PRIVATE CAPTION',
                      },
                    ],
                  },
                ],
              },
            },
          ],
        });
        const provider = createOpenRouter();
        provider.setKey(key);
        const assistant = createAssistant({
          editor,
          provider,
          projectId: project.id,
          model,
        });
        const events: string[] = [];
        assistant.subscribe((event) => events.push(event.type));
        assistant.subscribe(() => {
          throw new Error('consumer failure');
        });
        const result = await assistant.run('Add an overlay track for my title.')
          .completion;
        const proposal = assistant.getProposal(result.proposalIds[0]!);
        const before = await editor.projects.snapshot(project.id);
        proposal.batch.operations = [
          { type: 'removeTrack', trackId: 'private-overlay' },
        ];
        const [receipt, replay] = await Promise.all([
          assistant.applyProposal(proposal.id),
          assistant.applyProposal(proposal.id),
        ]);
        const after = await editor.projects.snapshot(project.id);
        await editor.commands.undo(project.id, 'undo-ai', after.revision);
        const undone = await editor.projects.snapshot(project.id);
        await assistant.dispose();
        provider.dispose();
        await editor.dispose();
        const reopened = await createEditor({ namespace });
        const restored = await reopened.projects.snapshot(project.id);
        const backup = await reopened.projects.exportJSON(project.id);
        await reopened.dispose();
        return {
          before: before.revision,
          after: after.revision,
          undone: undone.revision,
          afterIds: after.tracks.map((track) => track.id),
          restoredIds: restored.tracks.map((track) => track.id),
          duplicate: JSON.stringify(receipt) === JSON.stringify(replay),
          events,
          result,
          backupContainsKey: backup.includes(key),
          local: Object.values(localStorage),
          session: Object.values(sessionStorage),
        };
      },
      { path: base, key: syntheticKey, model },
    );
    expect(result.before).toBe(1);
    expect(result.after).toBe(2);
    expect(result.undone).toBe(3);
    expect(result.afterIds).toEqual(['private-overlay', 'title-track']);
    expect(result.restoredIds).toEqual(['private-overlay']);
    expect(result.duplicate).toBe(true);
    expect(result.backupContainsKey).toBe(false);
    expect(result.local).toEqual([]);
    expect(result.session).toEqual([]);
    expect(result.events).toContain('proposal');
    expect(result.events).toContain('completed');
    expect(result.result.usage.totalTokens).toBe(40);
    expect(requests).toHaveLength(2);
    const continuation = (
      requests[1]!.messages as Record<string, unknown>[]
    ).find(
      (message) => message.role === 'assistant' && message.reasoning_details,
    );
    expect(continuation?.reasoning_details).toEqual([
      {
        type: 'reasoning.encrypted',
        data: 'opaque-provider-state',
        id: 'reasoning-1',
        format: 'anthropic-claude-v1',
        index: 0,
      },
    ]);
    expect(result.result.text).not.toContain('opaque-provider-state');
    const payload = JSON.stringify(requests);
    expect(payload).not.toMatch(
      /PRIVATE PROJECT NAME|PRIVATE OVERLAY TEXT|PRIVATE CAPTION/,
    );
    expect(payload).not.toContain(syntheticKey);
    expect(requests[0]!.provider).toMatchObject({
      require_parameters: true,
      data_collection: 'deny',
    });
    await expect(
      page.getByRole('heading', { name: 'Start with your footage.' }),
    ).toBeVisible();
  });
}

test('OpenRouter HTTP failures are sanitized', async ({ page, context }) => {
  await page.goto('/LocalCut/');
  await mockCatalog(context);
  await context.route(
    'https://openrouter.ai/api/v1/chat/completions',
    (route) =>
      route.fulfill({
        status: 402,
        headers,
        json: { error: { message: syntheticKey + ' PRIVATE DATA' } },
      }),
  );
  const failure = await page.evaluate(
    async ({ key, model }) => {
      const ai = (await import(
        String('/LocalCut/ai.js')
      )) as typeof import('../../src/ai');
      const editorModule = (await import(
        String('/LocalCut/editor.js')
      )) as typeof import('../../src/editor');
      const editor = await editorModule.createEditor({
        namespace: 'test-ai-failure-' + crypto.randomUUID(),
      });
      const project = await editor.projects.create('Failure');
      window.aiProvider = ai.createOpenRouter();
      window.aiProvider.setKey(key);
      window.aiAssistant = ai.createAssistant({
        editor,
        provider: window.aiProvider,
        projectId: project.id,
        model,
      });
      const error = await window.aiAssistant
        .run('Help')
        .completion.catch((error: { code: string; message: string }) => ({
          code: error.code,
          message: error.message,
        }));
      await window.aiAssistant.dispose();
      window.aiProvider.dispose();
      await editor.dispose();
      return error;
    },
    { key: syntheticKey, model },
  );
  expect(failure).toMatchObject({ code: 'INSUFFICIENT_CREDITS' });
  expect(JSON.stringify(failure)).not.toContain(syntheticKey);
  expect(JSON.stringify(failure)).not.toContain('PRIVATE DATA');
});

test('disconnect cancels a pending browser request without publishing a proposal', async ({
  page,
  context,
}) => {
  await mockCatalog(context);
  let requested = false;
  await context.route('https://openrouter.ai/api/v1/chat/completions', () => {
    requested = true;
  });
  await page.goto('/LocalCut/');
  await page.evaluate(
    async ({ key, model }) => {
      const { createEditor } = (await import(
        String('/LocalCut/editor.js')
      )) as typeof import('../../src/editor');
      const { createOpenRouter, createAssistant } = (await import(
        String('/LocalCut/ai.js')
      )) as typeof import('../../src/ai');
      window.editor = await createEditor({
        namespace: 'test-ai-cancel-' + crypto.randomUUID(),
      });
      const project = await window.editor.projects.create('Cancel');
      window.aiProvider = createOpenRouter();
      window.aiProvider.setKey(key);
      window.aiAssistant = createAssistant({
        editor: window.editor,
        provider: window.aiProvider,
        projectId: project.id,
        model,
      });
      window.aiPending = window.aiAssistant
        .run('Add an overlay')
        .completion.then(
          () => 'unexpected completion',
          (error: { code: string }) => error.code,
        );
    },
    { key: syntheticKey, model },
  );
  await expect.poll(() => requested).toBe(true);
  const result = await page.evaluate(async () => {
    window.aiProvider.disconnect();
    const code = await window.aiPending;
    const state = window.aiAssistant.snapshot();
    await window.aiAssistant.dispose();
    await window.editor.dispose();
    return { code, state, connected: window.aiProvider.status().connected };
  });
  expect(result.code).toBe('CANCELLED');
  expect(result.connected).toBe(false);
  expect(result.state.proposals).toEqual([]);
});

test('explicitly selected library media can be proposed; stale batches cannot commit', async ({
  page,
  context,
}) => {
  await mockCatalog(context);
  await page.goto('/LocalCut/');
  const setup = await page.evaluate(
    async ({ key, model }) => {
      const { createEditor } = (await import(
        String('/LocalCut/editor.js')
      )) as typeof import('../../src/editor');
      const { createOpenRouter, createAssistant } = (await import(
        String('/LocalCut/ai.js')
      )) as typeof import('../../src/ai');
      window.editor = await createEditor({
        namespace: 'test-ai-media-' + crypto.randomUUID(),
      });
      window.project = await window.editor.projects.create('Selected media');
      const canvas = new OffscreenCanvas(16, 16);
      canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
      window.asset = await window.editor.assets.import(
        await canvas.convertToBlob(),
        'PRIVATE IMAGE NAME',
      ).completion;
      window.aiProvider = createOpenRouter();
      window.aiProvider.setKey(key);
      window.aiAssistant = createAssistant({
        editor: window.editor,
        provider: window.aiProvider,
        projectId: window.project.id,
        model,
        assetIds: [window.asset.id],
      });
      return { assetId: window.asset.id };
    },
    { key: syntheticKey, model },
  );
  let round = 0;
  const outgoing: string[] = [];
  await context.route(
    'https://openrouter.ai/api/v1/chat/completions',
    async (route) => {
      const requestTools = (
        route.request().postDataJSON() as {
          tools: { function: { name: string } }[];
        }
      ).tools;
      if (
        !requestTools.some((tool) => tool.function.name === 'propose_edits')
      ) {
        await route.fulfill({
          headers: headers,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'load-editing', type: 'function', function: { name: 'load_skill', arguments: '{"skillId":"editing"}' } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`,
        });
        return;
      }
      outgoing.push(route.request().postData()!);
      round++;
      const message =
        round % 2 === 1
          ? {
              tool_calls: [
                {
                  index: 0,
                  id: 'media',
                  type: 'function',
                  function: {
                    name: 'propose_edits',
                    arguments: JSON.stringify({
                      summary: 'Insert selected image',
                      operations: [
                        {
                          type: 'addTrack',
                          track: { id: 'selected-media', kind: 'video' },
                        },
                        {
                          type: 'insertClip',
                          trackId: 'selected-media',
                          clip: {
                            id: 'selected-image',
                            kind: 'image',
                            assetId: setup.assetId,
                            startUs: 0,
                            durationUs: 1000000,
                          },
                        },
                      ],
                    }),
                  },
                },
              ],
            }
          : { content: 'Review the image insertion.' };
      await route.fulfill({
        headers,
        contentType: 'text/event-stream',
        body: sse([
          {
            choices: [
              {
                index: 0,
                delta: message,
                finish_reason: round % 2 === 1 ? 'tool_calls' : 'stop',
              },
            ],
          },
        ]),
      });
    },
  );
  const result = await page.evaluate(async () => {
    const turn = await window.aiAssistant.run('Insert the selected image.')
      .completion;
    const proposal = window.aiAssistant.getProposal(turn.proposalIds[0]!);
    const before = await window.editor.projects.snapshot(window.project.id);
    await window.editor.commands.apply({
      projectId: window.project.id,
      expectedRevision: before.revision,
      requestId: 'concurrent-user',
      operations: [
        { type: 'addTrack', track: { id: 'manual', kind: 'overlay' } },
      ],
    });
    const error = await window.aiAssistant.applyProposal(proposal.id).then(
      () => 'unexpected',
      (error: { code: string }) => error.code,
    );
    const after = await window.editor.projects.snapshot(window.project.id);
    await window.aiAssistant.dispose();
    window.aiProvider.dispose();
    await window.editor.dispose();
    return {
      error,
      revision: after.revision,
      tracks: after.tracks.map((track) => track.id),
      operationCount: proposal.batch.operations.length,
    };
  });
  expect(result).toEqual({
    error: 'REVISION_CONFLICT',
    revision: 1,
    tracks: ['manual'],
    operationCount: 2,
  });
  expect(outgoing.join('')).not.toContain('PRIVATE IMAGE NAME');
});
