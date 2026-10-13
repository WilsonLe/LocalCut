import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

for (const base of ['/', '/LocalCut/']) {
  test(`AI domain guidance loads lazily and tools reset each turn ${base}`, async ({
    page,
  }) => {
    const root = base === '/' ? 'dist-root' : 'dist';
    const manifest = JSON.parse(
      await readFile(`${root}/.vite/manifest.json`, 'utf8'),
    ) as Record<string, { file: string }>;
    const skillFiles = ['editing', 'export', 'transcription', 'history'].map(
      (id) => {
        const entry = manifest[`src/ai/skills/${id}.ts`];
        expect(entry, `Separate dynamic skill module: ${id}`).toBeDefined();
        return base + entry!.file;
      },
    );
    const requested: string[] = [];
    page.on('request', (request) =>
      requested.push(new URL(request.url()).pathname),
    );
    await page.goto(base);
    const result = await page.evaluate(async (path) => {
      const { createEditor } = (await import(
        path + 'editor.js'
      )) as typeof import('../../src/editor');
      const { createAssistant } = (await import(
        path + 'ai.js'
      )) as typeof import('../../src/ai');
      const editor = await createEditor({
        namespace: 'test-skills-' + crypto.randomUUID(),
      });
      const project = await editor.projects.create('Private project');
      const requests: import('../../src/ai').ChatRequest[] = [];
      let round = 0;
      const assistant = createAssistant({
        editor,
        projectId: project.id,
        model: 'test/skills',
        provider: {
          async *stream(request) {
            const instruction = request.messages[0]?.content ?? '';
            if (instruction.startsWith('LocalCut request contract:')) {
              yield {
                type: 'complete' as const,
                message: {
                  role: 'assistant' as const,
                  content: 'Fulfill scripted skill request.',
                },
              };
              return;
            }
            if (instruction.startsWith('LocalCut completion review:')) {
              yield {
                type: 'complete' as const,
                message: {
                  role: 'assistant' as const,
                  content: 'FULFILLED\nScripted scenario receipts',
                },
              };
              return;
            }

            requests.push(structuredClone(request));
            const name = [
              'load_skill',
              'inspect_capabilities',
              'search_text_library',
              'propose_edits',
            ][round++];
            const discoveredFont =
              name === 'propose_edits'
                ? JSON.parse(request.messages.at(-1)!.content!).items[0].id
                : undefined;
            yield {
              type: 'complete' as const,
              message: {
                role: 'assistant' as const,
                content: name ? null : 'Done',
                ...(name
                  ? {
                      tool_calls: [
                        {
                          id: crypto.randomUUID(),
                          type: 'function' as const,
                          function: {
                            name,
                            arguments: JSON.stringify(
                              name === 'load_skill'
                                ? { skillId: 'editing' }
                                : name === 'search_text_library'
                                  ? {
                                      kind: 'fonts',
                                      query: 'Space Mono',
                                      limit: 1,
                                    }
                                  : name === 'propose_edits'
                                    ? {
                                        summary:
                                          'Use discovered font and animate one placement',
                                        operations: [
                                          {
                                            type: 'addTrack',
                                            track: {
                                              id: 'titles',
                                              kind: 'overlay',
                                            },
                                          },
                                          {
                                            type: 'insertClip',
                                            trackId: 'titles',
                                            clip: {
                                              id: 'animated',
                                              kind: 'text',
                                              startUs: 0,
                                              durationUs: 1000000,
                                              text: {
                                                text: 'A title',
                                                fontFamily: discoveredFont,
                                                animation: {
                                                  kind: 'typewriter',
                                                  stepMs: 90,
                                                  loop: false,
                                                },
                                              },
                                              keyframes: {
                                                x: [
                                                  {
                                                    id: 'a',
                                                    timeUs: 0,
                                                    value: 0,
                                                  },
                                                  {
                                                    id: 'b',
                                                    timeUs: 1000000,
                                                    value: 100,
                                                  },
                                                ],
                                              },
                                            },
                                          },
                                          {
                                            type: 'insertClip',
                                            trackId: 'titles',
                                            clip: {
                                              id: 'other',
                                              kind: 'text',
                                              startUs: 1000000,
                                              durationUs: 1000000,
                                              text: {
                                                text: 'A title',
                                                fontFamily: discoveredFont,
                                              },
                                            },
                                          },
                                        ],
                                      }
                                    : {},
                            ),
                          },
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
          'Inspect editing, discover a font and animate a title',
        ).completion;
        const before = await editor.projects.snapshot(project.id);
        if (before.revision !== project.revision)
          throw new Error('Unapproved edit');
        await assistant.approveProposal(turn.proposalIds[0]!);
        const persisted = await editor.projects.open(project.id);
        if (
          persisted.revision !== project.revision + 1 ||
          persisted.tracks[0]?.clips[0]?.text?.fontFamily !==
            'font-space-mono' ||
          persisted.tracks[0]?.clips[0]?.keyframes.x?.length !== 2 ||
          Object.keys(persisted.tracks[0]?.clips[1]?.keyframes ?? {}).length !==
            0
        )
          throw new Error(
            'Approved discovery/animation did not persist independently',
          );
        await assistant.run('Another request').completion;
        return requests.map((request) => ({
          tools: request.tools.map((tool) => tool.function.name),
          payload: JSON.stringify(request),
          currentSkills: JSON.parse(request.messages[1]!.content!).capabilityMap
            .loadedSkills,
          skillLoads: request.messages.filter(
            (message) =>
              message.role === 'tool' &&
              JSON.parse(message.content).skillId === 'editing',
          ),
        }));
      } finally {
        await assistant.dispose();
        await editor.dispose();
      }
    }, base);
    expect(result[0]!.tools).toEqual([
      'load_skill',
      'inspect_project',
      'inspect_capabilities',
      'inspect_proposals',
    ]);
    expect(result[0]!.payload).not.toContain(
      'Transition templates are editable recipes',
    );
    expect(result[1]!.tools).toContain('propose_edits');
    expect(result[1]!.tools).toContain('propose_action');
    expect(result[1]!.payload).toContain('track_mask');
    expect(result[1]!.payload).toContain(
      'Transition templates are editable recipes',
    );
    expect(result[0]!.tools).not.toContain('search_text_library');
    expect(result[1]!.tools).toContain('search_text_library');
    expect(result[2]!.payload).toContain('clip_local_timeline');
    expect(result[2]!.payload).toContain('interpolation');
    expect(result[3]!.payload).toContain('font-space-mono');
    expect(result[5]!.tools).toEqual(result[0]!.tools);
    expect(result[5]!.payload).toContain(
      'Transition templates are editable recipes',
    );
    expect(result[1]!.currentSkills).toEqual(['editing']);
    expect(result[5]!.currentSkills).toEqual([]);
    expect(result[5]!.skillLoads).toEqual(result[1]!.skillLoads);
    expect(requested).toContain(skillFiles[0]);
    for (const path of skillFiles.slice(1))
      expect(requested).not.toContain(path);
    expect(result.map((request) => request.payload).join('')).not.toContain(
      'Private project',
    );
  });
}

for (const base of ['/', '/LocalCut/']) {
  test(`AI capability recovery continues cross-domain work without private transcript access ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const result = await page.evaluate(async (path) => {
      const { createEditor } = (await import(
        path + 'editor.js'
      )) as typeof import('../../src/editor');
      const { createAssistant } = (await import(
        path + 'ai.js'
      )) as typeof import('../../src/ai');
      const editor = await createEditor({
        namespace: 'test-recovery-' + crypto.randomUUID(),
      });
      const project = await editor.projects.create('PRIVATE ROOT PROJECT');
      const requests: import('../../src/ai').ChatRequest[] = [];
      const invoke = (name: string, args: unknown, id = name) => ({
        id,
        type: 'function' as const,
        function: { name, arguments: JSON.stringify(args) },
      });
      const fonts = () =>
        invoke('search_text_library', {
          kind: 'fonts',
          query: 'Space Mono',
          limit: 1,
        });
      let step = 0;
      const assistant = createAssistant({
        editor,
        projectId: project.id,
        model: 'test/recovery',
        provider: {
          async *stream(request) {
            const instruction = request.messages[0]?.content ?? '';
            if (instruction.startsWith('LocalCut request contract:')) {
              yield {
                type: 'complete' as const,
                message: {
                  role: 'assistant' as const,
                  content: 'Fulfill scripted skill request.',
                },
              };
              return;
            }
            if (instruction.startsWith('LocalCut completion review:')) {
              yield {
                type: 'complete' as const,
                message: {
                  role: 'assistant' as const,
                  content: 'FULFILLED\nScripted scenario receipts',
                },
              };
              return;
            }

            requests.push(structuredClone(request));
            const scope = JSON.parse(request.messages[1]!.content!);
            let calls: import('../../src/ai').ToolCall[] | undefined;
            switch (step++) {
              case 0:
                if (
                  scope.capabilityMap.tools.search_text_library.supported !==
                    true ||
                  scope.capabilityMap.actions.export.supported !== true ||
                  scope.capabilityMap.actions.index_asset.supported !== false
                )
                  throw new Error(
                    'Initial complete capability map missing or dishonest',
                  );
                calls = [invoke('load_skill', { skillId: 'history' })];
                break;
              case 1:
                calls = [fonts()];
                break;
              case 2: {
                const failure = JSON.parse(
                  request.messages.at(-1)!.content!,
                ).error;
                if (
                  failure.code !== 'TOOL_NOT_ALLOWED' ||
                  failure.details.recovery.requiredSkills[0] !== 'editing'
                )
                  throw new Error(
                    'Wrong-domain failure has no usable recovery',
                  );
                calls = [
                  invoke('load_skill', {
                    skillId: failure.details.recovery.requiredSkills[0],
                  }),
                ];
                break;
              }
              case 3:
                calls = [
                  invoke('load_skill', { skillId: 'transcription' }, 'speech'),
                  invoke('load_skill', { skillId: 'storyboard' }, 'drawing'),
                ];
                break;
              case 4:
                if (
                  scope.capabilityMap.tools.read_transcript.available ||
                  !scope.capabilityMap.tools.propose_edits.available ||
                  !scope.capabilityMap.tools.inspect_storyboard.available ||
                  !scope.capabilityMap.tools.inspect_transcription.available
                )
                  throw new Error(
                    'A blocked private read incorrectly blocks other domains',
                  );
                calls = [
                  invoke(
                    'read_transcript',
                    { transcriptId: 'unshared-transcript' },
                    'blocked-transcript',
                  ),
                  invoke('inspect_transcription', {}, 'readiness'),
                  invoke(
                    'inspect_storyboard',
                    { offset: 0, limit: 10 },
                    'drawing-read',
                  ),
                  fonts(),
                ];
                break;
              case 5: {
                const replies = request.messages.filter(
                  (message) => message.role === 'tool',
                );
                const blocked = JSON.parse(
                  replies.find(
                    (reply) => reply.tool_call_id === 'blocked-transcript',
                  )!.content!,
                );
                if (
                  blocked.error.details.recovery.blockers[0].reason !==
                  'sharing_disabled'
                )
                  throw new Error(
                    'Private read failed without a specific sharing blocker',
                  );
                if (
                  JSON.parse(
                    replies.find((reply) => reply.tool_call_id === 'readiness')!
                      .content!,
                  ).preparationRequiresApproval !== true ||
                  JSON.parse(
                    replies.find(
                      (reply) => reply.tool_call_id === 'drawing-read',
                    )!.content!,
                  ).error
                )
                  throw new Error('Readiness or Storyboard inspection failed');
                const font = JSON.parse(request.messages.at(-1)!.content!)
                  .items[0].id;
                calls = [
                  invoke('propose_edits', {
                    summary:
                      'Create the requested title using the discovered font',
                    operations: [
                      {
                        type: 'addTrack',
                        track: { id: 'titles', kind: 'overlay' },
                      },
                      {
                        type: 'insertClip',
                        trackId: 'titles',
                        clip: {
                          id: 'title',
                          kind: 'text',
                          startUs: 0,
                          durationUs: 1000000,
                          text: {
                            text: 'User supplied title',
                            fontFamily: font,
                          },
                        },
                      },
                    ],
                  }),
                ];
                break;
              }
              case 7:
                if (
                  scope.capabilityMap.loadedSkills.length ||
                  scope.capabilityMap.tools.search_text_library.available
                )
                  throw new Error(
                    'Earlier domain loads authorized the next turn',
                  );
                calls = [fonts()];
                break;
              case 8: {
                const error = JSON.parse(
                  request.messages.at(-1)!.content!,
                ).error;
                if (
                  error.details.recovery.blockers[0].reason !==
                  'skill_not_loaded'
                )
                  throw new Error('Fresh-turn recovery is missing');
                calls = [invoke('load_skill', { skillId: 'editing' }), fonts()];
                break;
              }
              case 9:
                if (
                  JSON.parse(request.messages.at(-1)!.content!).error?.code !==
                  'TOOL_NOT_ALLOWED'
                )
                  throw new Error(
                    'Sibling load broadened frozen round authority',
                  );
                calls = [fonts()];
                break;
            }
            yield {
              type: 'complete' as const,
              message: {
                role: 'assistant' as const,
                content: calls
                  ? null
                  : 'Supported work is ready; transcript sharing remains off.',
                ...(calls ? { tool_calls: calls } : {}),
              },
            };
          },
        },
      });
      try {
        const first = await assistant.run(
          'Find a font, inspect speech readiness and Storyboard, and add my title; also read my transcript',
        ).completion;
        const before = await editor.projects.snapshot(project.id);
        if (first.proposalIds.length !== 1 || before.revision !== 0)
          throw new Error(
            'Discovery executed work or failed to propose the supported portion',
          );
        await assistant.approveProposal(first.proposalIds[0]!);
        const saved = await editor.projects.open(project.id);
        const second = await assistant.run('Continue with the same font')
          .completion;
        return {
          revision: saved.revision,
          font: saved.tracks[0]?.clips[0]?.text?.fontFamily,
          secondProposals: second.proposalIds,
          requests: requests.length,
          privateLeak: JSON.stringify(requests).includes(
            'PRIVATE ROOT PROJECT',
          ),
          proposed: first.proposalIds.length,
        };
      } finally {
        await assistant.dispose();
        await editor.dispose();
      }
    }, base);
    expect(result).toEqual({
      revision: 1,
      font: 'font-space-mono',
      secondProposals: [],
      requests: 11,
      privateLeak: false,
      proposed: 1,
    });
  });
}
