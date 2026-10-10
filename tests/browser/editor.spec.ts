import { test, expect } from '@playwright/test';
import type { Editor, Project, Asset } from '../../src/editor/index';
declare global {
  interface Window {
    editor: Editor;
    project: Project;
    asset: Asset;
  }
}
for (const base of ['/', '/LocalCut/']) {
  test(`inert initial workspace ${base}`, async ({ page }) => {
    const errors: string[] = [],
      requests: string[] = [],
      workers: string[] = [],
      dialogs: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('request', (r) => requests.push(r.url()));
    page.on('worker', (worker) => workers.push(worker.url()));
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    await page.goto(base);
    await expect(page).toHaveTitle('LocalCut');
    await page.waitForTimeout(300);
    await expect(
      page.getByRole('button', { name: 'Commands', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Open project', exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
    expect(workers).toEqual([]);
    expect(dialogs).toEqual([]);
    expect(requests.every((url) => url.startsWith('http://127.0.0.1:'))).toBe(
      true,
    );
    expect(
      requests.some((url) => /editor\.js|worker|onnx|whisper|wasm/.test(url)),
    ).toBe(false);
    expect(
      await page.evaluate(async () => ({
        dbs: await indexedDB.databases(),
        storage: Object.keys(localStorage),
      })),
    ).toEqual({ dbs: [], storage: [] });
  });
  test(`production commands/persistence/frames/export ${base}`, async ({
    page,
    context,
  }) => {
    await page.goto(base);
    const result = await page.evaluate(
      async ({ base }) => {
        const { createEditor } = (await import(
          base + 'editor.js'
        )) as typeof import('../../src/editor/index');
        const namespace = 'test-' + crypto.randomUUID(),
          editor = await createEditor({ namespace });
        window.editor = editor;
        const project = await editor.projects.create('Native test', {
          width: 256,
          height: 144,
        });
        window.project = project;
        const canvas = new OffscreenCanvas(256, 144),
          ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'red';
        ctx.fillRect(0, 0, 256, 144);
        const image = new File(
          [await canvas.convertToBlob({ type: 'image/png' })],
          'red.png',
          { type: 'image/png' },
        );
        const asset = await editor.assets.import(image).completion;
        window.asset = asset;
        const batch = {
          projectId: project.id,
          requestId: 'assemble',
          expectedRevision: 0,
          operations: [
            {
              type: 'addTrack' as const,
              track: { id: 'video', kind: 'video' as const },
            },
            {
              type: 'insertClip' as const,
              trackId: 'video',
              clip: {
                id: 'image',
                kind: 'image' as const,
                assetId: asset.id,
                startUs: 0,
                durationUs: 500000,
                width: 256,
                height: 144,
              },
            },
          ],
        };
        const receipt = await editor.commands.apply(batch);
        const replay = await editor.commands.apply(batch);
        let failed = false;
        try {
          await editor.commands.apply({
            projectId: project.id,
            requestId: 'bad',
            expectedRevision: 1,
            operations: [
              { type: 'updateClip', clipId: 'image', patch: { opacity: 0.5 } },
              { type: 'removeClip', clipId: 'missing' },
            ],
          });
        } catch {
          failed = true;
        }
        const unchanged = await editor.projects.snapshot(project.id);
        const frame = await editor.preview.frame(project.id, 250000).completion;
        ctx.drawImage(frame.image, 0, 0);
        frame.image.close();
        const pixel = [...ctx.getImageData(50, 50, 1, 1).data];
        const exports: Record<
          string,
          { bytes: number; durationUs: number; pixel: number[] }
        > = {};
        for (const format of ['mp4', 'webm'] as const) {
          const caps = await editor.exports.preflight(project.id, { format })
            .completion;
          if (!caps.supported)
            throw new Error(
              'Required Chrome codec missing: ' +
                format +
                ' ' +
                JSON.stringify(caps),
            );
          const artifact = await editor.exports.start(project.id, { format })
            .completion;
          const decoded = await editor.assets.import(
            new File([artifact.file], 'result.' + format, {
              type: format === 'mp4' ? 'video/mp4' : 'video/webm',
            }),
          ).completion;
          const p = await editor.projects.create('decode', {
            width: 256,
            height: 144,
          });
          await editor.commands.apply({
            projectId: p.id,
            requestId: 'decode',
            expectedRevision: 0,
            operations: [
              {
                type: 'addTrack',
                track: { id: 'decode-track', kind: 'video' },
              },
              {
                type: 'insertClip',
                trackId: 'decode-track',
                clip: {
                  id: 'decoded',
                  kind: 'video',
                  assetId: decoded.id,
                  startUs: 0,
                  durationUs: decoded.durationUs,
                  sourceOutUs: decoded.durationUs,
                  width: 256,
                  height: 144,
                },
              },
            ],
          });
          const f = await editor.preview.frame(p.id, 200000).completion;
          ctx.drawImage(f.image, 0, 0);
          f.image.close();
          exports[format] = {
            bytes: artifact.file.size,
            durationUs: decoded.durationUs,
            pixel: [...ctx.getImageData(50, 50, 1, 1).data],
          };
          await artifact.dispose();
        }
        await editor.commands.undo(project.id, 'undo', 1);
        await editor.commands.redo(project.id, 'redo', 2);
        await editor.dispose();
        window.editor = await createEditor({ namespace });
        const restored = await window.editor.projects.open(project.id);
        return {
          namespace,
          projectId: project.id,
          receipt,
          replay,
          failed,
          unchangedRevision: unchanged.revision,
          pixel,
          exports,
          restoredRevision: restored.revision,
        };
      },
      { base },
    );
    expect(result.receipt).toEqual(result.replay);
    expect(result.failed).toBe(true);
    expect(result.unchangedRevision).toBe(1);
    expect(result.pixel).toEqual([255, 0, 0, 255]);
    expect(result.restoredRevision).toBe(3);
    for (const artifact of Object.values(result.exports)) {
      expect(artifact.bytes).toBeGreaterThan(100);
      expect(artifact.durationUs).toBeGreaterThanOrEqual(490000);
      expect(artifact.durationUs).toBeLessThan(550000);
      expect(artifact.pixel[0]).toBeGreaterThan(240);
      expect(artifact.pixel[1]).toBeLessThan(15);
    }
    const other = await context.newPage();
    await other.goto(base);
    await other.evaluate(
      async ({ base, namespace }) => {
        const { createEditor } = (await import(
          base + 'editor.js'
        )) as typeof import('../../src/editor/index');
        window.editor = await createEditor({ namespace });
      },
      { base, namespace: result.namespace },
    );
    const mutate = (id: string) => ({
      projectId: result.projectId,
      requestId: id,
      expectedRevision: 3,
      operations: [
        {
          type: 'updateClip' as const,
          clipId: 'image',
          patch: { opacity: 0.5 },
        },
      ],
    });
    const races = await Promise.all([
      page.evaluate(async (b) => {
        try {
          await window.editor.commands.apply(b);
          return 'ok';
        } catch (e) {
          return (e as { code: string }).code;
        }
      }, mutate('a')),
      other.evaluate(async (b) => {
        try {
          await window.editor.commands.apply(b);
          return 'ok';
        } catch (e) {
          return (e as { code: string }).code;
        }
      }, mutate('b')),
    ]);
    expect(races.sort()).toEqual(['REVISION_CONFLICT', 'ok']);
    await other.evaluate(() => window.editor.dispose());
    await page.evaluate(() => window.editor.dispose());
  });
}
test('effects, text, waveform, speed, cancellation and preview session', async ({
  page,
}) => {
  await page.goto('/LocalCut/');
  const result = await page.evaluate(async () => {
    const { createEditor } = (await import(
      String('/LocalCut/editor.js')
    )) as typeof import('../../src/editor/index');
    const editor = await createEditor({
      namespace: 'test-' + crypto.randomUUID(),
    });
    const p = await editor.projects.create('audio', {
      width: 256,
      height: 144,
    });
    const data = new ArrayBuffer(44 + 48000 * 2),
      view = new DataView(data),
      write = (offset: number, s: string) => {
        for (let i = 0; i < s.length; i++)
          view.setUint8(offset + i, s.charCodeAt(i));
      };
    write(0, 'RIFF');
    view.setUint32(4, data.byteLength - 8, true);
    write(8, 'WAVE');
    write(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 48000, true);
    view.setUint32(28, 96000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, 'data');
    view.setUint32(40, 96000, true);
    for (let i = 0; i < 48000; i++)
      view.setInt16(
        44 + i * 2,
        Math.sin((i * 2 * Math.PI * 440) / 48000) * 16000,
        true,
      );
    const asset = await editor.assets.import(
      new File([data], 'tone.wav', { type: 'audio/wav' }),
    ).completion;
    await editor.commands.apply({
      projectId: p.id,
      requestId: 'assemble',
      expectedRevision: 0,
      operations: [
        { type: 'addTrack', track: { id: 'audio', kind: 'audio' } },
        {
          type: 'insertClip',
          trackId: 'audio',
          clip: {
            id: 'tone',
            kind: 'audio',
            assetId: asset.id,
            startUs: 0,
            durationUs: 500000,
            sourceOutUs: 1000000,
            speed: 2,
          },
        },
        { type: 'addTrack', track: { id: 'overlay', kind: 'overlay' } },
        {
          type: 'insertClip',
          trackId: 'overlay',
          clip: {
            id: 'text',
            kind: 'text',
            startUs: 0,
            durationUs: 500000,
            width: 256,
            height: 144,
            text: {
              text: 'LocalCut',
              fontSize: 32,
              color: '#ffffff',
              background: 'red',
              align: 'left',
            },
          },
        },
      ],
    });
    const wave = await editor.assets.waveform(asset.id, 100).completion;
    const thumbsError = await editor.assets
      .thumbnails(asset.id, [0])
      .completion.then(
        () => '',
        (e: Error) => e.message,
      );
    const frame = await editor.preview.frame(p.id, 100000).completion;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 144;
    canvas.getContext('2d')!.drawImage(frame.image, 0, 0);
    frame.image.close();
    const pixel = [...canvas.getContext('2d')!.getImageData(1, 1, 1, 1).data];
    const cancelled = editor.exports.start(p.id, { format: 'webm' });
    cancelled.cancel();
    const cancellation = await cancelled.completion.then(
      () => '',
      (e: { code: string }) => e.code,
    );
    const audio = new AudioContext();
    const session = editor.preview.session(p.id, canvas, audio);
    await session.seek(200000);
    const time = session.currentTimeUs;
    session.dispose();
    await audio.close();
    await editor.dispose();
    return {
      maxWave: Math.max(...wave),
      thumbsError,
      pixel,
      cancellation,
      time,
    };
  });
  expect(result.maxWave).toBeGreaterThan(0.4);
  expect(result.thumbsError).not.toBe('');
  expect(result.pixel).toEqual([255, 0, 0, 255]);
  expect(result.cancellation).toBe('CANCELLED');
  expect(result.time).toBe(200000);
});
