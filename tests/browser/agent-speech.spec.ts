import {
  openAISettings,
  prepareOpenRouterKey,
} from './workspace-settings-helper';
import { fulfillChatTitle } from './chat-title-fixture';
import { expect, test } from '@playwright/test';
import { behaviorBases } from './coverage-bases';
import { installGoalReviewFixture } from './goal-review-fixture';

for (const base of behaviorBases) {
  test(`agent narration generates, mixes and persists measured speech without changing the cut ${base}`, async ({
    page,
  }) => {
    await installGoalReviewFixture(page);
    await page.goto(base);
    const result = await page.evaluate(async (path) => {
      const { createEditor } = (await import(
        path + 'editor.js'
      )) as typeof import('../../src/editor');
      const api = (await import(
        path + 'ai.js'
      )) as typeof import('../../src/ai');
      const namespace = 'agent-speech-' + crypto.randomUUID();
      const editor = await createEditor({ namespace });
      const project = await editor.projects.create('Sydney narration');
      const pcm = Float32Array.from(
        { length: 48000 },
        (_, i) => 0.12 * Math.sin((i * Math.PI * 2 * 220) / 24000),
      );
      const musicFile = await api.renderSpeech(
        { samples: pcm, sampleRate: 24000 },
        { mode: 'speed', speed: 1 },
        new AbortController().signal,
      );
      const music = await editor.assets.import(musicFile.file).completion;
      await editor.library.forProject(project.id).place(music.id, []);
      await editor.commands.apply({
        projectId: project.id,
        expectedRevision: 0,
        requestId: crypto.randomUUID(),
        operations: [
          { type: 'addTrack', track: { id: 'titles', kind: 'overlay' } },
          {
            type: 'insertClip',
            trackId: 'titles',
            clip: {
              id: 'title',
              kind: 'text',
              startUs: 0,
              durationUs: 60000000,
              text: { text: 'Sydney trip' },
            },
          },
          { type: 'addTrack', track: { id: 'music', kind: 'audio' } },
          {
            type: 'insertClip',
            trackId: 'music',
            clip: {
              id: 'score',
              kind: 'audio',
              assetId: music.id,
              startUs: 0,
              durationUs: 60000000,
              sourceOutUs: music.durationUs,
              loop: { offsetUs: 0 },
              gain: 0.5,
            },
          },
        ],
      });
      const before = await editor.projects.snapshot(project.id);
      let submissions = 0,
        measurements = 0;
      const connection = {
        api,
        speechRoute: 'openrouter-tts',
        transcriptionRoute: 'openrouter-stt',
        provider: {
          selectedProvider: () => 'openrouter',
          transcriptionDisclosure:
            'Configured OpenRouter STT for generated audio.',
          listSpeechModels: async () => [
            {
              id: 'google/gemini-2.5-flash-preview-tts',
              name: 'Synthetic test voice',
              voices: ['Kore'],
            },
          ],
          synthesizeSpeech: async () => {
            submissions++;
            return { samples: pcm, sampleRate: 24000 as const };
          },
          transcribe: async (
            _audio: Float32Array,
            context: { assetId: string },
          ) => {
            measurements++;
            return {
              id: crypto.randomUUID(),
              assetId: context.assetId,
              model: 'test/stt',
              revision: 'fixture',
              cues: [
                {
                  id: 'phrase',
                  timeUs: 100000,
                  endUs: 1900000,
                  text: 'Sydney, five days.',
                },
              ],
            };
          },
        },
      };
      const speech = api.createAssistantSpeech(editor, connection, {
        model: 'google/gemini-2.5-flash-preview-tts',
        voice: 'Kore',
      });
      let round = 0,
        assetId = '',
        transcriptId = '';
      const requests: import('../../src/ai').ChatRequest[] = [];
      const assistant = api.createAssistant({
        editor,
        speech,
        projectId: project.id,
        model: 'test/chat',
        execution: 'requested',
        context: {
          includeText: true,
          includeAssetNames: true,
          includeTranscripts: true,
        },
        provider: {
          async *stream(request) {
            const review = await window.localcutGoalReviewReply(request);
            if (review) {
              yield { type: 'complete' as const, message: review };
              return;
            }
            requests.push(request);
            let name: string | undefined,
              args: object = {};
            switch (round++) {
              case 0:
                name = 'load_skill';
                args = { skillId: 'speech' };
                break;
              case 1:
                name = 'inspect_speech';
                break;
              case 2:
                name = 'propose_action';
                args = {
                  summary: 'Create narration',
                  action: {
                    type: 'generate_speech',
                    options: {
                      script: 'Sydney, five days.',
                      languages: ['English'],
                    },
                  },
                };
                break;
              case 3: {
                const receipt = JSON.parse(
                  request.messages.at(-1)!.content!,
                ).result;
                assetId = receipt.assetId;
                transcriptId = receipt.transcriptId;
                name = 'load_skill';
                args = { skillId: 'editing' };
                break;
              }
              case 4:
                name = 'inspect_asset';
                args = { assetId };
                break;
              case 5:
                name = 'load_skill';
                args = { skillId: 'transcription' };
                break;
              case 6:
                name = 'read_transcript';
                args = { transcriptId };
                break;
              case 7:
                name = 'propose_edits';
                args = {
                  summary: 'Place and mix measured narration',
                  operations: [
                    {
                      type: 'addTrack',
                      track: {
                        id: 'narration',
                        kind: 'audio',
                        name: 'Narration',
                      },
                    },
                    {
                      type: 'insertClip',
                      trackId: 'narration',
                      clip: {
                        id: 'voice',
                        kind: 'audio',
                        assetId,
                        transcriptId,
                        startUs: 1000000,
                        durationUs: 2000000,
                        sourceOutUs: 2000000,
                        gain: 0.8,
                        fadeInUs: 50000,
                        fadeOutUs: 50000,
                      },
                    },
                    {
                      type: 'updateClip',
                      clipId: 'score',
                      patch: {
                        keyframes: {
                          gain: [
                            {
                              id: 'duck-start',
                              timeUs: 700000,
                              value: 0.5,
                              interpolation: 'linear',
                            },
                            {
                              id: 'duck-down',
                              timeUs: 1000000,
                              value: 0.2,
                              interpolation: 'hold',
                            },
                            {
                              id: 'duck-up',
                              timeUs: 3000000,
                              value: 0.2,
                              interpolation: 'linear',
                            },
                            {
                              id: 'duck-end',
                              timeUs: 3300000,
                              value: 0.5,
                              interpolation: 'hold',
                            },
                          ],
                        },
                      },
                    },
                  ],
                };
                break;
              case 8:
                name = 'inspect_project';
                break;
            }
            yield {
              type: 'complete' as const,
              message: {
                role: 'assistant' as const,
                content: name ? null : 'Narration saved and mixed.',
                ...(name
                  ? {
                      tool_calls: [
                        {
                          id: crypto.randomUUID(),
                          type: 'function' as const,
                          function: { name, arguments: JSON.stringify(args) },
                        },
                      ],
                    }
                  : {}),
              },
            };
          },
        },
      });
      try {
        const turn = await assistant.run(
          'Add narration to the existing 60-second cut, preserve the title and score, and duck the score under the voice.',
        ).completion;
        const snapshot = await editor.projects.snapshot(project.id);
        const asset = await editor.assets.inspect(assetId);
        const waveform = await editor.assets.waveform(assetId, 32).completion;
        const transcript = await editor.transcription.transcript(transcriptId);
        const task = (await editor.tasks.list()).find(
          (t) => t.label === 'Generating narration',
        );
        await assistant.dispose();
        await editor.dispose();
        const restored = await createEditor({ namespace });
        try {
          return {
            submissions,
            measurements,
            beforeTitle: before.tracks[0],
            title: snapshot.tracks[0],
            asset,
            peak: Math.max(...waveform),
            transcript,
            taskState: task?.state,
            proposals: turn.proposalIds.length,
            current: snapshot,
            restored: await restored.projects.snapshot(project.id),
            restoredTranscript:
              await restored.transcription.transcript(transcriptId),
            bytesLeaked: JSON.stringify(requests).includes('"samples":'),
          };
        } finally {
          await restored.dispose();
        }
      } finally {
        await assistant.dispose();
        await editor.dispose();
      }
    }, base);
    expect(result.submissions).toBe(1);
    expect(result.measurements).toBe(1);
    expect(result.taskState).toBe('completed');
    expect(result.proposals).toBe(2);
    expect(result.asset).toMatchObject({
      kind: 'audio',
      status: 'ready',
      durationUs: 2000000,
      sampleRate: 24000,
      channels: 1,
    });
    expect(result.peak).toBeGreaterThan(0.05);
    expect(result.title).toEqual(result.beforeTitle);
    expect(result.restored).toEqual(result.current);
    expect(result.restoredTranscript).toEqual(result.transcript);
    expect(result.transcript?.speech).toMatchObject({
      script: 'Sydney, five days.',
      voice: 'Kore',
      measuredCues: [{ timeUs: 100000, endUs: 1900000 }],
    });
    const clips = result.current.tracks.flatMap((t) => t.clips);
    expect(Math.max(...clips.map((c) => c.startUs + c.durationUs))).toBe(
      60000000,
    );
    expect(clips.find((c) => c.id === 'score')?.keyframes.gain).toHaveLength(4);
    expect(result.bytesLeaked).toBe(false);
  });
  test(`agent narration reuses saved synthesis after timing failure and cancels publication ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const result = await page.evaluate(async (path) => {
      const { createEditor } = (await import(
        path + 'editor.js'
      )) as typeof import('../../src/editor');
      const api = (await import(
        path + 'ai.js'
      )) as typeof import('../../src/ai');
      const editor = await createEditor({
        namespace: 'speech-recovery-' + crypto.randomUUID(),
      });
      const project = await editor.projects.create('Recover narration');
      let submissions = 0,
        attempts = 0;
      const pcm = Float32Array.from(
        { length: 24000 },
        (_, i) => 0.1 * Math.sin((i * Math.PI * 2 * 200) / 24000),
      );
      const connection = {
        api,
        speechRoute: 'test/tts',
        transcriptionRoute: 'test/stt',
        provider: {
          selectedProvider: () => 'openrouter',
          transcriptionDisclosure: 'Remote phrase timing.',
          listSpeechModels: async () => [
            {
              id: 'google/gemini-2.5-flash-preview-tts',
              name: 'Test',
              voices: ['Kore'],
            },
          ],
          synthesizeSpeech: async () => {
            submissions++;
            return { samples: pcm, sampleRate: 24000 as const };
          },
          transcribe: async (
            _audio: Float32Array,
            context: { assetId: string },
          ) => {
            if (++attempts === 1)
              throw new api.AiError('INVALID_RESPONSE', 'No measured timing.');
            return {
              id: crypto.randomUUID(),
              assetId: context.assetId,
              model: 'test',
              revision: 'fixture',
              cues: [
                { id: 'cue', timeUs: 0, endUs: 1000000, text: 'Hello Sydney.' },
              ],
            };
          },
        },
      };
      const speech = api.createAssistantSpeech(editor, connection);
      const options = { script: 'Hello Sydney.', languages: ['English'] };
      let failed: { code?: string; details?: { generationId?: string } } = {};
      try {
        await speech.generate(project.id, options).completion;
      } catch (error) {
        failed = error as typeof failed;
      }
      const checkpoint = (await editor.tasks.checkpoint(
        failed.details?.generationId ?? '',
      )) as { samples?: Float32Array };
      const savedAudio = checkpoint?.samples?.length;
      const generated = await speech.generate(project.id, {
        ...options,
        generationId: failed.details?.generationId,
      }).completion;
      const reused = await speech.generate(project.id, {
        ...options,
        generationId: generated.generationId,
      }).completion;
      const offline = api.createAssistantSpeech(editor, {
        ...connection,
        provider: {
          ...connection.provider,
          listSpeechModels: async () => {
            throw new api.AiError('NETWORK_ERROR', 'Catalog offline');
          },
        },
      });
      const offlineReceipt = await offline.generate(project.id, {
        ...options,
        generationId: generated.generationId,
      }).completion;
      const offlineReused = offlineReceipt.assetId === generated.assetId;
      const sameAsset = reused.assetId === generated.assetId;
      const wrongProject = await editor.projects.create('Other project');
      let foreignRejected = false;
      try {
        await speech.generate(wrongProject.id, {
          ...options,
          generationId: generated.generationId,
        }).completion;
      } catch {
        foreignRejected = true;
      }
      let announced!: () => void;
      const started = new Promise<void>((resolve) => {
        announced = resolve;
      });
      const pendingConnection = {
        ...connection,
        speechRoute: 'cancel/tts',
        provider: {
          ...connection.provider,
          synthesizeSpeech: async (
            _request: import('../../src/ai').SpeechRequest,
            signal: AbortSignal,
          ) => {
            announced();
            return await new Promise<import('../../src/ai').SpeechAudio>(
              (_resolve, reject) => {
                signal.addEventListener(
                  'abort',
                  () => reject(new api.AiError('CANCELLED', 'Stopped.')),
                  { once: true },
                );
              },
            );
          },
        },
      };
      const pending = api
        .createAssistantSpeech(editor, pendingConnection)
        .generate(project.id, options);
      await started;
      pending.cancel();
      let cancelled = false;
      try {
        await pending.completion;
      } catch (error) {
        cancelled = (error as { code: string }).code === 'CANCELLED';
      }
      const mediaCount = (
        await editor.library.forProject(project.id).list()
      ).entries.filter((e) => e.kind === 'asset').length;
      const local = api.createAssistantSpeech(editor, {
        ...connection,
        provider: {
          ...connection.provider,
          transcriptionDisclosure: 'Transcription runs locally.',
        },
      });
      const readiness = await local.inspect(new AbortController().signal);
      let localRejected = false;
      if (!readiness.timingReady) {
        try {
          await local.generate(project.id, options).completion;
        } catch (e) {
          localRejected = (e as { code: string }).code === 'MODEL_REQUIRED';
        }
      }
      const submissionsBeforeCommitRecovery = submissions;
      let committedAssetId = '';
      const importOwner = editor.assets.import;
      const publicationEditor = new Proxy(editor, {
        get(target, property) {
          if (property !== 'assets') return Reflect.get(target, property);
          return {
            ...target.assets,
            import: (...args: Parameters<typeof importOwner>) => {
              const imported = importOwner(...args);
              return {
                ...imported,
                completion: imported.completion.then((asset) => {
                  committedAssetId = asset.id;
                  late.cancel();
                  return asset;
                }),
              };
            },
          };
        },
      });
      const late: import('../../src/services/jobs').Job<
        import('../../src/ai').GeneratedSpeech
      > = api
        .createAssistantSpeech(publicationEditor, connection)
        .generate(project.id, options);
      let lateGenerationId = '';
      try {
        await late.completion;
      } catch (error) {
        const failed = error as {
          code: string;
          details: { generationId: string };
        };
        if (failed.code !== 'CANCELLED') throw error;
        lateGenerationId = failed.details.generationId;
      }
      const committedReceipt = (await editor.tasks.checkpoint(
        lateGenerationId,
      )) as {
        imported: { assetId: string };
      };
      const recoveredCommit = await speech.generate(project.id, {
        ...options,
        generationId: lateGenerationId,
      }).completion;
      const publicationRecovery = {
        committedAssetId,
        checkpointAssetId: committedReceipt.imported.assetId,
        recoveredAssetId: recoveredCommit.assetId,
        submissions: submissions - submissionsBeforeCommitRecovery,
        mediaCount: (
          await editor.library.forProject(project.id).list()
        ).entries.filter((e) => e.kind === 'asset').length,
        waveform: await editor.assets.waveform(recoveredCommit.assetId),
      };
      await editor.dispose();
      return {
        submissions,
        attempts,
        savedAudio,
        failedCode: failed.code,
        generated,
        foreignRejected,
        sameAsset,
        offlineReused,
        cancelled,
        mediaCount,
        localReady: readiness.timingReady,
        localRejected,
        publicationRecovery,
      };
    }, base);
    expect(result.submissions).toBe(2);
    expect(result.attempts).toBe(3);
    expect(result.savedAudio).toBe(24000);
    expect(result.failedCode).toBe('INVALID_RESPONSE');
    expect(result.generated).toMatchObject({
      durationUs: 1000000,
      sampleRate: 24000,
      channels: 1,
    });
    expect(result.foreignRejected).toBe(true);
    expect(result.sameAsset).toBe(true);
    expect(result.offlineReused).toBe(true);
    expect(result.cancelled).toBe(true);
    expect(result.mediaCount).toBe(1);
    expect(result.publicationRecovery.committedAssetId).toBeTruthy();
    expect(result.publicationRecovery.checkpointAssetId).toBe(
      result.publicationRecovery.committedAssetId,
    );
    expect(result.publicationRecovery.recoveredAssetId).toBe(
      result.publicationRecovery.committedAssetId,
    );
    expect(result.publicationRecovery.submissions).toBe(1);
    expect(result.publicationRecovery.mediaCount).toBe(2);
    expect(result.publicationRecovery.waveform).toBeTruthy();
    if (!result.localReady) expect(result.localRejected).toBe(true);
  });
  test(`workspace chat generates narration through configured speech and saves it across reload ${base}`, async ({
    page,
    context,
  }, info) => {
    const tts = 'google/gemini-3.8-flash-tts';
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    };
    await page.addInitScript(
      ({ tts }) =>
        localStorage.setItem(
          'localcut.workspace-preferences.v1',
          JSON.stringify({
            version: 1,
            preferences: {
              aiModel: 'test/narration',
              aiProviders: JSON.stringify({
                profiles: [
                  { id: 'openrouter', name: 'OpenRouter', kind: 'openrouter' },
                ],
                routes: {
                  llm: [{ providerId: 'openrouter', model: 'test/narration' }],
                  tts: [
                    { providerId: 'openrouter', model: tts, voice: 'Puck' },
                  ],
                  stt: [
                    {
                      providerId: 'openrouter',
                      model: 'openai/whisper-large-v3',
                    },
                  ],
                },
              }),
            },
          }),
        ),
      { tts },
    );
    await context.route('https://openrouter.ai/api/v1/models**', (route) =>
      route.fulfill({
        headers: cors,
        json: {
          data: [
            {
              id: 'test/narration',
              name: 'Narration chat',
              context_length: 512000,
              supported_parameters: ['tools', 'tool_choice'],
            },
            {
              id: tts,
              name: 'Narration voice',
              architecture: { output_modalities: ['speech'] },
              supported_voices: ['Kore', 'Puck'],
            },
            {
              id: 'openai/whisper-large-v3',
              name: 'Phrase timing',
              architecture: { output_modalities: ['transcription'] },
            },
          ],
        },
      }),
    );
    let submissions = 0,
      reuse = false;
    const bytes = Buffer.alloc(48000 * 2);
    for (let i = 0; i < 48000; i++)
      bytes.writeInt16LE(
        Math.round(4000 * Math.sin((i * Math.PI * 2 * 220) / 24000)),
        i * 2,
      );
    await context.route(
      'https://openrouter.ai/api/v1/audio/speech',
      (route) => {
        if (route.request().method() === 'OPTIONS')
          return route.fulfill({ headers: cors, body: '' });
        submissions++;
        expect(route.request().postDataJSON()).toMatchObject({
          model: tts,
          voice: 'Puck',
          input: reuse ? 'A second Sydney memory.' : 'Hello Sydney.',
        });
        return route.fulfill({
          headers: cors,
          contentType: 'audio/pcm',
          body: bytes,
        });
      },
    );
    await context.route(
      'https://openrouter.ai/api/v1/audio/transcriptions',
      (route) =>
        route.fulfill({
          headers: cors,
          json: { segments: [{ text: 'Hello Sydney.', start: 0.1, end: 1.9 }] },
        }),
    );
    let step = 0,
      assetId = '',
      transcriptId = '',
      voicePresetId = '';
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ headers: cors, body: '' });
          return;
        }
        const request = route.request().postDataJSON();
        let completionDecision = false;
        try {
          completionDecision = !!JSON.parse(
            request.messages[1]?.content ?? '{}',
          ).completionDecision;
        } catch {
          // Naming requests can contain ordinary prose rather than app context.
        }
        if (completionDecision) {
          await route.fulfill({
            headers: cors,
            contentType: 'text/event-stream',
            body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: reuse ? 'Saved voice reused with new narration.' : 'Narration generated and placed.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
          });
          return;
        }
        if (await fulfillChatTitle(route, 'Sydney narration')) return;
        let name: string | undefined,
          args: object = {};
        switch (step++) {
          case 0:
            expect(
              JSON.parse(request.messages[1].content).capabilityMap.actions
                .generate_speech.supported,
            ).toBe(true);
            name = 'load_skill';
            args = { skillId: 'speech' };
            break;
          case 1:
            name = 'inspect_speech';
            break;
          case 2:
            if (reuse)
              expect(
                JSON.parse(request.messages.at(-1).content).savedVoices,
              ).toContainEqual(
                expect.objectContaining({
                  id: voicePresetId,
                  name: 'Sydney narrator',
                  voice: 'Puck',
                  referenceAvailable: true,
                }),
              );
            name = 'propose_action';
            args = {
              summary: 'Generate narration',
              action: {
                type: 'generate_speech',
                options: {
                  script: reuse ? 'A second Sydney memory.' : 'Hello Sydney.',
                  ...(reuse
                    ? { voicePresetId }
                    : {
                        languages: ['English'],
                        saveVoiceName: 'Sydney narrator',
                      }),
                },
              },
            };
            break;
          case 3: {
            const generated = JSON.parse(
              request.messages.at(-1).content,
            ).result;
            if (reuse) expect(generated.voicePresetId).toBe(voicePresetId);
            else voicePresetId = generated.voicePresetId;
            assetId = generated.assetId;
            transcriptId = generated.transcriptId;
            name = 'load_skill';
            args = { skillId: 'editing' };
            break;
          }
          case 4:
            name = 'propose_edits';
            args = {
              summary: 'Place narration',
              operations: [
                ...(!reuse
                  ? [
                      {
                        type: 'addTrack' as const,
                        track: {
                          id: 'narration',
                          kind: 'audio',
                          name: 'Narration',
                        },
                      },
                    ]
                  : []),
                {
                  type: 'insertClip',
                  trackId: 'narration',
                  clip: {
                    id: reuse ? 'voice-2' : 'voice',
                    kind: 'audio',
                    assetId,
                    transcriptId,
                    startUs: reuse ? 2000000 : 0,
                    durationUs: 2000000,
                    sourceOutUs: 2000000,
                  },
                },
              ],
            };
            break;
        }
        const delta = name
          ? {
              tool_calls: [
                {
                  index: 0,
                  id: 'narration-' + step,
                  type: 'function',
                  function: { name, arguments: JSON.stringify(args) },
                },
              ],
            }
          : {
              content: 'Narration saved; reviewing the result.',
            };
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: name ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
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
    await page.getByLabel('Project name').fill('Narration access');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Add text', exact: true }),
    ).toBeEnabled();
    await openAISettings(page);
    await prepareOpenRouterKey(page);
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await dialog
      .getByLabel('OpenRouter API key')
      .fill('synthetic-narration-key');
    await dialog
      .getByRole('button', { name: 'Use API key', exact: true })
      .click();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    const composer = page.getByRole('textbox', {
      name: 'Describe your edit',
      exact: true,
    });
    await composer.fill(
      'Generate a short narration and add it to the timeline.',
    );
    await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .click();
    await expect(
      page.getByText('Narration generated and placed.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Cancel response', exact: true }),
    ).toBeHidden();
    expect(submissions).toBe(1);
    await page.screenshot({
      path: info.outputPath('agent-narration-chat.png'),
    });
    await page.reload();
    await expect(
      page.getByText('Narration generated and placed.', { exact: true }),
    ).toBeVisible();
    reuse = true;
    step = 0;
    await page
      .getByRole('textbox', { name: 'Describe your edit', exact: true })
      .fill('Reuse Sydney narrator for a new script and append the narration.');
    await page
      .getByRole('button', { name: 'Send edit request', exact: true })
      .click();
    await expect(
      page.getByText('Saved voice reused with new narration.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Cancel response', exact: true }),
    ).toBeHidden();
    const saved = await page.evaluate(async (path) => {
      const { createEditor } = (await import(
        path + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const project = await editor.projects.snapshot(
          location.hash.split('/project/')[1]!.split('/')[0]!,
        );
        const clip = project.tracks
          .find((t) => t.id === 'narration')!
          .clips.find((c) => c.id === 'voice-2')!;
        return {
          clip,
          voices: JSON.parse(
            localStorage.getItem('localcut.voice-presets.v1') ?? '{}',
          ).presets,
          clipCount: project.tracks.find((t) => t.id === 'narration')!.clips
            .length,
          transcript: await editor.transcription.transcript(clip.transcriptId!),
        };
      } finally {
        await editor.dispose();
      }
    }, base);
    expect(saved.clip).toMatchObject({
      kind: 'audio',
      assetId,
      transcriptId,
      durationUs: 2000000,
    });
    expect(saved.transcript?.speech).toMatchObject({
      script: 'A second Sydney memory.',
      voice: 'Puck',
      model: tts,
    });
    expect(submissions).toBe(2);
    expect(saved.clipCount).toBe(2);
    expect(saved.voices).toEqual([
      expect.objectContaining({
        id: voicePresetId,
        name: 'Sydney narrator',
        voice: 'Puck',
        model: tts,
        languages: ['English'],
        timing: { mode: 'speed', speed: 1 },
        referenceId: expect.any(String),
        source: expect.objectContaining({
          generationId: expect.any(String),
          assetId: expect.any(String),
        }),
      }),
    ]);
  });
  test(`agent saved voices reuse generated references with new scripts and reject missing or archived profiles ${base}`, async ({
    page,
  }) => {
    await installGoalReviewFixture(page);
    await page.goto(base);
    const result = await page.evaluate(async (path) => {
      const { createEditor } = (await import(
        path + 'editor.js'
      )) as typeof import('../../src/editor');
      const api = (await import(
        path + 'ai.js'
      )) as typeof import('../../src/ai');
      const editor = await createEditor({
        namespace: 'voice-reuse-' + crypto.randomUUID(),
      });
      const project = await editor.projects.create('Original voice');
      const pcm = Float32Array.from(
        { length: 24000 },
        (_, i) => 0.1 * Math.sin((i * Math.PI * 2 * 300) / 24000),
      );
      const requests: import('../../src/ai').SpeechRequest[] = [];
      let lastScript = '';
      const connection = {
        api,
        speechRoute: 'voices/tts',
        transcriptionRoute: 'voices/stt',
        provider: {
          selectedProvider: () => 'openrouter',
          transcriptionDisclosure: 'Remote phrase timing.',
          listSpeechModels: async () => [
            {
              id: 'google/gemini-3.8-flash-tts',
              name: 'Standard',
              voices: ['Kore'],
            },
            {
              id: 'fish-audio/s2.1-pro',
              name: 'Reference',
              voices: ['reference'],
              referenceVoice: true,
            },
          ],
          synthesizeSpeech: async (
            request: import('../../src/ai').SpeechRequest,
          ) => {
            requests.push(request);
            lastScript = request.script;
            return { samples: pcm, sampleRate: 24000 as const };
          },
          transcribe: async (
            _audio: Float32Array,
            context: { assetId: string },
          ) => ({
            id: crypto.randomUUID(),
            assetId: context.assetId,
            model: 'test',
            revision: 'fixture',
            cues: [
              { id: 'words', timeUs: 0, endUs: 1000000, text: lastScript },
            ],
          }),
        },
      };
      const speech = api.createAssistantSpeech(editor, connection);
      try {
        const first = await speech.generate(project.id, {
          script: 'First generation.',
          languages: ['English'],
          instructions: 'Warm and calm',
          saveVoiceName: 'Saved narrator',
        }).completion;
        const secondProject = await editor.projects.create('Another cut');
        const second = await speech.generate(secondProject.id, {
          script: 'New words, same voice.',
          voicePresetId: first.voicePresetId,
          reuseMode: 'reference',
        }).completion;
        const state = await speech.inspect(new AbortController().signal);
        const original = state.savedVoices!.find(
          (v) => v.id === first.voicePresetId,
        )!;
        const referenceRequest = requests[1]!;
        const wavHeader = atob(referenceRequest.reference!.data).slice(0, 12);
        let wrongModel = false;
        try {
          await speech.generate(project.id, {
            script: 'Do not submit.',
            voicePresetId: first.voicePresetId,
            reuseMode: 'reference',
            model: 'google/gemini-3.8-flash-tts',
          }).completion;
        } catch (e) {
          wrongModel = (e as { code: string }).code === 'INVALID_REQUEST';
        }
        const record = JSON.parse(
          localStorage.getItem('localcut.voice-presets.v1')!,
        );
        const profile = record.presets.find(
          (v: { id: string }) => v.id === first.voicePresetId,
        );
        const version = original.version;
        profile.name = 'Renamed narrator';
        localStorage.setItem(
          'localcut.voice-presets.v1',
          JSON.stringify(record),
        );
        const renamedVersion = (
          await speech.inspect(new AbortController().signal)
        ).savedVoices!.find((v) => v.id === first.voicePresetId)!.version;
        profile.instructions = 'Different delivery';
        localStorage.setItem(
          'localcut.voice-presets.v1',
          JSON.stringify(record),
        );
        let staleRejected = false;
        try {
          await speech.generate(project.id, {
            script: 'Do not submit.',
            voicePresetId: first.voicePresetId,
            voiceVersion: version,
          }).completion;
        } catch (e) {
          staleRejected = (e as { code: string }).code === 'REVISION_CONFLICT';
        }
        profile.archived = true;
        localStorage.setItem(
          'localcut.voice-presets.v1',
          JSON.stringify(record),
        );
        let archived = false,
          missing = false;
        try {
          await speech.generate(project.id, {
            script: 'Do not submit.',
            voicePresetId: first.voicePresetId,
          }).completion;
        } catch (e) {
          archived = (e as { code: string }).code === 'INVALID_REQUEST';
        }
        try {
          await speech.generate(project.id, {
            script: 'Do not submit.',
            voicePresetId: 'unknown-profile',
          }).completion;
        } catch (e) {
          missing = (e as { code: string }).code === 'INVALID_REQUEST';
        }
        const recording = await api.renderSpeech(
          { samples: pcm, sampleRate: 24000 },
          { mode: 'speed', speed: 1 },
          new AbortController().signal,
        );
        const captured = await api.saveDictationVoice(
          editor,
          project.id,
          crypto.randomUUID(),
          recording.file,
          'My recorded words.',
          'en-AU',
          new AbortController().signal,
        );
        const discovered = (
          await speech.inspect(new AbortController().signal)
        ).savedVoices!.find((p) => p.id === captured.voicePresetId)!;
        let settingsCloneRejected = false;
        try {
          await speech.generate(project.id, {
            script: 'Not a cloning request.',
            voicePresetId: captured.voicePresetId,
            reuseMode: 'settings',
          }).completion;
        } catch (e) {
          settingsCloneRejected =
            (e as { code: string }).code === 'INVALID_REQUEST';
        }
        let cloneRound = 0;
        let agentDiscoveredRecording = false;
        const cloning = api.createAssistant({
          editor,
          speech,
          projectId: project.id,
          model: 'test/clone',
          execution: 'requested',
          context: {
            includeText: true,
            includeAssetNames: true,
            includeTranscripts: true,
          },
          provider: {
            async *stream(request) {
              const review = await window.localcutGoalReviewReply(request);
              if (review) {
                yield { type: 'complete' as const, message: review };
                return;
              }
              let name: string | undefined,
                args: object = {};
              switch (cloneRound++) {
                case 0:
                  name = 'load_skill';
                  args = { skillId: 'speech' };
                  break;
                case 1:
                  name = 'inspect_speech';
                  break;
                case 2: {
                  const state = JSON.parse(request.messages.at(-1)!.content!);
                  const recorded = state.savedVoices.find(
                    (p: { source?: { kind?: string } }) =>
                      p.source?.kind === 'dictation',
                  );
                  agentDiscoveredRecording =
                    !!recorded.referenceAvailable && !!recorded.source.assetId;
                  name = 'propose_action';
                  args = {
                    summary: 'Clone my recorded voice',
                    action: {
                      type: 'generate_speech',
                      options: {
                        script: 'New words in my voice.',
                        voicePresetId: recorded.id,
                        reuseMode: 'reference',
                      },
                    },
                  };
                  break;
                }
              }
              yield {
                type: 'complete' as const,
                message: {
                  role: 'assistant' as const,
                  content: name
                    ? null
                    : 'Your recorded voice was cloned into Media.',
                  ...(name
                    ? {
                        tool_calls: [
                          {
                            id: crypto.randomUUID(),
                            type: 'function' as const,
                            function: { name, arguments: JSON.stringify(args) },
                          },
                        ],
                      }
                    : {}),
                },
              };
            },
          },
        });
        try {
          await cloning.run(
            'Clone my voice from the saved dictation recording, saying: New words in my voice.',
          ).completion;
        } finally {
          cloning.dispose();
        }
        const microphoneRequest = requests[2]!;
        return {
          captured,
          agentDiscoveredRecording,
          discovered,
          settingsCloneRejected,
          microphoneReference: {
            model: microphoneRequest.model,
            script: microphoneRequest.script,
            transcript: microphoneRequest.reference!.transcript,
            header: atob(microphoneRequest.reference!.data).slice(0, 12),
          },
          first,
          second,
          original,
          count: requests.length,
          referenceModel: referenceRequest.model,
          referenceVoice: referenceRequest.voice,
          referenceTranscript: referenceRequest.reference!.transcript,
          newScript: referenceRequest.script,
          wavHeader,
          wrongModel,
          staleRejected,
          renamedVersion,
          version,
          archived,
          missing,
          metadataContainsScript: JSON.stringify(record.presets).includes(
            'First generation.',
          ),
          originalMediaCount: (
            await editor.library.forProject(project.id).list()
          ).entries.filter((e) => e.kind === 'asset').length,
          secondMediaCount: (
            await editor.library.forProject(secondProject.id).list()
          ).entries.filter((e) => e.kind === 'asset').length,
        };
      } finally {
        await editor.dispose();
      }
    }, base);
    expect(result.first.referenceSaved).toBe(true);
    expect(result.first.voicePresetId).toBeTruthy();
    expect(result.referenceModel).toBe('fish-audio/s2.1-pro');
    expect(result.referenceVoice).toBe('reference');
    expect(result.referenceTranscript).toBe('First generation.');
    expect(result.newScript).toBe('New words, same voice.');
    expect(result.wavHeader).toMatch(/^RIFF.{4}WAVE$/s);
    expect(result.count).toBe(3);
    expect(result.discovered.source?.kind).toBe('dictation');
    expect(result.agentDiscoveredRecording).toBe(true);
    expect(result.settingsCloneRejected).toBe(true);
    expect(result.microphoneReference).toMatchObject({
      model: 'fish-audio/s2.1-pro',
      script: 'New words in my voice.',
      transcript: 'My recorded words.',
    });
    expect(result.microphoneReference.header).toMatch(/^RIFF.{4}WAVE$/s);
    expect(result.wrongModel).toBe(true);
    expect(result.staleRejected).toBe(true);
    expect(result.renamedVersion).toBe(result.version);
    expect(result.archived).toBe(true);
    expect(result.missing).toBe(true);
    expect(result.original).toMatchObject({
      name: 'Saved narrator',
      model: 'google/gemini-3.8-flash-tts',
      voice: 'Kore',
      instructions: 'Warm and calm',
      languages: ['English'],
      source: {
        projectId: result.first.projectId,
        assetId: result.first.assetId,
        transcriptId: result.first.transcriptId,
        generationId: result.first.generationId,
      },
    });
    expect(result.metadataContainsScript).toBe(false);
    expect(result.originalMediaCount).toBe(3);
    expect(result.secondMediaCount).toBe(1);
  });
}
