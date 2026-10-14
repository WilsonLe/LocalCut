import { expect, test } from '@playwright/test';
import { installGoalReviewFixture } from './goal-review-fixture';

// Worker/runtime asset resolution is deployment-sensitive: retain both builds.
for (const base of ['/', '/LocalCut/']) {
  test(`browser agent composes music, persists source, imports and exports audible audio ${base}`, async ({
    page,
  }) => {
    await installGoalReviewFixture(page);
    await page.goto(base);
    const saved = await page.evaluate(async (path) => {
      const { createEditor } = (await import(
        path + 'editor.js'
      )) as typeof import('../../src/editor');
      const { createAssistant } = (await import(
        path + 'ai.js'
      )) as typeof import('../../src/ai');
      const namespace = 'coding-' + crypto.randomUUID(),
        editor = await createEditor({ namespace });
      const project = await editor.projects.create('Original score', {
        width: 256,
        height: 144,
      });
      const script = `import fs from 'fs';
const sr=24000, duration=60, left=new Float32Array(sr*duration), right=new Float32Array(left.length);
for(let i=0;i<left.length;i++){const t=i/sr, note=[330,392,440,349.23,261.63][Math.min(4,Math.floor(t/12))], envelope=Math.min(1,t*20,(duration-t)*20);left[i]=envelope*(0.18*Math.sin(2*Math.PI*note*t)+0.05*Math.sin(2*Math.PI*note*2*t));right[i]=left[i]*0.8;}
console.log('isolation',typeof fetch,typeof navigator,typeof indexedDB,typeof process);
console.log('rendered',writeWav('music.wav',[left,right],sr));
let peak=0;for(const sample of left)peak=Math.max(peak,Math.abs(sample));fs.writeFile('render.json',JSON.stringify({duration,peak}));`;
      let step = 0;
      const calls: { name: string; args: object }[] = [
        { name: 'load_skill', args: { skillId: 'coding' } },
        { name: 'inspect_coding_workspace', args: {} },
        {
          name: 'write_file',
          args: { path: 'compose.js', content: script, expectedRevision: 0 },
        },
        {
          name: 'execute_code',
          args: { path: 'compose.js', expectedRevision: 1 },
        },
        { name: 'grep', args: { pattern: 'writeWav', glob: '*.js' } },
        {
          name: 'import_workspace_file',
          args: { path: 'music.wav', expectedRevision: 2 },
        },
      ];
      const assistant = createAssistant({
        editor,
        projectId: project.id,
        model: 'test/composer',
        execution: 'requested',
        context: { includeCodingWorkspace: true },
        provider: {
          async *stream(request) {
            const review = await window.localcutGoalReviewReply(request);
            if (review) {
              yield { type: 'complete' as const, message: review };
              return;
            }
            const call = calls[step++];
            yield {
              type: 'complete' as const,
              message: {
                role: 'assistant' as const,
                content: call ? null : 'Created and imported the score.',
                ...(call
                  ? {
                      tool_calls: [
                        {
                          id: crypto.randomUUID(),
                          type: 'function' as const,
                          function: {
                            name: call.name,
                            arguments: JSON.stringify(call.args),
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
      const turn = await assistant.run(
        'Compose original background music and import it.',
      ).completion;
      const proposals = turn.proposalIds.map((id) => assistant.getProposal(id));
      const imported = proposals.find(
        (p) => p.result?.kind === 'coding_asset',
      )?.result;
      if (imported?.kind !== 'coding_asset')
        throw new Error(
          'Expected a completed generated Media import: ' +
            JSON.stringify(proposals),
        );
      const asset = await editor.assets.inspect(imported.assetId);
      const wave = await editor.assets.waveform(asset.id, 32).completion;
      const inspection = await editor.coding.inspect(project.id);
      const other = await editor.projects.create('Another project');
      const isolation = await editor.coding.inspect(other.id);
      await editor.commands.apply({
        projectId: project.id,
        expectedRevision: project.revision,
        requestId: crypto.randomUUID(),
        operations: [
          {
            type: 'addTrack',
            track: { id: 'music', kind: 'audio', name: 'Music' },
          },
          {
            type: 'insertClip',
            trackId: 'music',
            clip: {
              id: 'score',
              kind: 'audio',
              assetId: asset.id,
              startUs: 0,
              durationUs: asset.durationUs,
              sourceInUs: 0,
              sourceOutUs: asset.durationUs,
              gain: 0.7,
              fadeInUs: 50000,
              fadeOutUs: 100000,
            },
          },
        ],
      });
      const outputs: {
        format: string;
        size: number;
        peak: number;
        audioCodec: string | undefined;
      }[] = [];
      for (const format of ['mp4', 'webm'] as const) {
        const artifact = await editor.exports.start(project.id, { format })
          .completion;
        try {
          const encoded = await editor.assets.import(
            artifact.file,
            'Rendered.' + format,
          ).completion;
          const waveform = await editor.assets.waveform(encoded.id, 32)
            .completion;
          outputs.push({
            format,
            size: artifact.file.size,
            peak: Math.max(...waveform),
            audioCodec: encoded.audioCodec,
          });
        } finally {
          await artifact.dispose();
        }
      }
      await assistant.dispose();
      await editor.dispose();
      return {
        namespace,
        projectId: project.id,
        assetId: asset.id,
        durationUs: asset.durationUs,
        peak: Math.max(...wave),
        inspection,
        isolation,
        outputs,
      };
    }, base);
    expect(saved.durationUs).toBe(60_000_000);
    expect(saved.peak).toBeGreaterThan(0.1);
    expect(saved.inspection.files.map((f) => f.path)).toEqual(
      expect.arrayContaining([
        '/project/compose.js',
        '/project/music.wav',
        '/project/render.json',
      ]),
    );
    expect(saved.isolation.files).toEqual([]);
    expect(saved.outputs.map((o) => o.format)).toEqual(['mp4', 'webm']);
    for (const output of saved.outputs) {
      expect(output.size).toBeGreaterThan(500);
      expect(output.peak).toBeGreaterThan(0.05);
      expect(output.audioCodec).toBeTruthy();
    }
    await page.reload();
    const restored = await page.evaluate(
      async ({ path, saved }) => {
        const { createEditor } = (await import(
          path + 'editor.js'
        )) as typeof import('../../src/editor');
        const editor = await createEditor({ namespace: saved.namespace });
        try {
          const state = await editor.coding.inspect(saved.projectId);
          const source = await editor.coding.query(saved.projectId, {
            type: 'read_file',
            path: 'compose.js',
          }).completion;
          const project = await editor.projects.snapshot(saved.projectId);
          const asset = await editor.assets.inspect(saved.assetId);
          const wav = await editor.coding.file(saved.projectId, 'music.wav');
          return {
            state,
            source: source.content,
            clip: project.tracks[0]!.clips[0]!,
            asset: asset.status,
            size: wav.size,
          };
        } finally {
          await editor.dispose();
        }
      },
      { path: base, saved },
    );
    expect(restored.state.revision).toBe(2);
    expect(restored.source).toContain('writeWav');
    expect(restored.clip.assetId).toBe(saved.assetId);
    expect(restored.asset).toBe('ready');
    expect(restored.size).toBe(5_760_044);
  });

  test(`browser coding cancellation, stale writers and headless approval ${base}`, async ({
    page,
  }) => {
    await installGoalReviewFixture(page);
    await page.goto(base);
    const result = await page.evaluate(async (path) => {
      const { createEditor } = (await import(
        path + 'editor.js'
      )) as typeof import('../../src/editor');
      const { createAssistant } = (await import(
        path + 'ai.js'
      )) as typeof import('../../src/ai');
      const namespace = 'coding-races-' + crypto.randomUUID(),
        editor = await createEditor({ namespace }),
        second = await createEditor({ namespace });
      const project = await editor.projects.create('Cancellation');
      try {
        await editor.coding.run(
          project.id,
          {
            type: 'write_file',
            path: 'loop.js',
            content:
              "fs.writeFile('partial.txt','do not commit');console.log('loop started');while(true){}",
          },
          0,
        ).completion;
        const running = editor.coding.run(
          project.id,
          { type: 'execute_code', path: 'loop.js', args: [] },
          1,
        );
        await new Promise<void>((resolve) => {
          const unsubscribe = running.subscribe((event) => {
            if (event.stage.includes('loop started')) {
              unsubscribe();
              running.cancel();
              resolve();
            }
          });
        });
        let cancelled = '';
        try {
          await running.completion;
        } catch (error) {
          cancelled = (error as { code: string }).code;
        }
        const after = await editor.coding.inspect(project.id);
        await second.coding.run(
          project.id,
          { type: 'write_file', path: 'other.txt', content: 'another writer' },
          1,
        ).completion;
        let conflict = '';
        try {
          await editor.coding.run(
            project.id,
            { type: 'write_file', path: 'lost.txt', content: 'stale' },
            1,
          ).completion;
        } catch (error) {
          conflict = (error as { code: string }).code;
        }
        const invalid = await editor.coding.run(
          project.id,
          { type: 'write_file', path: 'invalid.wav', content: 'not audio' },
          2,
        ).completion;
        let rejected = false;
        try {
          await editor.coding.importFile(
            project.id,
            'invalid.wav',
            invalid.revision,
          ).completion;
        } catch {
          rejected = true;
        }
        let step = 0;
        const assistant = createAssistant({
          editor,
          projectId: project.id,
          model: 'test/review',
          context: { includeCodingWorkspace: true },
          provider: {
            async *stream(request) {
              const review = await window.localcutGoalReviewReply(request);
              if (review) {
                yield { type: 'complete' as const, message: review };
                return;
              }
              const call =
                step++ === 0
                  ? { name: 'load_skill', args: { skillId: 'coding' } }
                  : step === 2
                    ? {
                        name: 'write_file',
                        args: {
                          path: 'approved.txt',
                          content: 'reviewed',
                          expectedRevision: 3,
                        },
                      }
                    : undefined;
              yield {
                type: 'complete' as const,
                message: {
                  role: 'assistant' as const,
                  content: call ? null : 'Review the pending write.',
                  ...(call
                    ? {
                        tool_calls: [
                          {
                            id: crypto.randomUUID(),
                            type: 'function' as const,
                            function: {
                              name: call.name,
                              arguments: JSON.stringify(call.args),
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
        const turn = await assistant.run('Write the source file.').completion;
        const before = await editor.coding.inspect(project.id);
        await assistant.approveProposal(turn.proposalIds[0]!);
        const approved = await editor.coding.inspect(project.id);
        await assistant.dispose();
        return { cancelled, after, conflict, rejected, before, approved };
      } finally {
        await second.dispose();
        await editor.dispose();
      }
    }, base);
    expect(result.cancelled).toBe('CANCELLED');
    expect(result.after.revision).toBe(1);
    expect(result.after.files.map((f) => f.path)).toEqual(['/project/loop.js']);
    expect(result.conflict).toBe('REVISION_CONFLICT');
    expect(result.rejected).toBe(true);
    expect(
      result.before.files.some((f) => f.path.endsWith('approved.txt')),
    ).toBe(false);
    expect(
      result.approved.files.some((f) => f.path.endsWith('approved.txt')),
    ).toBe(true);
  });
}
