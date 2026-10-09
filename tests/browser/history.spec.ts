import { test, expect } from '@playwright/test';
test('request conflicts, bounded history, backup validation and structured storage errors', async ({
  page,
}) => {
  await page.goto('/LocalCut/');
  const result = await page.evaluate(async () => {
    const { createEditor } = (await import(
        String('/LocalCut/editor.js')
      )) as typeof import('../../src/editor/index'),
      editor = await createEditor({ namespace: 'test-' + crypto.randomUUID() }),
      p = await editor.projects.create('history', { width: 256, height: 144 });
    const assemble = {
      projectId: p.id,
      requestId: 'first',
      expectedRevision: 0,
      operations: [
        {
          type: 'addTrack' as const,
          track: { id: 't', kind: 'overlay' as const },
        },
        {
          type: 'insertClip' as const,
          trackId: 't',
          clip: {
            id: 'c',
            kind: 'text' as const,
            startUs: 0,
            durationUs: 1000000,
            text: { text: 'Original' },
          },
        },
      ],
    };
    await editor.commands.apply(assemble);
    const conflict = await editor.commands
      .apply({
        ...assemble,
        operations: [{ type: 'removeTrack', trackId: 't' }],
      })
      .then(
        () => '',
        (e: { code: string }) => e.code,
      );
    const validation = await editor.commands
      .validate({
        projectId: p.id,
        requestId: 'missing',
        expectedRevision: 1,
        operations: [
          {
            type: 'insertClip',
            trackId: 't',
            clip: {
              id: 'bad',
              kind: 'image',
              assetId: 'missing',
              startUs: 0,
              durationUs: 1000,
            },
          },
        ],
      })
      .then(
        () => '',
        (e: { code: string }) => e.code,
      );
    for (let i = 0; i < 101; i++)
      await editor.commands.apply({
        projectId: p.id,
        requestId: 'step-' + i,
        expectedRevision: 1 + i,
        operations: [
          {
            type: 'updateClip',
            clipId: 'c',
            patch: { opacity: i % 2 ? 0.5 : 1 },
          },
        ],
      });
    let revision = 102;
    for (let i = 0; i < 100; i++) {
      await editor.commands.undo(p.id, 'undo-' + i, revision);
      revision++;
    }
    const exhausted = await editor.commands
        .undo(p.id, 'exhausted', revision)
        .then(
          () => '',
          (e: { code: string }) => e.code,
        ),
      replay = await editor.commands.apply(assemble),
      current = await editor.projects.snapshot(p.id),
      backup = await editor.projects.exportJSON(p.id),
      copy = await editor.projects.importJSON(backup);
    const invalid = await editor.projects
      .importJSON(backup.replace('"schemaVersion": 1', '"schemaVersion": 2'))
      .then(
        () => '',
        (e: { code: string }) => e.code,
      );
    const after = await editor.projects.snapshot(p.id);
    await editor.dispose();
    return {
      conflict,
      validation,
      exhausted,
      replayRevision: replay.appliedRevision,
      currentRevision: current.revision,
      copyRevision: copy.revision,
      differentId: copy.id !== p.id,
      invalid,
      afterRevision: after.revision,
    };
  });
  expect(result).toEqual({
    conflict: 'REQUEST_CONFLICT',
    validation: 'MISSING_ASSET',
    exhausted: 'INVALID_COMMAND',
    replayRevision: 1,
    currentRevision: 202,
    copyRevision: 0,
    differentId: true,
    invalid: 'INVALID_DOCUMENT',
    afterRevision: 202,
  });
});
