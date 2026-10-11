import { expect, test } from '@playwright/test';

for (const base of ['/', '/LocalCut/']) {
  test(`native clip loops repeat video/audio across preview, MP4/WebM and split history ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const result = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const namespace = 'test-loop-' + crypto.randomUUID();
      let editor = await createEditor({ namespace });
      const audio = new AudioContext({ sampleRate: 48000 });
      const artifacts: Awaited<
        ReturnType<typeof editor.exports.start>['completion']
      >[] = [];
      const recorded: Float32Array[] = [];
      const native = audio.createBufferSource.bind(audio);
      audio.createBufferSource = () => {
        const node = native();
        const start = node.start.bind(node);
        node.start = (when = 0, offset = 0, duration?: number) => {
          recorded.push(node.buffer!.getChannelData(0).slice());
          start(when, offset, duration);
        };
        return node;
      };
      const frequency = (samples: Float32Array, startUs: number) => {
        const start = Math.round((startUs * 48000) / 1e6),
          length = 4800;
        let crosses = 0;
        for (let i = start + 1; i < start + length; i++)
          if (samples[i - 1]! <= 0 && samples[i]! > 0) crosses++;
        return (crosses * 48000) / length;
      };
      const pixels = async (projectId: string, times: number[]) => {
        const output: number[][] = [];
        for (const time of times) {
          const frame = await editor.preview.frame(projectId, time, {
            width: 128,
            height: 72,
          }).completion;
          try {
            const canvas = new OffscreenCanvas(128, 72);
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(frame.image, 0, 0);
            output.push([...ctx.getImageData(64, 36, 1, 1).data]);
          } finally {
            frame.image.close();
          }
        }
        return output;
      };
      try {
        const frames = 48000,
          wav = new ArrayBuffer(44 + frames * 4),
          view = new DataView(wav);
        const string = (offset: number, text: string) => {
          for (let i = 0; i < text.length; i++)
            view.setUint8(offset + i, text.charCodeAt(i));
        };
        string(0, 'RIFF');
        view.setUint32(4, wav.byteLength - 8, true);
        string(8, 'WAVE');
        string(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 2, true);
        view.setUint32(24, 48000, true);
        view.setUint32(28, 192000, true);
        view.setUint16(32, 4, true);
        view.setUint16(34, 16, true);
        string(36, 'data');
        view.setUint32(40, frames * 4, true);
        for (let i = 0; i < frames; i++) {
          const value =
            Math.sin((2 * Math.PI * (i < 24000 ? 440 : 880) * i) / 48000) *
            12000;
          view.setInt16(44 + i * 4, value, true);
          view.setInt16(46 + i * 4, -value, true);
        }
        const tone = await editor.assets.import(
          new File([wav], 'loop.wav', { type: 'audio/wav' }),
        ).completion;
        const colors = [];
        for (const color of ['red', 'blue']) {
          const canvas = new OffscreenCanvas(128, 72),
            ctx = canvas.getContext('2d')!;
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 128, 72);
          colors.push(
            await editor.assets.import(
              new File([await canvas.convertToBlob()], color + '.png', {
                type: 'image/png',
              }),
            ).completion,
          );
        }
        const source = await editor.projects.create('Source', {
          width: 128,
          height: 72,
        });
        await editor.commands.apply({
          projectId: source.id,
          expectedRevision: 0,
          requestId: 'assemble',
          operations: [
            { type: 'addTrack', track: { id: 'v', kind: 'video' } },
            { type: 'addTrack', track: { id: 'a', kind: 'audio' } },
            ...colors.map((asset, i) => ({
              type: 'insertClip' as const,
              trackId: 'v',
              clip: {
                id: 'color' + i,
                kind: 'image' as const,
                assetId: asset.id,
                startUs: i * 500000,
                durationUs: 500000,
                width: 128,
                height: 72,
              },
            })),
            {
              type: 'insertClip',
              trackId: 'a',
              clip: {
                id: 'tone',
                kind: 'audio',
                assetId: tone.id,
                startUs: 0,
                durationUs: 1000000,
                sourceOutUs: 1000000,
              },
            },
          ],
        });
        const original = await editor.exports.start(source.id, {
          format: 'mp4',
        }).completion;
        artifacts.push(original);
        const video = await editor.assets.import(
          new File([original.file], 'source.mp4', { type: 'video/mp4' }),
        ).completion;
        const p = await editor.projects.create('Loops', {
          width: 128,
          height: 72,
        });
        await editor.commands.apply({
          projectId: p.id,
          expectedRevision: 0,
          requestId: 'loop-source',
          operations: [
            { type: 'addTrack', track: { id: 'v', kind: 'video' } },
            {
              type: 'insertClip',
              trackId: 'v',
              clip: {
                id: 'c',
                kind: 'video',
                assetId: video.id,
                startUs: 0,
                durationUs: 1000000,
                sourceOutUs: 1000000,
                width: 128,
                height: 72,
              },
            },
            { type: 'resizeClip', clipId: 'c', durationUs: 2500000 },
          ],
        });
        const times = [250000, 750000, 1000000, 1250000, 1750000, 2250000];
        const previewPixels = await pixels(p.id, times);
        const playback = [];
        for (const time of [250000, 750000, 1250000]) {
          const session = editor.preview.session(
            p.id,
            document.createElement('canvas'),
            audio,
          );
          try {
            recorded.length = 0;
            await session.seek(time);
            await session.play();
            session.pause();
            playback.push(frequency(recorded[0]!, 0));
          } finally {
            session.dispose();
          }
        }
        const outputs = [];
        for (const format of ['mp4', 'webm'] as const) {
          const artifact = await editor.exports.start(p.id, { format })
            .completion;
          artifacts.push(artifact);
          const imported = await editor.assets.import(
            new File([artifact.file], 'loop.' + format, {
              type: format === 'mp4' ? 'video/mp4' : 'video/webm',
            }),
          ).completion;
          const pcm = await editor.assets.derivative(imported.id, 'pcm')
            .completion;
          const decoded = await audio.decodeAudioData(await pcm.arrayBuffer());
          const probe = await editor.projects.create('Probe', {
            width: 128,
            height: 72,
          });
          await editor.commands.apply({
            projectId: probe.id,
            expectedRevision: 0,
            requestId: 'probe',
            operations: [
              { type: 'addTrack', track: { id: 'v', kind: 'video' } },
              {
                type: 'insertClip',
                trackId: 'v',
                clip: {
                  id: 'c',
                  kind: 'video',
                  assetId: imported.id,
                  startUs: 0,
                  durationUs: imported.durationUs,
                  sourceOutUs: imported.durationUs,
                  width: 128,
                  height: 72,
                },
              },
            ],
          });
          outputs.push({
            format,
            durationUs: imported.durationUs,
            pixels: await pixels(
              probe.id,
              [250000, 750000, 1250000, 1750000, 2250000],
            ),
            frequencies: [250000, 750000, 1250000, 1750000, 2250000].map((t) =>
              frequency(decoded.getChannelData(0), t),
            ),
          });
        }
        const saved = await editor.projects.snapshot(p.id);
        const backup = await editor.projects.exportJSON(p.id);
        const copy = await editor.projects.importJSON(backup);
        await editor.commands.apply({
          projectId: p.id,
          expectedRevision: saved.revision,
          requestId: 'split',
          operations: [
            {
              type: 'splitClip',
              clipId: 'c',
              atUs: 1250000,
              rightClipId: 'right',
            },
          ],
        });
        const splitPixels = await pixels(p.id, times);
        const split = await editor.projects.snapshot(p.id);
        await editor.commands.undo(p.id, 'undo', split.revision);
        const undo = await editor.projects.snapshot(p.id);
        await editor.commands.redo(p.id, 'redo', undo.revision);
        await editor.dispose();
        editor = await createEditor({ namespace });
        const reopened = await editor.projects.open(p.id);
        return {
          previewPixels,
          playback,
          outputs,
          splitPixels,
          copyLoop: copy.tracks[0]!.clips[0]!.loop,
          reopenedClips: reopened.tracks[0]!.clips.map((c) => ({
            durationUs: c.durationUs,
            loop: c.loop,
          })),
        };
      } finally {
        for (const artifact of artifacts) await artifact.dispose();
        await audio.close();
        await editor.dispose();
      }
    }, base);
    const assertColors = (pixels: number[][]) =>
      pixels.forEach((p, i) =>
        expect(p[[0, 2, 3, 5].includes(i) ? 0 : 2]).toBeGreaterThan(220),
      );
    assertColors(result.previewPixels);
    assertColors(result.splitPixels);
    for (const [i, hz] of result.playback.entries())
      expect(Math.abs(hz - (i === 1 ? 880 : 440))).toBeLessThan(20);
    for (const output of result.outputs) {
      expect(Math.abs(output.durationUs - 2500000)).toBeLessThan(40000);
      output.pixels.forEach((p, i) =>
        expect(p[i % 2 === 0 ? 0 : 2]).toBeGreaterThan(220),
      );
      output.frequencies.forEach((hz, i) =>
        expect(Math.abs(hz - (i % 2 === 0 ? 440 : 880))).toBeLessThan(20),
      );
    }
    expect(result.copyLoop).toEqual({ offsetUs: 0 });
    expect(result.reopenedClips).toEqual([
      { durationUs: 1250000, loop: { offsetUs: 0 } },
      { durationUs: 1250000, loop: { offsetUs: 250000 } },
    ]);
  });
}
