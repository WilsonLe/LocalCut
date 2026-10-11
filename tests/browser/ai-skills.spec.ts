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
        }));
      } finally {
        await assistant.dispose();
        await editor.dispose();
      }
    }, base);
    expect(result[0]!.tools).toEqual([
      'load_skill',
      'inspect_project',
      'inspect_proposals',
    ]);
    expect(result[0]!.payload).not.toContain(
      'Transition templates are editable recipes',
    );
    expect(result[1]!.tools).toContain('propose_edits');
    expect(result[1]!.tools).not.toContain('propose_action');
    expect(result[1]!.payload).toContain(
      'Transition templates are editable recipes',
    );
    expect(result[0]!.tools).not.toContain('search_text_library');
    expect(result[1]!.tools).toContain('search_text_library');
    expect(result[2]!.payload).toContain('clip_local_timeline');
    expect(result[2]!.payload).toContain('interpolation');
    expect(result[3]!.payload).toContain('font-space-mono');
    expect(result[5]!.tools).toEqual(result[0]!.tools);
    expect(result[5]!.payload).not.toContain(
      'Transition templates are editable recipes',
    );
    expect(requested).toContain(skillFiles[0]);
    for (const path of skillFiles.slice(1))
      expect(requested).not.toContain(path);
    expect(result.map((request) => request.payload).join('')).not.toContain(
      'Private project',
    );
  });
}
