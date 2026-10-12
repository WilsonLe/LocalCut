import { expect, test } from '@playwright/test';

for (const base of ['/', '/LocalCut/']) {
  test(`creative effects persist, render and export native pixels/audio ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const result = await page.evaluate(async (base) => {
      const { createEditor, parseCube } = await import(base + 'editor.js');
      const editor = await createEditor({
        namespace: 'creative-' + crypto.randomUUID(),
      });
      const image = async (color: string) => {
        const canvas = new OffscreenCanvas(128, 128),
          ctx = canvas.getContext('2d')!;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 128, 128);
        return editor.assets.import(
          new File([await canvas.convertToBlob()], 'color.png', {
            type: 'image/png',
          }),
        ).completion;
      };
      const pixels = async (id: string) => {
        const f = await editor.preview.frame(id, 200000, {
          width: 128,
          height: 128,
        }).completion;
        const canvas = new OffscreenCanvas(128, 128),
          ctx = canvas.getContext('2d')!;
        try {
          ctx.drawImage(f.image, 0, 0);
          return [
            [64, 64],
            [5, 5],
          ].map(([x, y]) => [...ctx.getImageData(x!, y!, 1, 1).data]);
        } finally {
          f.image.close();
        }
      };
      try {
        const blue = await image('blue'),
          red = await image('red');
        const p = await editor.projects.create('Creative', {
          width: 128,
          height: 128,
        });
        const wav = new ArrayBuffer(44 + 48000 * 4),
          view = new DataView(wav);
        const str = (o: number, s: string) => {
          for (let i = 0; i < s.length; i++)
            view.setUint8(o + i, s.charCodeAt(i));
        };
        str(0, 'RIFF');
        view.setUint32(4, wav.byteLength - 8, true);
        str(8, 'WAVE');
        str(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 2, true);
        view.setUint32(24, 48000, true);
        view.setUint32(28, 192000, true);
        view.setUint16(32, 4, true);
        view.setUint16(34, 16, true);
        str(36, 'data');
        view.setUint32(40, 48000 * 4, true);
        for (let i = 0; i < 48000; i++)
          for (let c = 0; c < 2; c++)
            view.setInt16(
              44 + i * 4 + c * 2,
              Math.sin((2 * Math.PI * 100 * i) / 48000) * 3000,
              true,
            );
        const audio = await editor.assets.import(
          new File([wav], 'tone.wav', { type: 'audio/wav' }),
        ).completion;
        let revision = 0;
        const apply = async (operations: unknown[]) => {
          const r = await editor.commands.apply({
            projectId: p.id,
            requestId: crypto.randomUUID(),
            expectedRevision: revision,
            operations,
          });
          revision = r.appliedRevision;
        };
        await apply([
          { type: 'addTrack', track: { id: 'lower', kind: 'video' } },
          { type: 'addTrack', track: { id: 'upper', kind: 'video' } },
          { type: 'addTrack', track: { id: 'audio', kind: 'audio' } },
          ...[
            [blue, 'lower'],
            [red, 'upper'],
          ].map(([asset, track]) => ({
            type: 'insertClip',
            trackId: track,
            clip: {
              id: track + '-clip',
              kind: 'image',
              assetId: asset.id,
              startUs: 0,
              durationUs: 1000000,
              width: 128,
              height: 128,
            },
          })),
          {
            type: 'insertClip',
            trackId: 'audio',
            clip: {
              id: 'sound',
              kind: 'audio',
              assetId: audio.id,
              startUs: 0,
              durationUs: 1000000,
              sourceOutUs: 1000000,
              balance: 1,
              equalizer: { lowDb: 6, midDb: 0, highDb: 0 },
              noiseReduction: 0.25,
              noiseFloorDb: -70,
              fadeInUs: 50000,
              fadeOutUs: 50000,
            },
          },
        ]);
        const values = [];
        for (let b = 0; b < 2; b++)
          for (let g = 0; g < 2; g++)
            for (let r = 0; r < 2; r++) values.push(`${b} ${g} ${r}`);
        await apply([
          {
            type: 'updateClip',
            clipId: 'upper-clip',
            patch: {
              colorLut: parseCube('LUT_3D_SIZE 2\n' + values.join('\n')),
            },
          },
        ]);
        const lut = await pixels(p.id);
        await apply([
          {
            type: 'updateClip',
            clipId: 'upper-clip',
            patch: {
              colorLut: null,
              blendMode: 'screen',
              opacity: 0.5,
              mask: {
                shape: 'ellipse',
                x: 0.25,
                y: 0.25,
                width: 0.5,
                height: 0.5,
                invert: false,
                feather: 0,
              },
            },
          },
        ]);
        const preview = await pixels(p.id),
          snapshot = await editor.projects.snapshot(p.id);
        const history = await editor.commands.undo(
          p.id,
          crypto.randomUUID(),
          revision,
        );
        revision = history.appliedRevision;
        const undone = await pixels(p.id);
        const redo = await editor.commands.redo(
          p.id,
          crypto.randomUUID(),
          revision,
        );
        revision = redo.appliedRevision;
        const json = await editor.projects.exportJSON(p.id);
        const copy = await editor.projects.importJSON(json);
        const copied = await editor.projects.snapshot(copy.id);
        const backup = copied.tracks[1].clips[0].mask;

        const encoded = [];
        for (const format of ['mp4', 'webm']) {
          const output = await editor.exports.start(p.id, { format })
            .completion;
          try {
            const asset = await editor.assets.import(
              new File([output.file], 'output.' + format, {
                type: format === 'mp4' ? 'video/mp4' : 'video/webm',
              }),
            ).completion;
            const decoded = await editor.projects.create('Decoded', {
              width: 128,
              height: 128,
            });
            await editor.commands.apply({
              projectId: decoded.id,
              requestId: crypto.randomUUID(),
              expectedRevision: 0,
              operations: [
                {
                  type: 'addTrack',
                  track: { id: 'video-track', kind: 'video' },
                },
                {
                  type: 'insertClip',
                  trackId: 'video-track',
                  clip: {
                    id: 'v',
                    kind: 'video',
                    assetId: asset.id,
                    startUs: 0,
                    durationUs: asset.durationUs,
                    sourceOutUs: asset.durationUs,
                    width: 128,
                    height: 128,
                  },
                },
              ],
            });
            const pcm = await editor.assets.derivative(asset.id, 'pcm')
              .completion;
            const context = new AudioContext({ sampleRate: 48000 });
            try {
              const buffer = await context.decodeAudioData(
                await pcm.arrayBuffer(),
              );
              const energy = (channel: number) => {
                const samples = buffer
                  .getChannelData(channel)
                  .slice(4800, 24000);
                return Math.sqrt(
                  samples.reduce((s: number, v: number) => s + v * v, 0) /
                    samples.length,
                );
              };
              encoded.push({
                format,
                pixels: await pixels(decoded.id),
                left: energy(0),
                right: energy(1),
              });
            } finally {
              await context.close();
            }
          } finally {
            await output.dispose();
          }
        }
        // Keyed chroma pixels are removed before grading, revealing the lower blue track.
        await apply([
          {
            type: 'updateClip',
            clipId: 'upper-clip',
            patch: {
              mask: null,
              opacity: 1,
              blendMode: 'source-over',
              chromaKey: {
                color: '#ff0000',
                tolerance: 0.01,
                softness: 0,
                spill: 1,
              },
              colorPreset: 'warm',
            },
          },
        ]);
        const keyed = await pixels(p.id);
        return {
          id: p.id,
          lut,
          preview,
          undone,
          backup,
          encoded,
          keyed,
          snapshot,
        };
      } finally {
        await editor.dispose();
      }
    }, base);
    expect(result.lut[0]).toEqual([0, 0, 255, 255]);
    for (const output of [
      result.preview,
      ...result.encoded.map((e) => e.pixels),
    ]) {
      expect(output[0]![0]).toBeGreaterThan(110);
      expect(output[0]![0]).toBeLessThan(145);
      expect(output[0]![2]).toBeGreaterThan(240);
      expect(output[1]![0]).toBeLessThan(15);
      expect(output[1]![2]).toBeGreaterThan(240);
    }
    expect(result.backup).toEqual(result.snapshot.tracks[1].clips[0].mask);
    expect(result.undone[0]).toEqual(result.lut[0]);
    expect(result.keyed[0]).toEqual([0, 0, 255, 255]);
    for (const output of result.encoded) {
      expect(output.left).toBeLessThan(0.002);
      expect(output.right).toBeGreaterThan(0.1);
      expect(output.right).toBeLessThan(0.15);
    }
  });

  test(`creative clip controls import LUTs, retain drafts and fit narrow views ${base}`, async ({
    page,
  }, testInfo) => {
    await page.goto(base);
    const id = await page.evaluate(async (base) => {
      const { createEditor } = await import(base + 'editor.js');
      const e = await createEditor();
      try {
        const p = await e.projects.create('Creative controls', {
          width: 128,
          height: 128,
        });
        const canvas = new OffscreenCanvas(128, 128);
        canvas.getContext('2d')!.fillRect(0, 0, 128, 128);
        const a = await e.assets.import(
          new File([await canvas.convertToBlob()], 'source.png', {
            type: 'image/png',
          }),
        ).completion;
        await e.commands.apply({
          projectId: p.id,
          expectedRevision: 0,
          requestId: 'seed',
          operations: [
            { type: 'addTrack', track: { id: 'video-track', kind: 'video' } },
            {
              type: 'insertClip',
              trackId: 'video-track',
              clip: {
                id: 'clip',
                kind: 'image',
                assetId: a.id,
                startUs: 0,
                durationUs: 1000000,
                width: 128,
                height: 128,
              },
            },
          ],
        });
        return p.id;
      } finally {
        await e.dispose();
      }
    }, base);
    await page.goto(base + '#/project/' + id);
    await page.locator('[data-clip-id="clip"]').dblclick();
    const form = page.getByRole('dialog', {
      name: 'Clip properties',
      exact: true,
    });
    await form.getByText('Color', { exact: true }).click();
    await form
      .getByRole('combobox', { name: 'Color preset', exact: true })
      .click();
    await page.getByRole('option', { name: 'Warm', exact: true }).click();
    await form.getByLabel('Color strength', { exact: true }).fill('.6');
    await form.getByLabel('Import .cube LUT', { exact: true }).setInputFiles({
      name: 'bad.cube',
      mimeType: 'text/plain',
      buffer: Buffer.from('LUT_3D_SIZE 2\n0 0 0'),
    });
    await expect(form.getByRole('alert')).toContainText('table length');
    await form.getByText('Mask', { exact: true }).click();
    await form
      .getByRole('combobox', { name: 'Mask shape', exact: true })
      .click();
    await page.getByRole('option', { name: 'Ellipse', exact: true }).click();
    await form.getByLabel('Mask feather (pixels)', { exact: true }).fill('4');
    await form.getByText('Blending', { exact: true }).click();
    await form
      .getByRole('combobox', { name: 'Blend mode', exact: true })
      .click();
    await page.getByRole('option', { name: 'Multiply', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const box = await form.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(390);
    expect(box!.height).toBeLessThanOrEqual(844);
    await form.screenshot({
      path: testInfo.outputPath('creative-properties-narrow.png'),
    });
    await form
      .getByRole('button', { name: 'Apply properties', exact: true })
      .click();
    await expect(form).not.toBeVisible();
    await page.reload();
    await page.locator('[data-clip-id="clip"]').dblclick();
    await form.getByText('Color', { exact: true }).click();
    await expect(
      form.getByRole('combobox', { name: 'Color preset', exact: true }),
    ).toContainText('Warm');
    await expect(
      form.getByLabel('Color strength', { exact: true }),
    ).toHaveValue('0.6');
  });
}

for (const base of ['/', '/LocalCut/']) {
  test(`local mask tracking reuses results and assistant approval persists editable motion ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const result = await page.evaluate(async (base) => {
      const { createEditor } = await import(base + 'editor.js');
      const { createAssistant } = await import(base + 'ai.js');
      const namespace = 'tracking-' + crypto.randomUUID();
      let editor = await createEditor({ namespace });
      try {
        const canvas = new OffscreenCanvas(32, 32),
          ctx = canvas.getContext('2d')!;
        for (let y = 0; y < 32; y++)
          for (let x = 0; x < 32; x++) {
            const v = (x * 19 + y * 53) % 255;
            ctx.fillStyle = `rgb(${v},${v},${v})`;
            ctx.fillRect(x, y, 1, 1);
          }
        const image = await editor.assets.import(
          new File([await canvas.convertToBlob()], 'texture.png', {
            type: 'image/png',
          }),
        ).completion;
        const source = await editor.projects.create('Moving source', {
          width: 128,
          height: 128,
        });
        await editor.commands.apply({
          projectId: source.id,
          expectedRevision: 0,
          requestId: 'source',
          operations: [
            { type: 'addTrack', track: { id: 'video-track', kind: 'video' } },
            {
              type: 'insertClip',
              trackId: 'video-track',
              clip: {
                id: 'moving',
                kind: 'image',
                assetId: image.id,
                startUs: 0,
                durationUs: 1000000,
                x: 16,
                y: 32,
                width: 32,
                height: 32,
                keyframes: {
                  x: [
                    { timeUs: 0, value: 16 },
                    { timeUs: 1000000, value: 48 },
                  ],
                },
              },
            },
          ],
        });
        const output = await editor.exports.start(source.id, { format: 'mp4' })
          .completion;
        let asset;
        try {
          asset = await editor.assets.import(
            new File([output.file], 'moving.mp4', { type: 'video/mp4' }),
          ).completion;
        } finally {
          await output.dispose();
        }
        const project = await editor.projects.create('Tracking', {
          width: 128,
          height: 128,
        });
        await editor.commands.apply({
          projectId: project.id,
          expectedRevision: 0,
          requestId: 'track-seed',
          operations: [
            { type: 'addTrack', track: { id: 'video-track', kind: 'video' } },
            {
              type: 'insertClip',
              trackId: 'video-track',
              clip: {
                id: 'clip',
                kind: 'video',
                assetId: asset.id,
                startUs: 0,
                durationUs: asset.durationUs,
                sourceOutUs: asset.durationUs,
                width: 128,
                height: 128,
                mask: {
                  shape: 'rectangle',
                  x: 0.125,
                  y: 0.25,
                  width: 0.25,
                  height: 0.25,
                  invert: false,
                  feather: 0,
                },
              },
            },
          ],
        });
        const first = await editor.masks.track(project.id, 'clip', 1)
          .completion;
        await editor.dispose();
        editor = await createEditor({ namespace });
        const NativeWorker = window.Worker;
        let replay;
        try {
          window.Worker = new Proxy(NativeWorker, {
            construct() {
              throw new Error(
                'A cached tracking result must not start a new worker',
              );
            },
          });
          replay = await editor.masks.track(project.id, 'clip', 1).completion;
        } finally {
          window.Worker = NativeWorker;
        }
        let round = 0;
        const provider = {
          stream: async function* () {
            round++;
            const call = (name: string, args: unknown) => ({
              id: 'call-' + round,
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            });
            const calls =
              round === 1
                ? [call('load_skill', { skillId: 'editing' })]
                : round === 2
                  ? [call('inspect_capabilities', {})]
                  : round === 3
                    ? [
                        call('propose_action', {
                          summary: 'Track the mask',
                          action: { type: 'track_mask', clipId: 'clip' },
                        }),
                      ]
                    : [];
            yield {
              type: 'complete',
              message: {
                role: 'assistant',
                content: calls.length ? null : 'Ready',
                ...(calls.length ? { tool_calls: calls } : {}),
              },
            };
          },
        };
        const assistant = createAssistant({
          editor,
          provider,
          projectId: project.id,
          model: 'test/model',
        });
        const turn = await assistant.run('Track the mask').completion;
        const before = await editor.projects.snapshot(project.id);
        await assistant.approveProposal(turn.proposalIds[0]);
        const saved = await editor.projects.snapshot(project.id);
        await assistant.dispose();
        const stale = editor.masks.track(project.id, 'clip', 1);
        let rejected = '';
        try {
          await stale.completion;
        } catch (e) {
          rejected = (e as { code: string }).code;
        }
        return {
          first,
          replay,
          beforePoints: before.tracks[0].clips[0].mask.points,
          saved: saved.tracks[0].clips[0].mask,
          revision: saved.revision,
          rejected,
        };
      } finally {
        await editor.dispose();
      }
    }, base);
    expect(result.first.mask.points.length).toBeGreaterThan(5);
    expect(result.first.mask.points.at(-1).x).toBeGreaterThan(0.3);
    expect(result.first.confidence).toBeGreaterThan(0.2);
    expect(result.replay).toEqual(result.first);
    expect(result.beforePoints).toBeUndefined();
    expect(result.saved.points).toEqual(result.first.mask.points);
    expect(result.revision).toBe(2);
    expect(result.rejected).toBe('REVISION_CONFLICT');
  });
}
