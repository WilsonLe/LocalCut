import { expect, test } from '@playwright/test';

/** This suite intentionally fails when not configured; it never skips as a passing live check. */
test('real OpenRouter tool proposal, local apply and undo', async ({
  page,
}) => {
  const enabled = process.env.LOCALCUT_OPENROUTER_LIVE === '1';
  const key = process.env.OPENROUTER_API_KEY;
  const model = process.env.LOCALCUT_OPENROUTER_MODEL;
  if (!enabled || !key || !model)
    throw new Error(
      'Live AI check requires LOCALCUT_OPENROUTER_LIVE=1, a private OPENROUTER_API_KEY, and an explicit LOCALCUT_OPENROUTER_MODEL. No request was sent.',
    );
  // Trace, screenshot and video are disabled in this suite. Never attach request/response bodies.
  await page.goto('/LocalCut/');
  const result = await page.evaluate(
    async ({ key, model }) => {
      const { createEditor } = (await import(
        String('/LocalCut/editor.js')
      )) as typeof import('../../src/editor');
      const { createOpenRouter, createAssistant } = (await import(
        String('/LocalCut/ai.js')
      )) as typeof import('../../src/ai');
      const editor = await createEditor({
        namespace: 'test-ai-live-' + crypto.randomUUID(),
      });
      const provider = createOpenRouter();
      provider.setKey(key);
      const project = await editor.projects.create('Synthetic AI test');
      const assistant = createAssistant({
        editor,
        provider,
        projectId: project.id,
        model,
        limits: {
          maxRounds: 3,
          maxToolCalls: 4,
          maxOutputTokens: 800,
          maxOperations: 2,
        },
      });
      try {
        const models = await provider.listModels();
        const supported = models.some(
          (entry) => entry.id === model && entry.supportsTools,
        );
        if (!supported)
          throw new Error('Selected model does not advertise tools.');
        const response = await assistant.run(
          'Call propose_edits to add exactly one empty overlay track with id live-title. Do not add any other object.',
        ).completion;
        const proposal = assistant.getProposal(response.proposalIds[0]!);
        if (
          proposal.batch.operations.length !== 1 ||
          proposal.batch.operations[0]?.type !== 'addTrack'
        )
          throw new Error(
            'Model did not propose the requested bounded synthetic edit.',
          );
        const before = await editor.projects.snapshot(project.id);
        const receipt = await assistant.applyProposal(proposal.id);
        const after = await editor.projects.snapshot(project.id);
        await editor.commands.undo(
          project.id,
          crypto.randomUUID(),
          after.revision,
        );
        const undone = await editor.projects.snapshot(project.id);
        return {
          supported,
          before: before.tracks.length,
          after: after.tracks.length,
          undone: undone.tracks.length,
          revision: receipt.appliedRevision,
          totalTokens: response.usage.totalTokens,
        };
      } finally {
        await assistant.dispose();
        provider.dispose();
        await editor.projects.delete(project.id);
        await editor.dispose();
      }
    },
    { key, model },
  );
  expect(result).toMatchObject({
    supported: true,
    before: 0,
    after: 1,
    undone: 0,
    revision: 1,
  });
  expect(result.totalTokens).toBeGreaterThan(0);
});
