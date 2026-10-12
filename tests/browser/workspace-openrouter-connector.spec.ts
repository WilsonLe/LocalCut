import { embedExif, captureFixture } from '../capture-metadata-fixture';
import { fulfillChatTitle } from './chat-title-fixture';
import { expect, test } from '@playwright/test';
import {
  addOpenRouter,
  prepareOpenRouterKey,
  openAISettings,
  selectAISettingsTab,
} from './workspace-settings-helper';
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
for (const base of ['/', '/LocalCut/']) {
  test(`provider empty state reveals OpenRouter key or login choices on desktop and phone ${base}`, async ({
    page,
    context,
  }, info) => {
    let requests = 0;
    await context.route('https://openrouter.ai/**', (route) => {
      requests++;
      return route.abort();
    });
    await page.goto(base);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await openAISettings(page);
      const dialog = page.getByRole('dialog', {
        name: 'AI connection',
        exact: true,
      });
      await expect(
        dialog.getByText('No AI providers added', { exact: true }),
      ).toBeVisible();
      await expect(dialog.getByText('OpenRouter', { exact: true })).toHaveCount(
        0,
      );
      await expect(
        dialog.getByLabel('OpenRouter API key', { exact: true }),
      ).toHaveCount(0);
      await page.screenshot({
        path: info.outputPath(`providers-empty-${width}.png`),
      });
      await addOpenRouter(page);
      await expect
        .poll(() =>
          dialog.evaluate((el) => el.contains(document.activeElement)),
        )
        .toBe(true);
      await page.keyboard.press('Tab');
      await expect
        .poll(() =>
          dialog.evaluate((el) => el.contains(document.activeElement)),
        )
        .toBe(true);
      await expect(
        dialog.getByText('Do you already have an API key?', { exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByRole('button', {
          name: 'Log in and generate a key',
          exact: true,
        }),
      ).toBeVisible();
      const terms = dialog.getByRole('region', {
        name: 'OpenRouter connection terms',
      });
      await expect(terms).toContainText('By connecting OpenRouter, you agree');
      for (const disclosure of [
        'project and media names',
        'storyboard text (including frame names)',
        'source transcript text',
        'capture dates and GPS',
        'fallback routes',
        'including after reload',
        'do not start chat or indexing requests',
      ])
        await expect(terms).toContainText(disclosure);
      await expect(
        terms.getByRole('link', { name: 'OpenRouter Terms of Service' }),
      ).toHaveAttribute('href', 'https://openrouter.ai/terms');
      await expect(
        terms.getByRole('link', { name: 'Privacy Policy' }),
      ).toHaveAttribute('href', 'https://openrouter.ai/privacy');
      await expect(
        dialog.getByRole('button', { name: 'Data & analytics' }),
      ).toHaveCount(0);
      await terms.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.screenshot({
        path: info.outputPath(`openrouter-terms-${width}.png`),
      });
      const choice = dialog.getByRole('button', {
        name: 'I have an API key',
        exact: true,
      });
      const input = dialog.getByLabel('OpenRouter API key', { exact: true });
      await expect(input).toHaveCount(0);
      await page.screenshot({
        path: info.outputPath(`openrouter-choice-${width}.png`),
      });
      await choice.focus();
      await choice.press('Enter');
      await expect(input).toBeFocused();
      await input.fill('synthetic-draft');
      await dialog.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(input).toHaveCount(0);
      await expect(choice).toBeFocused();
      await choice.click();
      await expect(input).toHaveValue('');
      await expect
        .poll(() => dialog.evaluate((el) => el.scrollWidth <= el.clientWidth))
        .toBe(true);
      await selectAISettingsTab(page, 'Providers');
      await dialog
        .getByRole('button', { name: 'Disconnect OpenRouter', exact: true })
        .click();
      await expect(
        dialog.getByText('No AI providers added', { exact: true }),
      ).toBeVisible();
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
      await page.reload();
    }
    expect(requests).toBe(0);
  });
  test(`OpenRouter connection shares all context after reload and migrates legacy chats ${base}`, async ({
    page,
    context,
  }) => {
    let round = 0;
    const requests: string[] = [];
    let assetId = '',
      transcriptId = '';
    await context.route('https://openrouter.ai/api/v1/**', async (route) => {
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({ headers: cors, body: '' });
      if (new URL(route.request().url()).pathname.endsWith('/models'))
        return route.fulfill({
          headers: cors,
          json: {
            data: [
              {
                id: 'test/context',
                name: 'Context model',
                context_length: 512000,
                supported_parameters: ['tools', 'tool_choice'],
              },
            ],
          },
        });
      if (await fulfillChatTitle(route)) return;
      const body = route.request().postDataJSON();
      requests.push(JSON.stringify(body));
      const calls = [
        [
          { name: 'inspect_project', args: {} },
          { name: 'load_skill', args: { skillId: 'storyboard' } },
          { name: 'load_skill', args: { skillId: 'transcription' } },
        ],
        [
          { name: 'inspect_asset', args: { assetId } },
          { name: 'inspect_storyboard', args: {} },
          { name: 'read_transcript', args: { transcriptId } },
        ],
      ][round++ % 3];
      const delta = calls
        ? {
            tool_calls: calls.map((call, index) => ({
              index,
              id: `context-${round}-${index}`,
              type: 'function',
              function: {
                name: call.name,
                arguments: JSON.stringify(call.args),
              },
            })),
          }
        : { content: 'All shared context was read.' };
      return route.fulfill({
        headers: cors,
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: calls ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
      });
    });
    await page.goto(base);
    const jpeg = await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(64, 36);
      canvas.getContext('2d')!.fillRect(0, 0, 64, 36);
      return [
        ...new Uint8Array(
          await (
            await canvas.convertToBlob({ type: 'image/jpeg' })
          ).arrayBuffer(),
        ),
      ];
    });
    const fixture = await page.evaluate(
      async ({ base, jpeg }) => {
        const { createEditor } = (await import(
          base + 'editor.js'
        )) as typeof import('../../src/editor');
        const editor = await createEditor();
        try {
          const image = await editor.assets.import(
            new File([new Uint8Array(jpeg)], 'Shared photo name.jpg', {
              type: 'image/jpeg',
            }),
            'Shared photo name.jpg',
          ).completion;
          const wav = new ArrayBuffer(44 + 32000),
            view = new DataView(wav);
          const text = (offset: number, value: string) => {
            for (let i = 0; i < value.length; i++)
              view.setUint8(offset + i, value.charCodeAt(i));
          };
          text(0, 'RIFF');
          view.setUint32(4, 32036, true);
          text(8, 'WAVE');
          text(12, 'fmt ');
          view.setUint32(16, 16, true);
          view.setUint16(20, 1, true);
          view.setUint16(22, 1, true);
          view.setUint32(24, 16000, true);
          view.setUint32(28, 32000, true);
          view.setUint16(32, 2, true);
          view.setUint16(34, 16, true);
          text(36, 'data');
          view.setUint32(40, 32000, true);
          const audio = await editor.assets.import(
            new File([wav], 'Shared audio name.wav', { type: 'audio/wav' }),
            'Shared audio name.wav',
          ).completion;
          const transcript = await editor.transcription.attach(audio.id, {
            model: 'synthetic',
            revision: 'fixture',
            cues: [
              {
                id: 'phrase',
                timeUs: 0,
                endUs: 500000,
                text: 'Shared source transcript phrase',
              },
            ],
          });
          const project = await editor.projects.create('Shared project name');
          await editor.commands.apply({
            projectId: project.id,
            expectedRevision: 0,
            requestId: 'shared-context-fixture',
            operations: [
              { type: 'addTrack', track: { id: 'visual', kind: 'video' } },
              {
                type: 'insertClip',
                trackId: 'visual',
                clip: {
                  id: 'photo',
                  kind: 'image',
                  assetId: image.id,
                  startUs: 0,
                  durationUs: 1000000,
                },
              },
              { type: 'addTrack', track: { id: 'audio', kind: 'audio' } },
              {
                type: 'insertClip',
                trackId: 'audio',
                clip: {
                  id: 'source',
                  kind: 'audio',
                  assetId: audio.id,
                  transcriptId: transcript.id,
                  startUs: 0,
                  durationUs: audio.durationUs,
                  sourceOutUs: audio.durationUs,
                },
              },
              { type: 'addTrack', track: { id: 'titles', kind: 'overlay' } },
              {
                type: 'insertClip',
                trackId: 'titles',
                clip: {
                  id: 'caption',
                  kind: 'text',
                  startUs: 0,
                  durationUs: 1000000,
                  text: { text: 'Shared overlay caption' },
                },
              },
              {
                type: 'upsertStoryboardElements',
                elements: [
                  { id: 'frame', type: 'frame', name: 'Shared frame name' },
                  {
                    id: 'story-text',
                    type: 'text',
                    text: 'Shared storyboard caption',
                    originalText: 'Shared storyboard caption',
                    fontSize: 20,
                    fontFamily: 1,
                    textAlign: 'left',
                    verticalAlign: 'top',
                    containerId: null,
                    autoResize: true,
                    lineHeight: 1.25,
                  },
                ],
              },
            ],
          });
          return {
            projectId: project.id,
            assetId: image.id,
            transcriptId: transcript.id,
            capture: image.capture,
          };
        } finally {
          await editor.dispose();
        }
      },
      { base, jpeg: [...embedExif(new Uint8Array(jpeg), 'image/jpeg')] },
    );
    expect(fixture.capture).toEqual(captureFixture);
    assetId = fixture.assetId;
    transcriptId = fixture.transcriptId;
    await page.goto(`${base}#/project/${fixture.projectId}`);
    await openAISettings(page);
    await prepareOpenRouterKey(page);
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    expect(requests).toHaveLength(0);
    await dialog
      .getByLabel('OpenRouter API key', { exact: true })
      .fill('synthetic-context-key');
    await dialog
      .getByRole('button', { name: 'Use API key', exact: true })
      .click();
    await selectAISettingsTab(page, 'LLM - Chat');
    await dialog
      .getByRole('combobox', { name: 'AI model', exact: true })
      .click();
    await page
      .getByRole('option', {
        name: 'Context model · test/context',
        exact: true,
      })
      .click();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    const composer = page.getByRole('textbox', {
      name: 'Describe your edit',
      exact: true,
    });
    for (const prompt of [
      'Read my project context.',
      'Read the context again after reload.',
    ]) {
      const before = requests.length;
      await composer.fill(prompt);
      await page
        .getByRole('button', { name: 'Send edit request', exact: true })
        .click();
      await expect.poll(() => requests.length).toBe(before + 3);
      await expect(
        page.getByText('All shared context was read.', { exact: true }),
      ).toHaveCount(before / 3 + 1);
      const final = requests[before + 2]!;
      for (const fact of [
        'Shared project name',
        'Shared photo name.jpg',
        'Shared overlay caption',
        'Shared source transcript phrase',
        'Shared storyboard caption',
        'Shared frame name',
        captureFixture.time!.value,
        '-27.5',
        '153.25',
      ])
        expect(final).toContain(fact);
      await page.reload();
      await expect(composer).toBeVisible();
      expect(requests).toHaveLength(before + 3);
    }
    // Seed every prior sharing/indexing variant into the real chat sidecar.
    // The canonical selection wins; other project/model/provider identities stay separate.
    const migration = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('localcut-chats-v1');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const current = await new Promise<
          import('../../src/storage/chats').SavedChatSession[]
        >((resolve, reject) => {
          const tx = db.transaction('sessions');
          const get = tx.objectStore('sessions').getAll();
          tx.oncomplete = () => resolve(get.result);
          tx.onerror = () => reject(tx.error);
        });
        const canonical = current.find(
          (chat) => JSON.parse(chat.scope)[4] === 'openrouter-context-v1',
        )!;
        const prefix = JSON.parse(canonical.scope).slice(0, 4);
        const legacy: string[] = [];
        for (const text of [false, true])
          for (const names of [false, true])
            for (const transcripts of [false, true])
              for (const capture of [[], ['capture-metadata']])
                for (const indexing of [[], [false], [true]])
                  legacy.push(
                    JSON.stringify([
                      ...prefix,
                      text,
                      names,
                      transcripts,
                      ...indexing,
                      ...capture,
                    ]),
                  );
        const excluded = [0, 1, 2, 3].map((index) => {
          const other = [...prefix];
          other[index] = index === 1 || index === 2 ? [] : 'other-identity';
          return JSON.stringify([...other, false, false, false]);
        });
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(['sessions', 'selection'], 'readwrite');
          for (const [i, scope] of [...legacy, ...excluded].entries()) {
            tx.objectStore('sessions').put({
              ...canonical,
              scope,
              id: `legacy-${i}`,
              title: `Legacy chat ${i}`,
              titleLocked: true,
              archived: i === 1,
              content: { ...canonical.content, prompt: `Legacy draft ${i}` },
            });
            tx.objectStore('selection').put(`legacy-${i}`, scope);
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        return { scope: canonical.scope, id: canonical.id, excluded };
      } finally {
        db.close();
      }
    });
    await page.reload();
    await expect(composer).toBeVisible();
    const migrated = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open('localcut-chats-v1');
        request.onsuccess = () => resolve(request.result);
      });
      try {
        return await new Promise<{
          chats: import('../../src/storage/chats').SavedChatSession[];
          selections: unknown[];
        }>((resolve, reject) => {
          const tx = db.transaction(['sessions', 'selection']);
          const chats = tx.objectStore('sessions').getAll(),
            selection = tx.objectStore('selection').getAll();
          tx.oncomplete = () =>
            resolve({ chats: chats.result, selections: selection.result });
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    });
    const restored = migrated.chats.filter(
      (chat) => chat.scope === migration.scope,
    );
    expect(restored).toHaveLength(49);
    for (let i = 0; i < 48; i++)
      expect(restored.find((chat) => chat.id === `legacy-${i}`)).toMatchObject({
        title: `Legacy chat ${i}`,
        titleLocked: true,
        archived: i === 1,
        content: { prompt: `Legacy draft ${i}` },
      });
    expect(
      migrated.chats.filter((chat) => migration.excluded.includes(chat.scope)),
    ).toHaveLength(4);
    expect(migrated.selections).toContain(migration.id);
    expect(migrated.selections).not.toContain('legacy-0');
    expect(requests).toHaveLength(6);
    await openAISettings(page);
    await selectAISettingsTab(page, 'Providers');
    await dialog
      .getByRole('button', { name: 'Disconnect OpenRouter', exact: true })
      .click();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Connect provider', exact: true }),
    ).toBeVisible();
    expect(requests).toHaveLength(6);
  });
  test(`provider empty state clears a removed saved account reconnect draft ${base}`, async ({
    page,
    context,
  }) => {
    let requests = 0;
    await context.route('https://endpoint.example.test/**', (route) => {
      requests++;
      return route.abort();
    });
    await page.goto(base);
    await page.evaluate(() =>
      localStorage.setItem(
        'localcut.workspace-preferences.v1',
        JSON.stringify({
          version: 1,
          preferences: {
            aiProviders: JSON.stringify({
              profiles: [
                {
                  id: 'removed-endpoint',
                  name: 'Saved endpoint',
                  kind: 'compatible',
                  baseUrl: 'https://endpoint.example.test/v1',
                },
              ],
              routes: {
                llm: [{ providerId: 'removed-endpoint', model: 'probe-model' }],
                tts: [],
                stt: [{ providerId: 'local', model: 'whisper' }],
              },
            }),
          },
        }),
      ),
    );
    await page.reload();
    await openAISettings(page);
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    const form = page.getByRole('dialog', {
      name: 'Add provider connection',
      exact: true,
    });
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
      'Saved endpoint',
    );
    await page
      .getByLabel('API key (optional for local servers)', { exact: true })
      .fill('synthetic-stale-key');
    await dialog.getByText('Saved endpoint', { exact: true }).first().click();
    await expect(form).toBeHidden();
    await selectAISettingsTab(page, 'Providers');
    await dialog
      .getByRole('button', { name: 'Disconnect Saved endpoint', exact: true })
      .click();
    await expect(
      dialog.getByText('No AI providers added', { exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Add provider', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Add provider', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('API base URL', { exact: true })).toHaveValue(
      '',
    );
    await expect(
      page.getByLabel('API key (optional for local servers)', { exact: true }),
    ).toHaveValue('');
    await page.keyboard.press('Escape');
    await addOpenRouter(page);
    const config = await page.evaluate(() =>
      JSON.parse(
        JSON.parse(localStorage.getItem('localcut.workspace-preferences.v1')!)
          .preferences.aiProviders,
      ),
    );
    expect(config.profiles).toEqual([
      { id: 'openrouter', name: 'OpenRouter', kind: 'openrouter' },
    ]);
    expect(JSON.stringify(config)).not.toContain('removed-endpoint');
    expect(requests).toBe(0);
  });
  test(`OpenRouter connector removes and re-adds with compact connected management ${base}`, async ({
    page,
    context,
  }, info) => {
    let paid = 0;
    await context.route('https://openrouter.ai/api/v1/**', async (route) => {
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({ headers: cors, body: '' });
      if (route.request().url().endsWith('/models'))
        return route.fulfill({
          headers: cors,
          json: {
            data: [
              {
                id: 'test/model',
                name: 'Test model',
                context_length: 512000,
                supported_parameters: ['tools'],
              },
            ],
          },
        });
      if (
        route
          .request()
          .url()
          .endsWith('/models?output_modalities=transcription')
      )
        return route.fulfill({
          headers: cors,
          json: {
            data: [
              { id: 'openai/whisper-1', name: 'Whisper' },
              { id: 'openai/whisper-large-v3', name: 'Whisper Large V3' },
            ],
          },
        });
      if (
        route.request().method() === 'GET' &&
        new URL(route.request().url()).searchParams.get('output_modalities') ===
          'speech'
      )
        return route.fulfill({
          headers: cors,
          json: {
            data: [
              {
                id: 'google/gemini-3.8-flash-tts',
                name: 'Gemini Flash TTS',
                architecture: { output_modalities: ['speech'] },
                supported_voices: ['Zephyr'],
              },
            ],
          },
        });
      paid++;
      return route.abort();
    });
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    const config = () =>
      page.evaluate(() =>
        JSON.parse(
          JSON.parse(
            localStorage.getItem('localcut.workspace-preferences.v1') ?? '{}',
          ).preferences?.aiProviders ?? 'null',
        ),
      );
    const credential = () =>
      page.evaluate(() =>
        localStorage.getItem('localcut.openrouter-credential.v1'),
      );
    await page.goto(base);
    await openAISettings(page);
    await expect(
      dialog.getByText('No AI providers added', { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Add provider', exact: true }),
    ).toBeVisible();
    expect(await config()).toBeNull();
    await page.reload();
    await openAISettings(page);
    await expect(
      dialog.getByRole('button', {
        name: 'Log in and generate a key',
        exact: true,
      }),
    ).toHaveCount(0);
    await prepareOpenRouterKey(page);
    await dialog
      .getByLabel('OpenRouter API key', { exact: true })
      .fill('synthetic-original');
    await dialog
      .getByRole('button', { name: 'Use API key', exact: true })
      .click();
    await selectAISettingsTab(page, 'LLM - Chat');
    await expect(
      dialog.getByRole('combobox', { name: 'AI model', exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText('Key connected', { exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByText('Replace API key', { exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole('button', { name: 'Reconnect OpenRouter', exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByLabel('OpenRouter API key', { exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByRole('tab', { name: 'STT - Transcription', exact: true })
      .click();
    await dialog
      .getByRole('combobox', { name: 'Add STT provider', exact: true })
      .click();
    await page.getByRole('option', { name: 'OpenRouter', exact: true }).click();
    await selectAISettingsTab(page, 'STT - Transcription');
    await expect(dialog.getByLabel('OpenRouter stt route model')).toContainText(
      'openai/whisper-1',
    );
    await selectAISettingsTab(page, 'STT - Transcription');
    await dialog
      .getByRole('combobox', {
        name: 'OpenRouter stt route model',
        exact: true,
      })
      .click();
    await page
      .getByRole('combobox', { name: 'Search models', exact: true })
      .fill('large');
    await page
      .getByRole('option', {
        name: 'Whisper Large V3 · openai/whisper-large-v3',
        exact: true,
      })
      .click();
    expect((await config()).routes.stt[1].model).toBe(
      'openai/whisper-large-v3',
    );
    await expect(
      dialog.getByText('Remote transcription sends selected audio', {
        exact: false,
      }),
    ).toHaveCount(0);
    await dialog
      .getByRole('button', { name: 'Move OpenRouter up in stt', exact: true })
      .click();
    const original = await config();
    expect(
      original.routes.stt.map((r: { providerId: string }) => r.providerId),
    ).toEqual(['openrouter', 'local']);
    const connections = dialog.getByRole('tab', {
      name: 'Providers',
      exact: true,
    });
    await connections.click();

    await selectAISettingsTab(page, 'Providers');
    await expect(
      dialog.getByRole('button', {
        name: 'Disconnect OpenRouter',
        exact: true,
      }),
    ).toBeVisible();
    await page.reload();
    await openAISettings(page);
    await selectAISettingsTab(page, 'LLM - Chat');
    await expect(
      dialog.getByRole('combobox', { name: 'AI model', exact: true }),
    ).toBeVisible();
    expect(await config()).toEqual(original);
    expect(await credential()).toContain('synthetic-original');
    expect(paid).toBe(0);
    await page.screenshot({ path: info.outputPath('connector-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: info.outputPath('connector-mobile.png') });
    await selectAISettingsTab(page, 'Providers');
    await dialog
      .getByRole('button', { name: 'Disconnect OpenRouter', exact: true })
      .click();
    expect(await credential()).toBeNull();
    // A disconnected account can be forgotten through the same control.
    await selectAISettingsTab(page, 'Providers');
    await dialog
      .getByRole('button', { name: 'Disconnect OpenRouter', exact: true })
      .click();
    expect((await config()).routes.stt).toEqual([
      { providerId: 'local', model: 'whisper' },
    ]);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Workspace settings', exact: true }),
    ).toBeFocused();
  });
}
