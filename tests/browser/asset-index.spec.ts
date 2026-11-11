import { behaviorBases } from './coverage-bases';
import { expect, test } from '@playwright/test';
import type { Asset, Editor } from '../../src/editor';
declare global {
  interface Window {
    indexEditor: Editor;
    indexAsset: Asset;
    indexNamespace: string;
    releaseIndex: () => void;
    indexLease: Promise<void>;
  }
}
for (const base of behaviorBases) {
  test(`native indexing keeps scenes, audio and evidence across reload ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const result = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const namespace = 'test-index-' + crypto.randomUUID(),
        editor = await createEditor({ namespace });
      const canvas = new OffscreenCanvas(128, 72),
        ctx = canvas.getContext('2d')!;
      try {
        const images = [];
        for (const color of ['red', 'blue']) {
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 128, 72);
          images.push(
            await editor.assets.import(
              await canvas.convertToBlob({ type: 'image/png' }),
              color,
            ).completion,
          );
        }
        const samples = 96000,
          bytes = new Uint8Array(44 + samples * 2),
          view = new DataView(bytes.buffer);
        const text = (offset: number, value: string) =>
          [...value].forEach((c, i) =>
            view.setUint8(offset + i, c.charCodeAt(0)),
          );
        text(0, 'RIFF');
        view.setUint32(4, bytes.length - 8, true);
        text(8, 'WAVEfmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, 48000, true);
        view.setUint32(28, 96000, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        text(36, 'data');
        view.setUint32(40, samples * 2, true);
        for (let i = 0; i < samples; i++)
          view.setInt16(
            44 + i * 2,
            Math.round(Math.sin((i * 2 * Math.PI * 440) / 48000) * 15000),
            true,
          );
        const audio = await editor.assets.import(
          new Blob([bytes], { type: 'audio/wav' }),
          'tone',
        ).completion;
        const project = await editor.projects.create('Native index', {
          width: 128,
          height: 72,
          frameRate: { num: 30, den: 1 },
        });
        await editor.commands.apply({
          projectId: project.id,
          expectedRevision: 0,
          requestId: 'assemble',
          operations: [
            { type: 'addTrack', track: { id: 'v', kind: 'video' } },
            { type: 'addTrack', track: { id: 'a', kind: 'audio' } },
            ...images.map((image, i) => ({
              type: 'insertClip' as const,
              trackId: 'v',
              clip: {
                id: 'image-' + i,
                kind: 'image' as const,
                assetId: image.id,
                startUs: i * 1000000,
                durationUs: 1000000,
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
                assetId: audio.id,
                startUs: 0,
                durationUs: 2000000,
                sourceInUs: 0,
                sourceOutUs: 2000000,
              },
            },
          ],
        });
        const exported = await editor.exports.start(project.id, {
          format: 'mp4',
        }).completion;
        let asset: Asset;
        try {
          const rotated = new Uint8Array(await exported.file.arrayBuffer());
          // Version-zero tkhd matrix on the synthetic export's first (video) track.
          const marker = [...rotated].findIndex(
            (_, i) =>
              String.fromCharCode(...rotated.subarray(i, i + 4)) === 'tkhd',
          );
          if (marker < 0)
            throw new Error('Synthetic video track header missing');
          const matrix = new DataView(rotated.buffer);
          [0, 65536, 0, -65536, 0, 0, 0, 0, 1073741824].forEach((value, i) =>
            matrix.setInt32(marker + 44 + i * 4, value),
          );
          asset = await editor.assets.import(
            new File([rotated], 'rotated.mp4', { type: 'video/mp4' }),
            'secret-original.mp4',
          ).completion;
        } finally {
          await exported.dispose();
        }
        const before = (await editor.projects.snapshot(project.id)).revision;
        const run = await editor.assets.analyze(asset.id).completion;
        const evidence = [];
        for (const scene of run.analysis.scenes) {
          const still = scene.artifacts.find((a) => a.kind === 'image')!,
            clip = scene.artifacts.find((a) => a.kind === 'video')!;
          const image = await createImageBitmap(
            await editor.assets.indexes.artifact(run.id, still.id),
          );
          ctx.drawImage(image, 0, 0);
          image.close();
          const pixel = [...ctx.getImageData(50, 30, 1, 1).data];
          const reimport = await editor.assets.import(
            await editor.assets.indexes.artifact(run.id, clip.id),
            'excerpt.mp4',
          ).completion;
          const waveform = await editor.assets.waveform(reimport.id, 100)
            .completion;
          evidence.push({
            pixel,
            kind: reimport.kind,
            hasAudio: !!reimport.audioCodec,
            duration: reimport.durationUs,
            width: reimport.width,
            height: reimport.height,
            rotation: reimport.rotation,
            amplitude: Math.max(...waveform),
          });
        }
        const again = await editor.assets.analyze(asset.id).completion;
        return {
          namespace,
          assetId: asset.id,
          runId: run.id,
          sceneTimes: run.analysis.scenes.map((s) => [
            s.startUs,
            s.endUs,
            s.excerptStartUs,
            s.excerptEndUs,
          ]),
          frames: run.analysis.frames.length,
          evidence,
          runCount: (await editor.assets.indexes.list(asset.id)).length,
          before,
          after: (await editor.projects.snapshot(project.id)).revision,
          repeat:
            JSON.stringify(
              again.analysis.scenes.map((s) => ({ ...s, artifacts: [] })),
            ) ===
            JSON.stringify(
              run.analysis.scenes.map((s) => ({ ...s, artifacts: [] })),
            ),
          timings: {
            scan: run.analysis.scanMs,
            generation: run.analysis.generationMs,
          },
        };
      } finally {
        await editor.dispose();
      }
    }, base);
    expect(result.sceneTimes).toEqual([
      [0, 1000000, 0, 1000000],
      [1000000, 2000000, 1000000, 2000000],
    ]);
    expect(result.frames).toBe(8);
    expect(result.runCount).toBe(2);
    expect(result.before).toBe(result.after);
    expect(result.repeat).toBe(true);
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[0]!.pixel[0]).toBeGreaterThan(230);
    expect(result.evidence[1]!.pixel[2]).toBeGreaterThan(230);
    for (const evidence of result.evidence) {
      expect(evidence.hasAudio).toBe(true);
      expect(evidence.amplitude).toBeGreaterThan(0.1);
      expect(evidence.duration).toBeCloseTo(1000000, -5);
    }
    await test.info().attach('index-timings', {
      body: JSON.stringify(result.timings),
      contentType: 'application/json',
    });
    await page.reload();
    const reopened = await page.evaluate(
      async ({ base, namespace, assetId, runId }) => {
        const { createEditor } = await import(base + 'editor.js');
        const editor = await createEditor({ namespace });
        try {
          const run = await editor.assets.indexes.get(runId);
          const artifact = await editor.assets.indexes.artifact(
            runId,
            run.analysis.scenes[0].artifacts[0].id,
          );
          await editor.assets.indexes.remove(runId);
          return {
            retained: artifact.size,
            remaining: (await editor.assets.indexes.list(assetId)).length,
            sceneTimes: run.analysis.scenes.map(
              (scene: {
                startUs: number;
                endUs: number;
                excerptStartUs: number;
                excerptEndUs: number;
              }) => [
                scene.startUs,
                scene.endUs,
                scene.excerptStartUs,
                scene.excerptEndUs,
              ],
            ),
          };
        } finally {
          await editor.dispose();
        }
      },
      { base, ...result },
    );
    expect(reopened.retained).toBeGreaterThan(0);
    expect(reopened.remaining).toBe(1);
    expect(reopened.sceneTimes).toEqual(result.sceneTimes);
  });
  test(`index recovery cleans unpublished files and preserves completed checkpoints ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const result = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const namespace = 'test-index-recovery-' + crypto.randomUUID(),
        editor = await createEditor({ namespace });
      try {
        const canvas = new OffscreenCanvas(64, 64),
          ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'green';
        ctx.fillRect(0, 0, 64, 64);
        const asset = await editor.assets.import(await canvas.convertToBlob())
          .completion;
        const first = await editor.assets.analyze(asset.id).completion;
        const raw = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(namespace + '-asset-index-v1');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const abandonedId = crypto.randomUUID(),
          pendingFile = crypto.randomUUID();
        await new Promise<void>((resolve, reject) => {
          const tx = raw.transaction(['runs', 'journal'], 'readwrite');
          tx.objectStore('runs').put({
            ...first,
            id: abandonedId,
            status: 'analyzing',
          });
          tx.objectStore('journal').put({
            id: pendingFile,
            runId: abandonedId,
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        raw.close();
        const root = await (
          await (
            await navigator.storage.getDirectory()
          ).getDirectoryHandle(namespace)
        ).getDirectoryHandle('asset-index');
        const writer = await (
          await root.getFileHandle(pendingFile, { create: true })
        ).createWritable();
        await writer.write(new Uint8Array([1, 2, 3]));
        await writer.close();
        const recovered = await editor.assets.indexes.get(abandonedId);
        let exists = true;
        try {
          await root.getFileHandle(pendingFile);
        } catch {
          exists = false;
        }
        const retained = await editor.assets.indexes.artifact(
          first.id,
          first.analysis.scenes[0]!.artifacts[0]!.id,
        );
        const retry = await editor.assets.analyze(asset.id, abandonedId)
          .completion;
        const originalRoot = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle(namespace);
        await originalRoot.removeEntry(asset.id);
        await editor.assets.relink(asset.id, await canvas.convertToBlob())
          .completion;
        const invalidated = await editor.assets.indexes.list(asset.id);
        return {
          status: recovered.status,
          exists,
          retained: retained.size,
          retryArtifacts: retry.analysis.scenes[0]!.artifacts.length,
          allInvalid: invalidated.every((r) => r.invalidated),
        };
      } finally {
        await editor.dispose();
      }
    }, base);
    expect(result).toMatchObject({
      status: 'cancelled',
      exists: false,
      retryArtifacts: 1,
      allInvalid: true,
    });
    expect(result.retained).toBeGreaterThan(0);
  });
}

test('local index publication rejects quota failures and incomplete checkpoints', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createEditor } = (await import(
      String('/editor.js')
    )) as typeof import('../../src/editor');
    const namespace = 'test-index-races-' + crypto.randomUUID(),
      editor = await createEditor({ namespace });
    try {
      const canvas = new OffscreenCanvas(24, 32);
      canvas.getContext('2d')!.fillRect(0, 0, 24, 32);
      const asset = await editor.assets.import(await canvas.convertToBlob())
        .completion;
      const initial = await editor.assets.analyze(asset.id).completion;
      const draftLabel = {
        summary: 'Incomplete',
        subjects: [],
        scene: '',
        style: '',
        tags: [],
        sound: '',
      };
      await editor.assets.indexes.recordRequest(
        initial.id,
        {
          id: 'premature',
          prompt: 'Summary',
          model: 'test',
          artifactIds: [],
          createdAt: 0,
        },
        new AbortController().signal,
      );
      let premature = '';
      try {
        await editor.assets.indexes.recordResponse(
          initial.id,
          'premature',
          JSON.stringify(draftLabel),
          draftLabel,
          undefined,
          'test',
          undefined,
          new AbortController().signal,
        );
      } catch (error) {
        premature = (error as { code: string }).code;
      }
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (
        ...args: Parameters<typeof transaction>
      ) {
        if (
          this.name === namespace + '-asset-index-v1' &&
          args[1] === 'readwrite'
        )
          throw new DOMException(
            'Synthetic full storage',
            'QuotaExceededError',
          );
        return transaction.apply(this, args);
      };
      let quota = '';
      try {
        await editor.assets.indexes.status(initial.id, 'failed', 'test');
      } catch (e) {
        quota = (e as { code: string }).code;
      } finally {
        IDBDatabase.prototype.transaction = transaction;
      }
      return {
        quota,
        premature,
        artifacts: initial.analysis.scenes[0]!.artifacts.map((a) => a.id),
      };
    } finally {
      await editor.dispose();
    }
  });
  expect(result).toMatchObject({
    quota: 'QUOTA_EXCEEDED',
    premature: 'INVALID_DOCUMENT',
  });
  expect(result.artifacts).toHaveLength(1);
});

