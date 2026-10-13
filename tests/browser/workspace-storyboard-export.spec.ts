import { test, expect } from '@playwright/test';
import { dismissNotifications } from './workspace-notifications-helper';

for (const base of ['/', '/LocalCut/']) {
  test(`storyboard exports local formats, Media persistence and agent timeline reuse ${base}`, async ({
    page,
  }, testInfo) => {
    const remote: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).hostname !== '127.0.0.1')
        remote.push(request.url());
    });
    await page.goto(base);
    const result = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const project = await editor.projects.create('Export board');
        await editor.commands.apply({
          projectId: project.id,
          requestId: crypto.randomUUID(),
          expectedRevision: 0,
          operations: [
            {
              type: 'upsertStoryboardElements',
              elements: [
                {
                  id: 'box',
                  type: 'rectangle',
                  x: 100,
                  y: 100,
                  width: 240,
                  height: 120,
                  backgroundColor: '#ff0000',
                  fillStyle: 'solid',
                  roughness: 0,
                  strokeWidth: 0,
                },
                {
                  id: 'label',
                  type: 'text',
                  x: 400,
                  y: 100,
                  width: 220,
                  height: 40,
                  text: 'Local diagram label',
                  fontSize: 24,
                  fontFamily: 5,
                },
              ],
            },
          ],
        });
        const png = await editor.storyboard.export(
          project.id,
          { format: 'png', elementIds: ['box'], background: false },
          1,
        ).completion;
        const bitmap = await createImageBitmap(png.file);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        const dimensions = [canvas.width, canvas.height];
        const corner = [...context.getImageData(0, 0, 1, 1).data];
        const center = [
          ...context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1)
            .data,
        ];
        const scaled = [];
        for (const scale of [0.5, 2, 4]) {
          const exported = await editor.storyboard.export(
            project.id,
            {
              format: 'png',
              elementIds: ['box'],
              background: false,
              scale,
            },
            1,
          ).completion;
          const bitmap = await createImageBitmap(exported.file);
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          context.drawImage(bitmap, 0, 0);
          bitmap.close();
          scaled.push({
            scale,
            dimensions: [canvas.width, canvas.height],
            rightEdge: [
              ...context.getImageData(
                canvas.width - 22 * scale,
                canvas.height / 2,
                1,
                1,
              ).data,
            ],
            outside: [...context.getImageData(0, 0, 1, 1).data],
          });
        }
        const svg = await editor.storyboard.export(
          project.id,
          { format: 'svg' },
          1,
        ).completion;
        const svgText = await svg.file.text();
        const scene = await editor.storyboard.export(
          project.id,
          { format: 'excalidraw' },
          1,
        ).completion;
        const json = JSON.parse(await scene.file.text());
        const library = editor.library.forProject(project.id);
        const empty = await library.list();
        const folder = await library.apply(
          { type: 'create', parentId: null, name: 'Diagrams' },
          empty.revision,
        );
        const stored = await editor.storyboard.store(
          project.id,
          {
            format: 'png',
            elementIds: ['box'],
            background: false,
            parentId: folder.entries[0]!.id,
            name: 'Overlay',
          },
          1,
        ).completion;
        const asset = await editor.assets.inspect(stored.assetId);
        const storedFile = await library.file(stored.entryId);
        const storedHash = [
          ...new Uint8Array(
            await crypto.subtle.digest(
              'SHA-256',
              await storedFile.arrayBuffer(),
            ),
          ),
        ];
        const pngHash = [
          ...new Uint8Array(
            await crypto.subtle.digest('SHA-256', await png.file.arrayBuffer()),
          ),
        ];
        const before = await editor.projects.snapshot(project.id);
        let stale = '',
          invalidFolder = '',
          oversized = '';
        try {
          await editor.storyboard.export(project.id, { format: 'png' }, 0)
            .completion;
        } catch (e) {
          stale = (e as Error & { code: string }).code;
        }
        try {
          await editor.storyboard.store(
            project.id,
            { format: 'png', parentId: 'foreign' },
            1,
          ).completion;
        } catch (e) {
          invalidFolder = (e as Error & { code: string }).code;
        }
        await editor.commands.apply({
          projectId: project.id,
          requestId: crypto.randomUUID(),
          expectedRevision: 1,
          operations: [
            {
              type: 'upsertStoryboardElements',
              elements: [
                {
                  id: 'huge',
                  type: 'rectangle',
                  x: 0,
                  y: 0,
                  width: 100000,
                  height: 100000,
                },
              ],
            },
          ],
        });
        try {
          await editor.storyboard.export(
            project.id,
            { format: 'png', elementIds: ['huge'] },
            2,
          ).completion;
        } catch (e) {
          oversized = (e as Error & { code: string }).code;
        }
        await editor.commands.undo(project.id, crypto.randomUUID(), 2);
        return {
          id: project.id,
          dimensions,
          corner,
          center,
          scaled,
          svg:
            svgText.includes('Local diagram label') &&
            svgText.includes('<svg') &&
            svgText.includes('data:'),
          scene: {
            type: json.type,
            texts: json.elements.map((e: { text?: string }) => e.text),
            files: json.files,
          },
          stored,
          asset,
          sameBytes: JSON.stringify(storedHash) === JSON.stringify(pngHash),
          folderId: folder.entries[0]!.id,
          stale,
          invalidFolder,
          oversized,
          unchangedTimeline: before.tracks.length === 0,
        };
      } finally {
        await editor.dispose();
      }
    }, base);
    expect(result.dimensions).toEqual([280, 160]);
    expect(result.corner[3]).toBe(0);
    expect(result.center).toEqual([255, 0, 0, 255]);
    for (const output of result.scaled) {
      expect(output.dimensions).toEqual([
        280 * output.scale,
        160 * output.scale,
      ]);
      expect(output.rightEdge).toEqual([255, 0, 0, 255]);
      expect(output.outside[3]).toBe(0);
    }
    expect(result.svg).toBe(true);
    expect(result.scene.type).toBe('excalidraw');
    expect(result.scene.texts).toContain('Local diagram label');
    expect(result.asset).toMatchObject({
      kind: 'image',
      status: 'ready',
      width: 280,
      height: 160,
      name: 'Overlay.png',
    });
    expect(result.sameBytes).toBe(true);
    expect(result.stale).toBe('REVISION_CONFLICT');
    expect(result.invalidFolder).toBe('INVALID_COMMAND');
    expect(result.oversized).toBe('INVALID_COMMAND');
    expect(result.unchangedTimeline).toBe(true);
    // A fresh engine reuses the persisted render even with local font fetches blocked.
    await page.reload();
    await page.route('**/storyboard/**/fonts/**', (route) => route.abort());
    const persisted = await page.evaluate(
      async ({ base, result }) => {
        const { createEditor } = (await import(
          base + 'editor.js'
        )) as typeof import('../../src/editor');
        const { createAssistant } = (await import(
          base + 'ai.js'
        )) as typeof import('../../src/ai');
        const editor = await createEditor();
        let assistant: ReturnType<typeof createAssistant> | undefined;
        try {
          const project = await editor.projects.snapshot(result.id);
          const exported = await editor.storyboard.export(
            project.id,
            { format: 'svg' },
            project.revision,
          ).completion;
          const file = await editor.library
            .forProject(project.id)
            .file(result.stored.entryId);
          const asset = await editor.assets.inspect(result.stored.assetId);
          const requests: string[] = [];
          let round = 0;
          const call = (name: string, args: unknown) => ({
            id: crypto.randomUUID(),
            type: 'function' as const,
            function: { name, arguments: JSON.stringify(args) },
          });
          assistant = createAssistant({
            editor,
            projectId: project.id,
            model: 'test',
            execution: 'requested',
            provider: {
              stream: async function* (request) {
                requests.push(JSON.stringify(request));
                const tools = [
                  [call('load_skill', { skillId: 'storyboard' })],
                  [
                    call('propose_action', {
                      summary: 'Store transparent diagram',
                      action: {
                        type: 'store_storyboard',
                        options: {
                          format: 'png',
                          elementIds: ['box'],
                          background: false,
                        },
                      },
                    }),
                  ],
                  [call('load_skill', { skillId: 'editing' })],
                ];
                if (round === 3) {
                  const results = request.messages
                    .filter((m) => m.role === 'tool')
                    .map((m) => JSON.parse(m.content));
                  const stored = results.find(
                    (r) => r.result?.kind === 'storyboard_asset',
                  ).result;
                  tools.push([
                    call('inspect_asset', { assetId: stored.assetId }),
                    call('propose_edits', {
                      summary: 'Place stored diagram',
                      operations: [
                        {
                          type: 'addTrack',
                          track: { id: 'diagrams', kind: 'overlay' },
                        },
                        {
                          type: 'insertClip',
                          trackId: 'diagrams',
                          clip: {
                            id: 'diagram-clip',
                            kind: 'image',
                            assetId: stored.assetId,
                            startUs: 0,
                            durationUs: 2e6,
                            width: asset.width,
                            height: asset.height,
                          },
                        },
                      ],
                    }),
                  ]);
                }
                const tool_calls = tools[round++];
                yield {
                  type: 'complete',
                  message: {
                    role: 'assistant',
                    content: tool_calls ? '' : 'Diagram stored and placed.',
                    ...(tool_calls ? { tool_calls } : {}),
                  },
                };
              },
            },
          });
          await assistant.run(
            'Store the whiteboard as a transparent PNG and place it for two seconds.',
          ).completion;
          const after = await editor.projects.snapshot(project.id);
          return {
            assetId: asset.id,
            bytes: file.size,
            svg: (await exported.file.text()).includes('Local diagram label'),
            folder: (
              await editor.library.forProject(project.id).list()
            ).entries.find((e) => e.id === result.stored.entryId)!.parentId,
            clip: after.tracks[0]?.clips[0],
            providerHasBytes: requests.some(
              (r) => r.includes('data:image') || r.includes('"file":'),
            ),
          };
        } finally {
          await assistant?.dispose();
          await editor.dispose();
        }
      },
      { base, result },
    );
    expect(persisted.assetId).toBe(result.stored.assetId);
    expect(persisted.bytes).toBeGreaterThan(0);
    expect(persisted.svg).toBe(true);
    expect(persisted.folder).toBe(result.folderId);
    expect(persisted.clip).toMatchObject({
      id: 'diagram-clip',
      kind: 'image',
      durationUs: 2e6,
    });
    expect(persisted.providerHasBytes).toBe(false);
    expect(remote).toEqual([]);
    await page.unroute('**/storyboard/**/fonts/**');
    await page.goto(`${base}#/project/${result.id}`);
    await page.getByRole('tab', { name: 'Storyboard', exact: true }).click();
    await expect(page.locator('.storyboard canvas.interactive')).toBeVisible();
    await dismissNotifications(page);
    await page
      .locator('.storyboard')
      .getByRole('button', { name: 'Storyboard menu', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Store PNG in Media', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('storyboard-export-menu.png'),
    });
    const download = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Export editable scene', exact: true })
      .click();
    expect((await download).suggestedFilename()).toBe('Storyboard.excalidraw');
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .locator('.storyboard')
      .getByRole('button', { name: 'Storyboard menu', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Export PNG', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('storyboard-export-mobile.png'),
    });
    await page
      .getByRole('button', { name: 'Store PNG in Media', exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          async ({ base, id }) => {
            const { createEditor } = (await import(
              base + 'editor.js'
            )) as typeof import('../../src/editor');
            const editor = await createEditor();
            try {
              return (
                await editor.library.forProject(id).list()
              ).entries.filter((e) => e.kind === 'asset').length;
            } finally {
              await editor.dispose();
            }
          },
          { base, id: result.id },
        ),
      )
      .toBe(3);
  });
}
