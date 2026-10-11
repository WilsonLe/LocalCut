import { expect, test } from '@playwright/test';

for (const base of ['/', '/LocalCut/']) {
  test(`asset rename metadata preserves originals and notifies shared projects ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const result = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const namespace = 'test-' + crypto.randomUUID();
      const editor = await createEditor({ namespace });
      const peer = await createEditor({ namespace });
      try {
        const canvas = new OffscreenCanvas(32, 32);
        canvas.getContext('2d')!.fillRect(0, 0, 32, 32);
        const file = new File([await canvas.convertToBlob()], 'original.png', {
          type: 'image/png',
        });
        const asset = await editor.assets.import(file).completion;
        const projects = await Promise.all(
          ['one', 'two'].map((name) => editor.projects.create(name)),
        );
        for (const project of projects)
          await editor.commands.apply({
            projectId: project.id,
            expectedRevision: 0,
            requestId: crypto.randomUUID(),
            operations: [
              {
                type: 'addTrack',
                track: { id: crypto.randomUUID(), kind: 'video' },
              },
            ],
          });
        for (const project of projects) {
          const snapshot = await editor.projects.snapshot(project.id);
          await editor.commands.apply({
            projectId: project.id,
            expectedRevision: 1,
            requestId: crypto.randomUUID(),
            operations: [
              {
                type: 'insertClip',
                trackId: snapshot.tracks[0]!.id,
                clip: {
                  id: crypto.randomUUID(),
                  kind: 'image',
                  assetId: asset.id,
                  startUs: 0,
                  durationUs: 1000000,
                },
              },
            ],
          });
        }
        const seen: string[] = [];
        const notified = new Promise<void>((resolve) => {
          peer.events.projects((event) => {
            if (event.type === 'changed' && event.revision === 2) {
              seen.push(event.projectId);
              if (seen.length === 2) resolve();
            }
          });
        });
        const renamed = await editor.assets.rename(
          asset.id,
          '  Display name  ',
          asset.name,
        );
        await notified;
        const errors: string[] = [];
        for (const [name, expectedName] of [
          ['Stale name', asset.name],
          ['   ', renamed.name],
        ]) {
          try {
            await peer.assets.rename(asset.id, name!, expectedName!);
          } catch (error) {
            errors.push((error as { code: string }).code);
          }
        }
        const frames = await peer.assets.thumbnails(asset.id, [0], 32)
          .completion;
        return {
          name: (await peer.assets.inspect(asset.id)).name,
          errors,
          revisions: await Promise.all(
            projects.map(
              async (project) =>
                (await peer.projects.snapshot(project.id)).revision,
            ),
          ),
          seen: [...new Set(seen)].length,
          frameSize: frames[0]!.blob.size,
        };
      } finally {
        await peer.dispose();
        await editor.dispose();
      }
    }, base);
    expect(result).toMatchObject({
      name: 'Display name',
      errors: ['REVISION_CONFLICT', 'INVALID_COMMAND'],
      revisions: [2, 2],
      seen: 2,
    });
    expect(result.frameSize).toBeGreaterThan(0);
  });
}
