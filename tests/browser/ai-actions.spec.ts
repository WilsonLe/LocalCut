import { expect, test } from '@playwright/test';

for (const base of ['/', '/LocalCut/']) {
  test(`AI approved history and local export actions use production services ${base}`, async ({
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
        namespace: 'ai-actions-' + crypto.randomUUID(),
      });
      const project = await editor.projects.create('PRIVATE PROJECT', {
        width: 256,
        height: 144,
      });
      const canvas = new OffscreenCanvas(256, 144),
        ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 256, 144);
      const asset = await editor.assets.import(
        await canvas.convertToBlob(),
        'PRIVATE FILE.png',
      ).completion;
      const requests: unknown[] = [];
      let next: import('../../src/ai').ToolCall[] | undefined;
      const assistant = createAssistant({
        editor,
        projectId: project.id,
        model: 'test/local-actions',
        assetIds: [asset.id],
        provider: {
          async *stream(request) {
            requests.push(structuredClone(request));
            const calls = next;
            next = undefined;
            yield {
              type: 'complete' as const,
              message: {
                role: 'assistant' as const,
                content: calls ? null : 'Review the pending action.',
                ...(calls ? { tool_calls: calls } : {}),
              },
            };
          },
        },
      });
      const propose = async (name: string, args: object) => {
        next = [
          {
            id: crypto.randomUUID(),
            type: 'function',
            function: { name, arguments: JSON.stringify(args) },
          },
        ];
        const turn = await assistant.run('Prepare this local action.')
          .completion;
        if (turn.proposalIds.length !== 1)
          throw new Error('Expected exactly one pending proposal');
        return turn.proposalIds[0]!;
      };
      try {
        const insert = await propose('propose_edits', {
          summary: 'Insert selected image',
          operations: [
            { type: 'addTrack', track: { id: 'visual', kind: 'video' } },
            {
              type: 'insertClip',
              trackId: 'visual',
              clip: {
                id: 'image',
                kind: 'image',
                assetId: asset.id,
                startUs: 0,
                durationUs: 500000,
                width: 256,
                height: 144,
              },
            },
          ],
        });
        const beforeApply = (await editor.projects.snapshot(project.id))
          .revision;
        await assistant.approveProposal(insert);
        const undo = await propose('propose_action', {
          summary: 'Undo insertion',
          action: { type: 'undo' },
        });
        const beforeUndo = (await editor.projects.snapshot(project.id))
          .revision;
        const undone = await assistant.approveProposal(undo);
        const empty = (await editor.projects.snapshot(project.id)).tracks
          .length;
        const redo = await propose('propose_action', {
          summary: 'Redo insertion',
          action: { type: 'redo' },
        });
        const redone = await assistant.approveProposal(redo);
        const exports: {
          format: string;
          bytes: number;
          durationUs: number;
          pixel: number[];
          appliedTwice: boolean;
        }[] = [];
        const progress: string[] = [];
        assistant.subscribe((event) => {
          if (event.type === 'proposal_progress')
            progress.push(event.progress.stage);
        });
        for (const format of ['mp4', 'webm'] as const) {
          const id = await propose('propose_action', {
            summary: 'Export local video',
            action: { type: 'export', options: { format } },
          });
          if (assistant.getProposal(id).result)
            throw new Error('An unapproved export ran');
          const exported = await assistant.approveProposal(id);
          if (exported.kind !== 'export')
            throw new Error('Expected export artifact');
          const replay = await assistant.approveProposal(id);
          const artifact = assistant.exportArtifact(exported.artifactId);
          const decoded = await editor.assets.import(
            new File([artifact.file], 'decode.' + format, {
              type: format === 'mp4' ? 'video/mp4' : 'video/webm',
            }),
          ).completion;
          const decodeProject = await editor.projects.create('decode', {
            width: 256,
            height: 144,
          });
          await editor.commands.apply({
            projectId: decodeProject.id,
            requestId: crypto.randomUUID(),
            expectedRevision: 0,
            operations: [
              {
                type: 'addTrack',
                track: {
                  id: 'decode-track',
                  kind: 'video',
                  clips: [
                    {
                      id: 'decode-clip',
                      kind: 'video',
                      assetId: decoded.id,
                      startUs: 0,
                      durationUs: decoded.durationUs,
                      sourceOutUs: decoded.durationUs,
                      width: 256,
                      height: 144,
                    },
                  ],
                },
              },
            ],
          });
          const frame = await editor.preview.frame(decodeProject.id, 200000)
            .completion;
          ctx.drawImage(frame.image, 0, 0);
          frame.image.close();
          exports.push({
            format,
            bytes: artifact.file.size,
            durationUs: exported.durationUs,
            pixel: [...ctx.getImageData(100, 60, 1, 1).data],
            appliedTwice: JSON.stringify(exported) === JSON.stringify(replay),
          });
          await artifact.dispose();
        }
        const finalRevision = (await editor.projects.snapshot(project.id))
          .revision;
        return {
          beforeApply,
          beforeUndo,
          empty,
          undone,
          redone,
          finalRevision,
          exports,
          progress,
          privateLeak: /PRIVATE PROJECT|PRIVATE FILE/.test(
            JSON.stringify(requests),
          ),
        };
      } finally {
        await assistant.dispose();
        await editor.dispose();
      }
    }, base);
    expect(result.beforeApply).toBe(0);
    expect(result.beforeUndo).toBe(1);
    expect(result.empty).toBe(0);
    expect(result.undone).toMatchObject({
      kind: 'history',
      receipt: { appliedRevision: 2 },
    });
    expect(result.redone).toMatchObject({
      kind: 'history',
      receipt: { appliedRevision: 3 },
    });
    expect(result.finalRevision).toBe(3);
    expect(result.exports).toHaveLength(2);
    for (const output of result.exports) {
      expect(output.bytes).toBeGreaterThan(100);
      expect(output.durationUs).toBe(500000);
      expect(output.appliedTwice).toBe(true);
      expect(output.pixel[0]).toBeGreaterThan(230);
      expect(output.pixel[1]).toBeLessThan(20);
      expect(output.pixel[2]).toBeLessThan(20);
    }
    expect(result.progress).toContain('completed');
    expect(result.privateLeak).toBe(false);
  });
}
