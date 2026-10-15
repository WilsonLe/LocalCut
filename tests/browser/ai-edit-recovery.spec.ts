import { test, expect } from '@playwright/test';
import { behaviorBases } from './coverage-bases';

for (const base of behaviorBases) {
  test(`actionable overlap recovery preserves a validated edit through compaction and reload ${base}`, async ({
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
      const namespace = 'test-edit-recovery-' + crypto.randomUUID();
      const editor = await createEditor({ namespace });
      const canvas = new OffscreenCanvas(8, 8);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'red';
      ctx.fillRect(0, 0, 8, 8);
      let assistant: ReturnType<typeof createAssistant> | undefined;
      try {
        const asset = await editor.assets.import(
          new File([await canvas.convertToBlob()], 'red.png', {
            type: 'image/png',
          }),
        ).completion;
        const project = await editor.projects.create('Recovery');
        await editor.commands.apply({
          projectId: project.id,
          expectedRevision: 0,
          requestId: 'seed',
          operations: [
            { type: 'addTrack', track: { id: 'video', kind: 'video' } },
            ...['a', 'b'].map((id, index) => ({
              type: 'insertClip' as const,
              trackId: 'video',
              clip: {
                id,
                kind: 'image' as const,
                assetId: asset.id,
                startUs: index * 2000000,
                durationUs: 2000000,
              },
            })),
          ],
        });
        const transition = {
          type: 'addTransition' as const,
          transition: {
            id: 'cross',
            kind: 'crossfade' as const,
            trackId: 'video',
            fromClipId: 'a',
            toClipId: 'b',
          },
        };
        let stage = 0,
          compactions = 0,
          validationId = '',
          rejected = 0,
          mainOperationBatches = 0;
        const proposedArguments: unknown[] = [];
        assistant = createAssistant({
          editor,
          projectId: project.id,
          model: 'test/recovery',
          execution: 'requested',
          provider: {
            async *stream(request) {
              let content = 'Saved and checked.';
              let calls: import('../../src/ai/types').ToolCall[] | undefined;
              const tool = (name: string, args: unknown, id: string) => ({
                id,
                type: 'function' as const,
                function: { name, arguments: JSON.stringify(args) },
              });
              const instruction = request.messages[0]!.content!;
              if (instruction.startsWith('LocalCut context compaction:')) {
                compactions++;
                if (request.messages[1]!.content!.includes('OPAQUE_SENTINEL'))
                  throw new Error('reasoning leaked to summarizer');
                content =
                  'Correct the transition with ordered positive overlap. Use current preparedEdits; completed receipts must not replay.';
              } else if (instruction.startsWith('LocalCut completion review:'))
                content =
                  'The committed project and receipt confirm the corrected overlap and transition.';
              else {
                const context = JSON.parse(request.messages.at(-1)!.content!);
                if (!context.completionDecision) {
                  const outcome = (id: string) =>
                    JSON.parse(
                      request.messages
                        .filter(
                          (m) => m.role === 'tool' && m.tool_call_id === id,
                        )
                        .at(-1)!.content!,
                    );
                  if (stage++ === 0)
                    calls = [
                      tool('load_skill', { skillId: 'editing' }, 'load'),
                    ];
                  else if (stage === 2) {
                    mainOperationBatches++;
                    calls = [
                      tool(
                        'validate_edits',
                        { operations: [transition] },
                        'bad',
                      ),
                    ];
                  } else if (stage === 3) {
                    const error = outcome('bad').error;
                    if (
                      error.details.validation.rule !== 'transition_overlap' ||
                      error.details.recovery.missingSkills.length
                    )
                      throw new Error('not actionable');
                    rejected++;
                    mainOperationBatches++;
                    calls = [
                      tool(
                        'validate_edits',
                        {
                          operations: [
                            {
                              type: 'updateClip',
                              clipId: 'b',
                              patch: { startUs: 1000000 },
                            },
                            transition,
                          ],
                        },
                        'valid',
                      ),
                    ];
                  } else if (stage === 4) {
                    validationId = outcome('valid').validationId;
                    if (
                      !context.preparedEdits.some(
                        (p: { validationId: string }) =>
                          p.validationId === validationId,
                      )
                    )
                      throw new Error('plan lost during compaction');
                    const args = {
                      summary: 'Create the corrected crossfade',
                      validationId,
                    };
                    proposedArguments.push(args);
                    calls = [tool('propose_edits', args, 'apply')];
                  }
                }
              }
              yield {
                type: 'complete' as const,
                message: {
                  role: 'assistant' as const,
                  content: calls ? null : content,
                  ...(calls ? { tool_calls: calls } : {}),
                  ...(calls?.[0]?.id === 'valid'
                    ? { reasoning: 'OPAQUE_SENTINEL'.repeat(60000) }
                    : {}),
                },
              };
            },
          },
        });
        const response = await assistant.run(
          'Add a crossfade, fixing overlap if required; apply the exact validated batch once.',
        ).completion;
        const saved = await editor.projects.snapshot(project.id);
        return {
          namespace,
          projectId: project.id,
          revision: saved.revision,
          clipStart: saved.tracks[0]!.clips[1]!.startUs,
          transitions: saved.transitions,
          compactions,
          rejected,
          mainOperationBatches,
          proposedArguments,
          text: response.text,
          canonicalReasoning: response.exchange.some(
            (m) =>
              m.role === 'assistant' &&
              m.reasoning?.includes('OPAQUE_SENTINEL'),
          ),
        };
      } finally {
        await assistant?.dispose();
        await editor.dispose();
      }
    }, base);
    expect(result.revision).toBe(2);
    expect(result.clipStart).toBe(1000000);
    expect(result.transitions).toHaveLength(1);
    expect(result.rejected).toBe(1);
    expect(result.mainOperationBatches).toBe(2);
    expect(result.proposedArguments).toEqual([
      {
        summary: 'Create the corrected crossfade',
        validationId: expect.any(String),
      },
    ]);
    expect(result.compactions).toBeGreaterThan(0);
    expect(result.canonicalReasoning).toBe(true);
    await page.reload();
    const restored = await page.evaluate(
      async ({ path, namespace, projectId }) => {
        const { createEditor } = (await import(
          path + 'editor.js'
        )) as typeof import('../../src/editor');
        const editor = await createEditor({ namespace });
        try {
          return await editor.projects.snapshot(projectId);
        } finally {
          await editor.dispose();
        }
      },
      { path: base, namespace: result.namespace, projectId: result.projectId },
    );
    expect(restored.revision).toBe(2);
    expect(restored.transitions).toEqual(result.transitions);
    expect(restored.tracks[0]!.clips[1]!.startUs).toBe(1000000);
  });
}
