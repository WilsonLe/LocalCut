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

test('command transcript links validate source ownership and roll back all persisted state', async ({
  page,
}) => {
  await page.goto('/LocalCut/');
  const result = await page.evaluate(async () => {
    const { createEditor } = (await import(
      String('/LocalCut/editor.js')
    )) as typeof import('../../src/editor/index');
    const namespace = 'test-' + crypto.randomUUID();
    const editor = await createEditor({ namespace });
    const project = await editor.projects.create('transcript ownership');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`${namespace}-v1`);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = <T>(request: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const persisted = async () => {
      const tx = db.transaction(['projects', 'receipts'], 'readonly');
      const [state, receipts] = await Promise.all([
        read(tx.objectStore('projects').get(project.id)),
        read(tx.objectStore('receipts').getAll()),
      ]);
      return JSON.stringify({ state, receipts });
    };
    try {
      const seed = db.transaction(['assets', 'transcripts'], 'readwrite');
      const asset = {
        name: 'synthetic.wav',
        kind: 'audio',
        size: 100,
        type: 'audio/wav',
        durationUs: 1000000,
        width: 0,
        height: 0,
        rotation: 0,
        audioCodec: 'pcm-s16',
        sampleRate: 48000,
        channels: 2,
        status: 'ready',
      };
      for (const id of ['source', 'other-source'])
        seed.objectStore('assets').put({ ...asset, id });
      for (const [id, assetId] of [
        ['matching', 'source'],
        ['foreign', 'other-source'],
      ])
        seed.objectStore('transcripts').put({
          id,
          assetId,
          model: 'test-fixture',
          revision: 'fixture-v1',
          cues: [
            {
              id: 'cue-' + id,
              timeUs: 0,
              endUs: 500000,
              text: 'Synthetic transcript',
            },
          ],
        });
      await new Promise<void>((resolve, reject) => {
        seed.oncomplete = () => resolve();
        seed.onerror = () => reject(seed.error);
        seed.onabort = () => reject(seed.error);
      });
      await editor.commands.apply({
        projectId: project.id,
        requestId: 'baseline',
        expectedRevision: 0,
        operations: [
          { type: 'addTrack', track: { id: 'audio', kind: 'audio' } },
          {
            type: 'insertClip',
            trackId: 'audio',
            clip: {
              id: 'clip',
              kind: 'audio',
              assetId: 'source',
              startUs: 0,
              durationUs: 1000000,
              sourceOutUs: 1000000,
            },
          },
        ],
      });
      const baseline = await persisted();
      const failures = [];
      for (const transcriptId of ['missing', 'foreign']) {
        const batch = {
          projectId: project.id,
          requestId: transcriptId,
          expectedRevision: 1,
          operations: [
            {
              type: 'updateClip' as const,
              clipId: 'clip',
              patch: { gain: 0.25 },
            },
            {
              type: 'updateClip' as const,
              clipId: 'clip',
              patch: { transcriptId },
            },
          ],
        };
        const validation = await editor.commands.validate(batch).then(
          () => 'unexpected-success',
          (error: { code: string }) => error.code,
        );
        const afterValidation = await persisted();
        const application = await editor.commands.apply(batch).then(
          () => 'unexpected-success',
          (error: { code: string }) => error.code,
        );
        failures.push({
          transcriptId,
          validation,
          application,
          validationUnchanged: afterValidation === baseline,
          applicationUnchanged: (await persisted()) === baseline,
        });
      }
      // A rejected request must not reserve its ID or leave a history step.
      const accepted = await editor.commands.apply({
        projectId: project.id,
        requestId: 'missing',
        expectedRevision: 1,
        operations: [
          {
            type: 'updateClip',
            clipId: 'clip',
            patch: { gain: 0.25, transcriptId: 'matching' },
          },
        ],
      });
      const linked = await editor.projects.snapshot(project.id);
      await editor.commands.undo(project.id, 'undo-link', 2);
      const undone = await editor.projects.snapshot(project.id);
      await editor.commands.redo(project.id, 'redo-link', 3);
      const redone = await editor.projects.snapshot(project.id);
      return {
        failures,
        acceptedRevision: accepted.appliedRevision,
        linked: {
          revision: linked.revision,
          gain: linked.tracks[0]!.clips[0]!.gain,
          transcriptId: linked.tracks[0]!.clips[0]!.transcriptId,
        },
        undone: {
          revision: undone.revision,
          gain: undone.tracks[0]!.clips[0]!.gain,
          transcriptId: undone.tracks[0]!.clips[0]!.transcriptId ?? null,
        },
        redone: {
          revision: redone.revision,
          gain: redone.tracks[0]!.clips[0]!.gain,
          transcriptId: redone.tracks[0]!.clips[0]!.transcriptId,
        },
      };
    } finally {
      db.close();
      await editor.dispose();
    }
  });
  expect(result).toEqual({
    failures: ['missing', 'foreign'].map((transcriptId) => ({
      transcriptId,
      validation: 'INVALID_COMMAND',
      application: 'INVALID_COMMAND',
      validationUnchanged: true,
      applicationUnchanged: true,
    })),
    acceptedRevision: 2,
    linked: { revision: 2, gain: 0.25, transcriptId: 'matching' },
    undone: { revision: 3, gain: 1, transcriptId: null },
    redone: { revision: 4, gain: 0.25, transcriptId: 'matching' },
  });
});