test('another tab preserves an active index lease and recovers an abandoned deletion', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const source = await page.evaluate(async () => {
    const { createEditor } = (await import(
      String('/editor.js')
    )) as typeof import('../../src/editor');
    window.indexNamespace = 'test-index-tabs-' + crypto.randomUUID();
    window.indexEditor = await createEditor({
      namespace: window.indexNamespace,
    });
    const canvas = new OffscreenCanvas(16, 16);
    canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
    const asset = await window.indexEditor.assets.import(
      await canvas.convertToBlob(),
    ).completion;
    const run = await window.indexEditor.assets.analyze(asset.id).completion;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    window.indexLease = window.indexEditor.assets.indexes.withRun(
      run.id,
      async () => {
        await window.indexEditor.assets.indexes.recordRequest(
          run.id,
          {
            id: 'request',
            prompt: 'Synthetic',
            model: 'test',
            artifactIds: [],
            createdAt: 0,
          },
          new AbortController().signal,
        );
        entered();
        await new Promise<void>((resolve) => {
          window.releaseIndex = resolve;
        });
      },
      new AbortController().signal,
    );
    await ready;
    return {
      namespace: window.indexNamespace,
      runId: run.id,
      artifactId: run.analysis.scenes[0]!.artifacts[0]!.id,
    };
  });
  const other = await context.newPage();
  await other.goto('/LocalCut/');
  const active = await other.evaluate(async ({ namespace, runId }) => {
    const { createEditor } = (await import(
      String('/LocalCut/editor.js')
    )) as typeof import('../../src/editor');
    window.indexEditor = await createEditor({ namespace });
    return (await window.indexEditor.assets.indexes.get(runId)).status;
  }, source);
  expect(active).toBe('labeling');
  await page.evaluate(async () => {
    window.releaseIndex();
    await window.indexLease;
    await window.indexEditor.dispose();
  });
  const recovered = await other.evaluate(
    async ({ namespace, runId, artifactId }) => {
      const run = await window.indexEditor.assets.indexes.get(runId);
      const db = await new Promise<IDBDatabase>((resolve) => {
        const req = indexedDB.open(namespace + '-asset-index-v1');
        req.onsuccess = () => resolve(req.result);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('runs', 'readwrite');
        tx.objectStore('runs').put({
          ...run,
          deleting: true,
          invalidated: true,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      const runs = await window.indexEditor.assets.indexes.list();
      const root = await (
        await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle(namespace)
      ).getDirectoryHandle('asset-index');
      let file = true;
      try {
        await root.getFileHandle(artifactId);
      } catch {
        file = false;
      }
      await window.indexEditor.dispose();
      return { status: run.status, count: runs.length, file };
    },
    source,
  );
  expect(recovered).toEqual({ status: 'cancelled', count: 0, file: false });
  await other.close();
});

for (const base of behaviorBases) {
  test(`native audio indexing retains timed stereo excerpts without remote labeling ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const result = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        String(base + 'editor.js')
      )) as typeof import('../../src/editor');
      const editor = await createEditor({
        namespace: 'test-audio-index-' + crypto.randomUUID(),
      });
      try {
        const sampleRate = 44100,
          frames = sampleRate * 6,
          buffer = new ArrayBuffer(44 + frames * 2),
          view = new DataView(buffer);
        const text = (at: number, value: string) =>
          [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
        text(0, 'RIFF');
        view.setUint32(4, buffer.byteLength - 8, true);
        text(8, 'WAVEfmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        text(36, 'data');
        view.setUint32(40, frames * 2, true);
        for (let i = 0; i < frames; i++) {
          const seconds = i / sampleRate;
          const tone =
            (seconds >= 1 && seconds < 2) || (seconds >= 3 && seconds < 5);
          view.setInt16(
            44 + i * 2,
            tone ? Math.sin((i / sampleRate) * 2 * Math.PI * 440) * 16000 : 0,
            true,
          );
        }
        const asset = await editor.assets.import(
          new File([buffer], 'private-name.wav', { type: 'audio/wav' }),
        ).completion;
        const run = await editor.assets.analyze(asset.id).completion;
        const excerpts = [];
        for (const scene of run.analysis.scenes) {
          const file = await editor.assets.indexes.artifact(
            run.id,
            scene.artifacts[0]!.id,
          );
          const imported = await editor.assets.import(file).completion;
          const waveform = await editor.assets.waveform(imported.id, 32)
            .completion;
          excerpts.push({
            type: file.type,
            duration: imported.durationUs,
            channels: imported.channels,
            sampleRate: imported.sampleRate,
            peak: Math.max(...waveform),
          });
        }
        return {
          status: run.status,
          frames: run.analysis.frames.length,
          windows: run.analysis.audio?.length,
          sceneTimes: run.analysis.scenes.map((s) => [s.startUs, s.endUs]),
          excerpts,
          retained: (await editor.assets.indexes.list(asset.id)).length,
        };
      } finally {
        await editor.dispose();
      }
    }, base);
    expect(result).toMatchObject({
      status: 'analyzed',
      frames: 0,
      windows: 24,
      retained: 1,
    });
    expect(result.sceneTimes).toEqual([
      [0, 1000000],
      [1000000, 2000000],
      [2000000, 3000000],
      [3000000, 5000000],
      [5000000, 6000000],
    ]);
    for (const [i, audio] of result.excerpts.entries()) {
      expect(audio).toMatchObject({
        type: 'audio/wav',
        channels: 2,
        sampleRate: 48000,
      });
      expect(audio.duration).toBe(i === 3 ? 2000000 : 1000000);
      if (i === 1 || i === 3) expect(audio.peak).toBeGreaterThan(0.3);
      else expect(audio.peak).toBeLessThan(0.01);
    }
  });
}
