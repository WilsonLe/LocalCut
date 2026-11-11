import { test, expect } from '@playwright/test';
import { behaviorBases } from './coverage-bases';

for (const base of behaviorBases) {
  test(`asset context and transcript survive concurrent edits, reload, backup and relink ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const result = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const namespace = 'test-' + crypto.randomUUID();
      let editor = await createEditor({ namespace });
      const peer = await createEditor({ namespace });
      const notes = {
        context: 'Useful opening\nKeep this frame.',
        transcript: 'Xin chào.\n<script>reference text</script>',
      };
      try {
        const canvas = new OffscreenCanvas(32, 32);
        canvas.getContext('2d')!.fillRect(0, 0, 32, 32);
        const file = new File([await canvas.convertToBlob()], 'original.png', {
          type: 'image/png',
        });
        const asset = await editor.assets.import(file).completion;
        const project = await editor.projects.create('Asset notes');
        await editor.library.forProject(project.id).place(asset.id, []);
        const races = await Promise.allSettled([
          editor.assets.updateNotes(asset.id, notes, 0),
          peer.assets.updateNotes(asset.id, notes, 0),
        ]);
        const raceResults = races
          .map((result) =>
            result.status === 'fulfilled'
              ? 'saved'
              : (result.reason as { code: string }).code,
          )
          .sort();
        // Ensure a peer event even when the peer happened to win the race.
        const received = new Promise<string>((resolve) => {
          const stop = peer.events.assets((id) => {
            stop();
            resolve(id);
          });
        });
        const saved = await editor.assets.updateNotes(asset.id, notes, 1);
        const eventAssetId = await received;
        const untouchedProjectRevision = (
          await editor.projects.snapshot(project.id)
        ).revision;
        const namespaceRoot = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle(namespace);
        const original = await (
          await namespaceRoot.getFileHandle(asset.id)
        ).getFile();
        const originalUnchanged =
          new Uint8Array(await original.arrayBuffer()).join(',') ===
          new Uint8Array(await file.arrayBuffer()).join(',');
        await editor.dispose();
        editor = await createEditor({ namespace });
        const afterReopen = await editor.assets.inspect(asset.id);
        await editor.commands.apply({
          projectId: project.id,
          expectedRevision: 0,
          requestId: 'place',
          operations: [
            {
              type: 'addTrack',
              track: {
                id: 'v',
                kind: 'video',
                clips: [
                  {
                    id: 'image',
                    kind: 'image',
                    assetId: asset.id,
                    startUs: 0,
                    durationUs: 1_000_000,
                  },
                ],
              },
            },
          ],
        });
        const json = await editor.projects.exportJSON(project.id);
        const restored = await editor.projects.importJSON(json);
        const restoredId = restored.tracks[0]!.clips[0]!.assetId!;
        const beforeRelink = await editor.assets.inspect(restoredId);
        const relinked = await editor.assets.relink(restoredId, file)
          .completion;
        const cleared = await editor.assets.updateNotes(
          asset.id,
          { context: '', transcript: '' },
          2,
        );
        let stale = '';
        try {
          await peer.assets.updateNotes(asset.id, notes, 2);
        } catch (error) {
          stale = (error as { code: string }).code;
        }
        return {
          raceResults,
          notified: eventAssetId === asset.id,
          originalUnchanged,
          untouchedProjectRevision,
          saved: saved.notes,
          afterReopen: afterReopen.notes,
          restored: beforeRelink.notes,
          relinked: relinked.notes,
          restoredMissing: beforeRelink.status,
          cleared: cleared.notes,
          stale,
          finalProjectRevision: (await editor.projects.snapshot(project.id))
            .revision,
        };
      } finally {
        await peer.dispose();
        await editor.dispose();
      }
    }, base);
    const expected = {
      revision: 2,
      context: 'Useful opening\nKeep this frame.',
      transcript: 'Xin chào.\n<script>reference text</script>',
    };
    expect(result).toEqual({
      raceResults: ['REVISION_CONFLICT', 'saved'],
      notified: true,
      originalUnchanged: true,
      untouchedProjectRevision: 0,
      saved: expected,
      afterReopen: expected,
      restored: expected,
      relinked: expected,
      restoredMissing: 'missing',
      cleared: { revision: 3, context: '', transcript: '' },
      stale: 'REVISION_CONFLICT',
      finalProjectRevision: 1,
    });
  });
}
