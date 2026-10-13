import { installGoalReviewFixture } from './goal-review-fixture';
import { test, expect } from '@playwright/test';

import { dismissNotifications } from './workspace-notifications-helper';

test.beforeEach(async ({ page }) => {
  await installGoalReviewFixture(page);
});

for (const base of ['/', '/LocalCut/']) {
  test(`storyboard images insert through agent and UI with local pixels, history and backups ${base}`, async ({
    page,
  }, testInfo) => {
    const remote: string[] = [];
    page.on('request', (request) => {
      if (
        ['http:', 'https:'].includes(new URL(request.url()).protocol) &&
        new URL(request.url()).hostname !== '127.0.0.1'
      )
        remote.push(request.url());
    });
    await page.goto(base);
    const result = await page.evaluate(async (base) => {
      const { createEditor, readWorkspaceArchive } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const { createAssistant } = (await import(
        base + 'ai.js'
      )) as typeof import('../../src/ai');
      const editor = await createEditor();
      const p = await editor.projects.create('Pictures in storyboard');
      const canvas = new OffscreenCanvas(160, 90);
      canvas.getContext('2d')!.fillStyle = '#ff0000';
      canvas.getContext('2d')!.fillRect(0, 0, 160, 90);
      const png = await canvas.convertToBlob({ type: 'image/png' });
      const original = await editor.assets.import(png, 'Source.png').completion;
      await editor.library.forProject(p.id).place(original.id, [], null);
      let round = 0;
      const requests: string[] = [];
      const assistant = createAssistant({
        editor,
        projectId: p.id,
        assetIds: [original.id],
        model: 'test',
        execution: 'requested',
        provider: {
          async *stream(request) {
            const reviewReply = await window.localcutGoalReviewReply({
              messages: request.messages,
              tools: request.tools,
            });
            if (reviewReply) {
              yield { type: 'complete' as const, message: reviewReply };
              return;
            }
            requests.push(JSON.stringify(request));
            const actions = [
              ['load_skill', { skillId: 'storyboard' }],
              ['inspect_storyboard', {}],
              [
                'propose_action',
                {
                  summary: 'Insert source picture',
                  action: {
                    type: 'insert_storyboard_image',
                    options: {
                      assetId: original.id,
                      elementId: 'agent-image',
                      x: 100,
                      y: 100,
                      width: 320,
                    },
                  },
                },
              ],
            ] as const;
            const action = actions[round++];
            yield {
              type: 'complete',
              message: {
                role: 'assistant',
                content: action ? null : 'Inserted picture.',
                ...(action
                  ? {
                      tool_calls: [
                        {
                          id: crypto.randomUUID(),
                          type: 'function',
                          function: {
                            name: action[0],
                            arguments: JSON.stringify(action[1]),
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
        await assistant.run('Put this image in the whiteboard').completion;
        const first = await editor.projects.snapshot(p.id);
        const imageId = first.storyboard!.elements[0]!.fileId!;
        const stored = await editor.assets.inspect(imageId);
        const pixel = async (file: Blob) => {
          const b = await createImageBitmap(file);
          const c = new OffscreenCanvas(b.width, b.height);
          const ctx = c.getContext('2d')!;
          ctx.drawImage(b, 0, 0);
          b.close();
          return [...ctx.getImageData(c.width / 2, c.height / 2, 1, 1).data];
        };
        const exported = await editor.storyboard.export(
          p.id,
          { format: 'png', elementIds: ['agent-image'], background: false },
          1,
        ).completion;
        const color = await pixel(exported.file);
        const svg = await editor.storyboard.export(p.id, { format: 'svg' }, 1)
          .completion;
        const scene = JSON.parse(
          await (
            await editor.storyboard.export(p.id, { format: 'excalidraw' }, 1)
              .completion
          ).file.text(),
        );
        await editor.commands.apply({
          projectId: p.id,
          requestId: crypto.randomUUID(),
          expectedRevision: 1,
          operations: [
            { type: 'addTrack', track: { id: 'video-track', kind: 'video' } },
            {
              type: 'insertClip',
              trackId: 'video-track',
              clip: {
                id: 'still',
                kind: 'image',
                assetId: original.id,
                startUs: 0,
                durationUs: 1000000,
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
              },
            },
          ],
        });
        const video = await editor.exports.start(p.id, { format: 'mp4' })
          .completion;
        const sourceVideo = await editor.assets.import(video.file, 'Source.mp4')
          .completion;
        const still = await editor.storyboard.insertImage(
          p.id,
          {
            assetId: sourceVideo.id,
            elementId: 'video-image',
            timeUs: 500000,
            x: 500,
            y: 100,
            width: 320,
          },
          2,
        ).completion;
        const videoPixel = await pixel(
          (
            await editor.storyboard.export(
              p.id,
              { format: 'png', elementIds: ['video-image'] },
              3,
            ).completion
          ).file,
        );
        await editor.commands.undo(p.id, crypto.randomUUID(), 3);
        const undone = (
          await editor.projects.snapshot(p.id)
        ).storyboard!.elements.map((e) => e.id);
        await editor.commands.redo(p.id, crypto.randomUUID(), 4);
        const before = await editor.projects.snapshot(p.id);
        const errors: string[] = [];
        for (const [options, revision] of [
          [{ assetId: original.id, elementId: 'stale' }, 0],
          [
            {
              assetId: sourceVideo.id,
              elementId: 'outside-video',
              timeUs: 1000000,
            },
            5,
          ],
        ] as const) {
          try {
            await editor.storyboard.insertImage(p.id, options, revision)
              .completion;
          } catch (e) {
            errors.push((e as Error).message);
          }
        }
        const cancelled = editor.storyboard.insertImage(
          p.id,
          { assetId: original.id, elementId: 'cancelled' },
          5,
        );
        cancelled.cancel();
        await cancelled.completion.catch(() => {});
        const after = await editor.projects.snapshot(p.id);
        const backup = await editor.workspace.snapshot([p.id]);
        const refs = backup.assets.map((a) => a.id);
        const zip = await editor.workspace.export({
          projectIds: [p.id],
          includeVersions: true,
          assetIds: refs,
        }).completion;
        const archive = await readWorkspaceArchive(zip);
        const restored = await editor.workspace.import(archive, {
          projectIds: [p.id],
          includeVersions: true,
          assetIds: refs,
        }).completion;
        const copy = restored[0]!;
        const copiedImage = copy.storyboard!.elements.find(
          (e) => e.id === 'agent-image',
        )!.fileId!;
        const copyPixel = await pixel(
          (
            await editor.storyboard.export(
              copy.id,
              { format: 'png', elementIds: ['agent-image'] },
              0,
            ).completion
          ).file,
        );
        return {
          id: p.id,
          originalId: original.id,
          imageId,
          storedType: stored.type,
          color,
          videoPixel,
          copyPixel,
          copiedImage,
          svg: await svg.file.text(),
          scene,
          refs,
          undone,
          after: after.revision,
          before: before.revision,
          errors,
          stillAsset: still.assetId,
          hasRemotePixels: requests.some((r) => r.includes('data:image')),
        };
      } finally {
        await assistant.dispose();
        await editor.dispose();
      }
    }, base);
    expect(result.imageId).not.toBe(result.originalId);
    expect(result.storedType).toBe('image/png');
    expect(result.color).toEqual([255, 0, 0, 255]);
    expect(result.videoPixel[0]).toBeGreaterThan(245);
    expect(result.videoPixel[1]).toBeLessThan(10);
    expect(result.copyPixel).toEqual([255, 0, 0, 255]);
    expect(result.copiedImage).not.toBe(result.imageId);
    expect(result.svg).toContain('data:image/png');
    expect(result.scene.files[result.imageId].dataURL).toContain(
      'data:image/png',
    );
    expect(result.refs).toEqual(
      expect.arrayContaining([result.imageId, result.stillAsset]),
    );
    expect(result.undone).toEqual(['agent-image']);
    expect(result.after).toBe(result.before);
    expect(result.errors).toHaveLength(2);
    expect(result.hasRemotePixels).toBe(false);
    await page.goto(`${base}#/project/${result.id}`);
    await page.getByRole('tab', { name: 'Storyboard', exact: true }).click();
    await expect(page.locator('.storyboard canvas.interactive')).toBeVisible();
    const redPixels = async () =>
      page.locator('.storyboard canvas.static').evaluate((canvas) => {
        const c = canvas as HTMLCanvasElement;
        const data = c
          .getContext('2d')!
          .getImageData(0, 0, c.width, c.height).data;
        let count = 0;
        for (let i = 0; i < data.length; i += 4)
          if (data[i]! > 240 && data[i + 1]! < 15 && data[i + 2]! < 15) count++;
        return count;
      });
    await expect.poll(redPixels).toBeGreaterThan(1000);
    await page.reload();
    await page.getByRole('tab', { name: 'Storyboard', exact: true }).click();
    await expect.poll(redPixels).toBeGreaterThan(1000);
    await dismissNotifications(page);
    await page
      .getByRole('button', { name: 'Storyboard menu', exact: true })
      .click();
    await page.getByText('Insert image from Media', { exact: true }).click();
    await page.getByRole('combobox', { name: 'Image source' }).click();
    await page.getByRole('option', { name: 'Source.png', exact: true }).click();
    await page
      .getByRole('button', { name: 'Insert image', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect
      .poll(async () =>
        page.evaluate(
          async ({ base, id }) => {
            const { createEditor } = (await import(
              base + 'editor.js'
            )) as typeof import('../../src/editor');
            const e = await createEditor();
            try {
              return (await e.projects.snapshot(id)).storyboard!.elements
                .length;
            } finally {
              await e.dispose();
            }
          },
          { base, id: result.id },
        ),
      )
      .toBe(3);
    const blue = await page.evaluate(async () => {
      const c = new OffscreenCanvas(160, 90);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(0, 0, 160, 90);
      return Array.from(
        new Uint8Array(
          await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer(),
        ),
      );
    });
    await page
      .getByRole('button', { name: 'Storyboard menu', exact: true })
      .click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByText('Upload image', { exact: true }).click();
    await (
      await chooser
    ).setFiles({
      name: 'Uploaded.png',
      mimeType: 'image/png',
      buffer: Buffer.from(blue),
    });
    await expect
      .poll(async () =>
        page.evaluate(
          async ({ base, id }) => {
            const { createEditor } = (await import(
              base + 'editor.js'
            )) as typeof import('../../src/editor');
            const e = await createEditor();
            try {
              return (await e.projects.snapshot(id)).storyboard!.elements
                .length;
            } finally {
              await e.dispose();
            }
          },
          { base, id: result.id },
        ),
      )
      .toBe(4);
    await expect
      .poll(async () =>
        page.locator('.storyboard canvas.static').evaluate((canvas) => {
          const c = canvas as HTMLCanvasElement;
          const data = c
            .getContext('2d')!
            .getImageData(0, 0, c.width, c.height).data;
          let count = 0;
          for (let i = 0; i < data.length; i += 4)
            if (data[i]! < 15 && data[i + 1]! < 15 && data[i + 2]! > 240)
              count++;
          return count;
        }),
      )
      .toBeGreaterThan(1000);
    await page.screenshot({
      path: testInfo.outputPath('storyboard-images.png'),
    });
    expect(remote).toEqual([]);
  });
}
