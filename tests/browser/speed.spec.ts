import { expect, test } from '@playwright/test';

for (const base of ['/', '/LocalCut/']) {
  test(`native pitch modes and speed ramp preview/export/history ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const result = await page.evaluate(async (base) => {
      const { createEditor, rampPreset, sourceDurationUs } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const namespace = 'test-speed-' + crypto.randomUUID();
      let editor = await createEditor({ namespace });
      const audio = new AudioContext({ sampleRate: 48000 });
      const artifacts: Awaited<
        ReturnType<typeof editor.exports.start>['completion']
      >[] = [];
      const recorded: Float32Array[][] = [];
      const native = audio.createBufferSource.bind(audio);
      audio.createBufferSource = () => {
        const node = native(),
          start = node.start.bind(node);
        node.start = (when = 0, offset = 0, duration?: number) => {
          recorded.push([
            node.buffer!.getChannelData(0).slice(),
            node.buffer!.getChannelData(1).slice(),
          ]);
          start(when, offset, duration);
        };
        return node;
      };
      const frequency = (
        samples: Float32Array,
        start: number,
        length: number,
      ) => {
        let crosses = 0;
        for (let i = start + 1; i < start + length; i++)
          if (samples[i - 1]! <= 0 && samples[i]! > 0) crosses++;
        return (crosses * 48000) / length;
      };
      try {
        const frames = 4 * 48000,
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
          const value = Math.sin((2 * Math.PI * 440 * i) / 48000) * 12000;
          view.setInt16(44 + i * 4, value, true);
          view.setInt16(46 + i * 4, -value, true);
        }
        const tone = await editor.assets.import(
          new File([wav], 'tone.wav', { type: 'audio/wav' }),
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
        const sourceProject = await editor.projects.create('Source', {
          width: 128,
          height: 72,
        });
        await editor.commands.apply({
          projectId: sourceProject.id,
          requestId: 'source',
          expectedRevision: 0,
          operations: [
            { type: 'addTrack', track: { id: 'v', kind: 'video' } },
            { type: 'addTrack', track: { id: 'a', kind: 'audio' } },
            ...colors.map((asset, i) => ({
              type: 'insertClip' as const,
              trackId: 'v',
              clip: {
                id: 'color-' + i,
                kind: 'image' as const,
                assetId: asset.id,
                startUs: i * 2000000,
                durationUs: 2000000,
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
                durationUs: 4000000,
                sourceOutUs: 4000000,
              },
            },
          ],
        });
        const sourceArtifact = await editor.exports.start(sourceProject.id, {
          format: 'mp4',
        }).completion;
        artifacts.push(sourceArtifact);
        const source = await editor.assets.import(
          new File([sourceArtifact.file], 'source.mp4', { type: 'video/mp4' }),
        ).completion;
        const p = await editor.projects.create('Speed', {
          width: 128,
          height: 72,
        });
        await editor.commands.apply({
          projectId: p.id,
          requestId: 'assemble',
          expectedRevision: 0,
          operations: [
            { type: 'addTrack', track: { id: 'v', kind: 'video' } },
            {
              type: 'insertClip',
              trackId: 'v',
              clip: {
                id: 'c',
                kind: 'video',
                assetId: source.id,
                startUs: 0,
                durationUs: 4000000,
                sourceOutUs: 4000000,
                width: 128,
                height: 72,
              },
            },
          ],
        });
        const modes = [
          { pitchMode: 'change' as const, speed: 2 },
          { pitchMode: 'preserve' as const, speed: 2 },
          {
            pitchMode: 'preserve' as const,
            speed: 1,
            points: rampPreset('up-down', 'smooth'),
          },
          {
            pitchMode: 'change' as const,
            speed: 1,
            points: rampPreset('up', 'linear'),
          },
          {
            pitchMode: 'preserve' as const,
            speed: 1,
            points: rampPreset('down-up', 'hold'),
          },
        ];
        const outputs = [];
        await audio.resume();
        for (const [index, mode] of modes.entries()) {
          const current = await editor.projects.snapshot(p.id);
          await editor.commands.apply({
            projectId: p.id,
            expectedRevision: current.revision,
            requestId: 'speed-' + index,
            operations: [
              mode.points
                ? {
                    type: 'setSpeedRamp',
                    clipId: 'c',
                    points: mode.points,
                    pitchMode: mode.pitchMode,
                  }
                : {
                    type: 'setSpeed',
                    clipId: 'c',
                    speed: mode.speed,
                    pitchMode: mode.pitchMode,
                  },
            ],
          });
          const snapshot = await editor.projects.snapshot(p.id),
            clip = snapshot.tracks[0]!.clips[0]!;
          recorded.length = 0;
          const canvas = document.createElement('canvas'),
            session = editor.preview.session(p.id, canvas, audio);
          try {
            await session.play();
            session.pause();
          } finally {
            session.dispose();
          }
          const preview = recorded[0]![0]!;
          const expectedHz =
            mode.pitchMode === 'preserve' ? 440 : mode.points ? undefined : 880;
          const pixels = [];
          for (const fraction of [0.2, 0.85]) {
            const frame = await editor.preview.frame(
              p.id,
              Math.round(clip.durationUs * fraction),
              { width: 128, height: 72 },
            ).completion;
            const target = new OffscreenCanvas(128, 72),
              ctx = target.getContext('2d')!;
            try {
              ctx.drawImage(frame.image, 0, 0);
              pixels.push([...ctx.getImageData(64, 36, 1, 1).data]);
            } finally {
              frame.image.close();
            }
          }
          const exports = [];
          for (const format of ['mp4', 'webm'] as const) {
            const artifact = await editor.exports.start(p.id, { format })
              .completion;
            artifacts.push(artifact);
            const imported = await editor.assets.import(
              new File([artifact.file], 'output.' + format, {
                type: format === 'mp4' ? 'video/mp4' : 'video/webm',
              }),
            ).completion;
            const pcm = await editor.assets.derivative(imported.id, 'pcm')
                .completion,
              decoded = await audio.decodeAudioData(await pcm.arrayBuffer());
            const samples = decoded.getChannelData(0),
              right = decoded.getChannelData(1);
            const frequencies = [0.25, 0.75].map((fraction) =>
              frequency(
                samples,
                Math.round((clip.durationUs / 1e6) * fraction * 48000),
                4800,
              ),
            );
            let phaseError = 0,
              energy = 0;
            for (let i = 4800; i < Math.min(samples.length, 40000); i++) {
              phaseError += Math.abs(samples[i]! + right[i]!);
              energy += Math.abs(samples[i]!);
            }
            exports.push({
              format,
              frequencies,
              phaseError: phaseError / energy,
              durationUs: imported.durationUs,
              hasAudio: !!imported.audioCodec,
            });
          }
          outputs.push({
            pitchMode: mode.pitchMode,
            ramp: mode.points?.[0]?.interpolation,
            expectedHz,
            durationUs: clip.durationUs,
            derived: sourceDurationUs(clip, 4000000),
            previewHz: frequency(
              preview,
              4800,
              Math.min(4800, preview.length - 4800),
            ),
            pixels,
            exports,
          });
        }
        const beforeSplit = await editor.projects.snapshot(p.id);
        await editor.commands.apply({
          projectId: p.id,
          expectedRevision: beforeSplit.revision,
          requestId: 'split-speed',
          operations: [
            {
              type: 'splitClip',
              clipId: 'c',
              atUs: 1700001,
              rightClipId: 'right',
            },
          ],
        });
        const saved = await editor.projects.snapshot(p.id);
        const state = (project: typeof saved) =>
          project.tracks[0]!.clips.map((clip) => ({
            pitchMode: clip.pitchMode,
            ramp: clip.speedRamp,
            range: clip.speedRampSourceRange,
            startUs: clip.startUs,
            durationUs: clip.durationUs,
            sourceInUs: clip.sourceInUs,
            sourceOutUs: clip.sourceOutUs,
          }));
        const splitArtifact = await editor.exports.start(p.id, {
          format: 'mp4',
        }).completion;
        artifacts.push(splitArtifact);
        const splitMedia = await editor.assets.import(
          new File([splitArtifact.file], 'split.mp4', {
            type: 'video/mp4',
          }),
        ).completion;
        const backup = await editor.projects.exportJSON(p.id),
          copy = await editor.projects.importJSON(backup);
        await editor.projects.versions.save(p.id);
        const version = (await editor.projects.versions.list(p.id))[0]!;
        await editor.commands.undo(p.id, 'undo-speed', saved.revision);
        const undone = await editor.projects.snapshot(p.id);
        await editor.commands.redo(p.id, 'redo-speed', undone.revision);
        await editor.dispose();
        editor = await createEditor({ namespace });
        const reopened = await editor.projects.open(p.id),
          history = await editor.projects.versions.snapshot(p.id, version.id);
        return {
          outputs,
          retained: [reopened, copy, history.project].map(state),
          expectedClips: state(saved),
          splitDurationUs: splitMedia.durationUs,
          expectedDurationUs: saved.tracks[0]!.clips.reduce(
            (sum, clip) => sum + clip.durationUs,
            0,
          ),
        };
      } finally {
        for (const artifact of artifacts) await artifact.dispose();
        await audio.close();
        await editor.dispose();
      }
    }, base);
    for (const output of result.outputs) {
      expect(output.durationUs).toBe(output.derived);
      expect(output.pixels[0]![0]).toBeGreaterThan(230);
      expect(output.pixels[1]![2]).toBeGreaterThan(230);
      if (output.expectedHz)
        expect(Math.abs(output.previewHz - output.expectedHz)).toBeLessThan(15);
      for (const artifact of output.exports) {
        expect(artifact.hasAudio).toBe(true);
        expect(Math.abs(artifact.durationUs - output.durationUs)).toBeLessThan(
          40000,
        );
        expect(artifact.phaseError).toBeLessThan(0.05);
        if (output.expectedHz)
          for (const hz of artifact.frequencies)
            expect(Math.abs(hz - output.expectedHz)).toBeLessThan(15);
        else {
          expect(artifact.frequencies[0]).toBeGreaterThan(370);
          expect(artifact.frequencies[0]).toBeLessThan(440);
          expect(artifact.frequencies[1]).toBeGreaterThan(700);
          expect(artifact.frequencies[1]).toBeLessThan(770);
        }
      }
    }
    expect(result.expectedClips).toHaveLength(2);
    expect(result.expectedClips[0]!.range!.to).toBeGreaterThan(0);
    expect(result.expectedClips[0]!.range!.to).toBeLessThan(1);
    expect(result.expectedClips[0]!.sourceOutUs).toBe(
      result.expectedClips[1]!.sourceInUs,
    );
    expect(
      Math.abs(result.splitDurationUs! - result.expectedDurationUs),
    ).toBeLessThan(40000);
    for (const retained of result.retained)
      expect(retained).toEqual(result.expectedClips);
  });
}
