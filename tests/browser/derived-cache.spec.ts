import { test, expect } from '@playwright/test';
import { mediaVideo } from './workspace-video-fixture';
import type { Derivative } from '../../src/storage/store';

for (const base of ['/', '/LocalCut/']) {
  test(`derived media survives refresh without native recomputation ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const saved = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const namespace = 'test-' + crypto.randomUUID();
      const editor = await createEditor({ namespace });
      window.editor = editor;
      const canvas = new OffscreenCanvas(32, 16),
        ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'red';
      ctx.fillRect(0, 0, 32, 16);
      const image = await editor.assets.import(
        new File(
          [
            await canvas.convertToBlob({ type: 'image/png' }),
            new Uint8Array(128),
          ],
          'red.png',
          { type: 'image/png' },
        ),
      ).completion;
      const count = 48000,
        buffer = new ArrayBuffer(44 + count * 2),
        header = new DataView(buffer);
      const text = (at: number, value: string) => {
        for (let i = 0; i < value.length; i++)
          header.setUint8(at + i, value.charCodeAt(i));
      };
      text(0, 'RIFF');
      header.setUint32(4, buffer.byteLength - 8, true);
      text(8, 'WAVE');
      text(12, 'fmt ');
      header.setUint32(16, 16, true);
      header.setUint16(20, 1, true);
      header.setUint16(22, 1, true);
      header.setUint32(24, 48000, true);
      header.setUint32(28, 96000, true);
      header.setUint16(32, 2, true);
      header.setUint16(34, 16, true);
      text(36, 'data');
      header.setUint32(40, count * 2, true);
      for (let i = 0; i < count; i++)
        header.setInt16(44 + i * 2, Math.round(Math.sin(i / 20) * 16384), true);
      const audio = await editor.assets.import(
        new File([buffer], 'tone.wav', { type: 'audio/wav' }),
      ).completion;
      const stages: string[][] = [];
      const other = await createEditor({ namespace });
      const jobs = [
        editor.assets.waveform(audio.id, 32),
        other.assets.waveform(audio.id, 32),
      ];
      jobs.forEach((job, i) => {
        stages[i] = [];
        job.subscribe((event) => stages[i]!.push(event.stage));
      });
      const peaks = await Promise.all(jobs.map((job) => job.completion));
      const tiles = await editor.assets.thumbnails(image.id, [0, 100], 32)
        .completion;
      const sheet = await editor.assets.contactSheet(image.id, [0, 100], 32)
        .completion;
      const digest = async (blob: Blob) => [
        ...new Uint8Array(
          await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()),
        ),
      ];
      const result = {
        namespace,
        image: image.id,
        audio: audio.id,
        peaks: [...peaks[0]!],
        equal: peaks[0]!.every((value, i) => value === peaks[1]![i]),
        stages,
        tiles: await Promise.all(tiles.map((tile) => digest(tile.blob))),
        sheet: await digest(sheet.blob),
      };
      await other.dispose();
      await editor.dispose();
      return result;
    }, base);
    expect(saved.equal).toBe(true);
    expect(Math.max(...saved.peaks)).toBeCloseTo(0.5, 2);
    await page.reload();
    const workers: string[] = [];
    page.on('worker', (worker) => workers.push(worker.url()));
    const cacheRead = await page.evaluate(
      async ({ base, saved }) => {
        const { createEditor } = (await import(
          base + 'editor.js'
        )) as typeof import('../../src/editor');
        window.editor = await createEditor({ namespace: saved.namespace });
        const before = (await window.editor.tasks.list()).length;
        const events: { jobId: string; stage: string }[] = [];
        const stop = window.editor.events.jobs((event) =>
          events.push({ jobId: event.jobId, stage: event.stage }),
        );
        const job = window.editor.assets.thumbnails(
          saved.image,
          [100, 0, 100],
          32,
        );
        const tiles = await job.completion;
        const empty = await window.editor.assets.thumbnails(
          'empty-request',
          [],
          32,
        ).completion;
        stop();
        return {
          before,
          after: (await window.editor.tasks.list()).length,
          events: events.filter((event) => event.jobId === job.id),
          times: tiles.map((tile) => tile.timeUs),
          task: !!(await window.editor.tasks.get(job.id)),
          empty,
        };
      },
      { base, saved },
    );
    expect(cacheRead).toEqual({
      before: cacheRead.before,
      after: cacheRead.before,
      events: [],
      times: [100, 0, 100],
      task: false,
      empty: [],
    });
    expect(workers).toEqual([]);
    const cancellation = await page.evaluate(
      async ({ base, saved }) => {
        const { createEditor } = (await import(
          base + 'editor.js'
        )) as typeof import('../../src/editor');
        const other = await createEditor({ namespace: saved.namespace });
        const before = (await other.tasks.list()).length;
        let release!: () => void;
        let entered!: () => void;
        const ready = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const hold = new Promise<void>((resolve) => {
          release = resolve;
        });
        const locked = navigator.locks.request(
          `${saved.namespace}:asset:${saved.image}`,
          async () => {
            entered();
            await hold;
          },
        );
        await ready;
        try {
          const cancelled = other.assets.thumbnails(saved.image, [0], 31);
          cancelled.cancel();
          const disposed = other.assets.thumbnails(saved.image, [0], 30);
          await other.dispose();
          const codes = await Promise.all(
            [cancelled, disposed].map((job) =>
              job.completion.catch((error: { code: string }) => error.code),
            ),
          );
          return {
            codes,
            before,
            after: (await window.editor.tasks.list()).length,
          };
        } finally {
          release();
          await locked;
          await other.dispose();
        }
      },
      { base, saved },
    );
    expect(cancellation).toEqual({
      codes: ['CANCELLED', 'CANCELLED'],
      before: cacheRead.before,
      after: cacheRead.before,
    });
    await page.evaluate(() => {
      const encode = OffscreenCanvas.prototype.convertToBlob;
      const bitmap = globalThis.createImageBitmap;
      const audio = AudioDecoder.prototype.configure;
      const video = VideoDecoder.prototype.configure;
      const fail = () => {
        throw new Error(
          'Unexpected native recomputation on a persistent cache hit',
        );
      };
      OffscreenCanvas.prototype.convertToBlob = fail;
      globalThis.createImageBitmap = fail;
      AudioDecoder.prototype.configure = fail;
      VideoDecoder.prototype.configure = fail;
      (
        globalThis as typeof globalThis & { restoreCacheProbes: () => void }
      ).restoreCacheProbes = () => {
        OffscreenCanvas.prototype.convertToBlob = encode;
        globalThis.createImageBitmap = bitmap;
        AudioDecoder.prototype.configure = audio;
        VideoDecoder.prototype.configure = video;
      };
    });
    const replay = await page.evaluate(async (saved) => {
      const editor = window.editor;
      const beforeTasks = (await editor.tasks.list()).length;
      const stages: string[] = [],
        job = editor.assets.waveform(saved.audio, 32);
      job.subscribe((event) => stages.push(event.stage));
      const peaks = await job.completion;
      const tiles = await editor.assets.thumbnails(
        saved.image,
        [100, 0, 100],
        32,
      ).completion;
      const sheet = await editor.assets.contactSheet(saved.image, [0, 100], 32)
        .completion;
      const pcm = await editor.assets.derivative(saved.audio, 'pcm').completion;
      const digest = async (blob: Blob) => [
        ...new Uint8Array(
          await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()),
        ),
      ];
      return {
        peaks: [...peaks],
        stages,
        tiles: await Promise.all(tiles.map((tile) => digest(tile.blob))),
        sheet: await digest(sheet.blob),
        pcmSize: pcm.size,
        beforeTasks,
        afterTasks: (await editor.tasks.list()).length,
      };
    }, saved);
    expect(replay.afterTasks).toBe(replay.beforeTasks);
    expect(workers).toEqual([]);
    expect(replay.peaks).toEqual(saved.peaks);
    expect(replay.stages).not.toContain('waveform');
    expect(replay.tiles).toEqual([
      saved.tiles[1],
      saved.tiles[0],
      saved.tiles[1],
    ]);
    expect(replay.sheet).toEqual(saved.sheet);
    expect(replay.pcmSize).toBeGreaterThan(48000 * 8);
    await page.evaluate(() =>
      (
        globalThis as typeof globalThis & { restoreCacheProbes: () => void }
      ).restoreCacheProbes(),
    );

    const variants = await page.evaluate(async (saved) => {
      const editor = window.editor;
      const peaks = await editor.assets.waveform(saved.audio, 16).completion;
      const tile = (
        await editor.assets.thumbnails(saved.image, [0], 16).completion
      )[0]!;
      const image = await createImageBitmap(tile.blob);
      const dimensions = [image.width, image.height];
      image.close();
      const reordered = await editor.assets.contactSheet(
        saved.image,
        [100, 0],
        16,
      ).completion;
      const bitmap = await createImageBitmap(reordered.blob);
      const sheetDimensions = [bitmap.width, bitmap.height];
      bitmap.close();
      let invalid = false;
      try {
        await editor.assets.thumbnails(saved.image, [0], 0).completion;
      } catch {
        invalid = true;
      }
      return { bins: peaks.length, dimensions, sheetDimensions, invalid };
    }, saved);
    expect(variants).toEqual({
      bins: 16,
      dimensions: [16, 8],
      sheetDimensions: [32, 8],
      invalid: true,
    });

    const recovery = await page.evaluate(async (saved) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(saved.namespace + '-v1');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const records = await new Promise<Derivative[]>((resolve, reject) => {
        const request = db
          .transaction('derivatives')
          .objectStore('derivatives')
          .getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const root = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle(saved.namespace);
      const peaks = records.find(
        (record) => record.id === `waveform-v1-${saved.audio}-32`,
      )!;
      const tile = records.find(
        (record) => record.id === `thumbnail-v1-${saved.image}-32-0`,
      )!;
      await root.removeEntry(peaks.path);
      const writer = await (
        await root.getFileHandle(tile.path)
      ).createWritable();
      await writer.write(new Uint8Array(tile.size));
      await writer.close();
      const stages: string[] = [],
        job = window.editor.assets.waveform(saved.audio, 32);
      job.subscribe((event) => stages.push(event.stage));
      const result = [...(await job.completion)];
      const repaired = (
        await window.editor.assets.thumbnails(saved.image, [0], 32).completion
      )[0]!;
      const bitmap = await createImageBitmap(repaired.blob);
      const width = bitmap.width;
      bitmap.close();
      // Relink a same-size image with new pixels; facade reads must retire old tiles.
      const imageFile = await (await root.getFileHandle(saved.image)).getFile();
      const blue = new OffscreenCanvas(32, 16);
      blue.getContext('2d')!.fillStyle = 'blue';
      blue.getContext('2d')!.fillRect(0, 0, 32, 16);
      const blueBytes = await blue.convertToBlob({ type: 'image/png' });
      await root.removeEntry(saved.image);
      await window.editor.assets.relink(
        saved.image,
        new File(
          [blueBytes, new Uint8Array(imageFile.size - blueBytes.size)],
          'blue.png',
          { type: 'image/png' },
        ),
      ).completion;
      const beforeRelinkedTile = (await window.editor.tasks.list()).length;
      const relinkedTile = window.editor.assets.thumbnails(
        saved.image,
        [0],
        32,
      );
      const relinkedBlob = (await relinkedTile.completion)[0]!.blob;
      const relinkedBitmap = await createImageBitmap(relinkedBlob);
      const pixels = new OffscreenCanvas(1, 1);
      pixels.getContext('2d')!.drawImage(relinkedBitmap, 0, 0, 1, 1);
      relinkedBitmap.close();
      const relinkedPixel = [
        ...pixels.getContext('2d')!.getImageData(0, 0, 1, 1).data,
      ];
      const relinkedTask = await window.editor.tasks.get(relinkedTile.id);
      await window.editor.assets.thumbnails(saved.image, [0], 32).completion;
      const afterRelinkedTile = (await window.editor.tasks.list()).length;
      // A same-size/same-duration replacement must retire PCM as well as peaks.
      const original = await (await root.getFileHandle(saved.audio)).getFile();
      const replacement = await original.arrayBuffer(),
        samples = new DataView(replacement);
      // Original is PCM-s16 WAV, so replace its samples with a constant amplitude.
      for (let at = 44; at < replacement.byteLength; at += 2)
        samples.setInt16(at, 4096, true);
      await root.removeEntry(saved.audio);
      await window.editor.assets.relink(
        saved.audio,
        new File([replacement], 'replacement.wav', { type: 'audio/wav' }),
      ).completion;
      const relinked = [
        ...(await window.editor.assets.waveform(saved.audio, 32).completion),
      ];
      const final = await new Promise<Derivative[]>((resolve) => {
        const request = db
          .transaction('derivatives')
          .objectStore('derivatives')
          .getAll();
        request.onsuccess = () => resolve(request.result);
      });
      db.close();
      await window.editor.dispose();
      return {
        result,
        stages,
        width,
        relinked,
        relinkedPixel,
        relinkedTask: relinkedTask?.state,
        newTileTasks: afterRelinkedTile - beforeRelinkedTile,
        oldBinsRemoved: !final.some(
          (record) => record.id === `waveform-v1-${saved.audio}-16`,
        ),
      };
    }, saved);
    expect(recovery.result).toEqual(saved.peaks);
    expect(recovery.width).toBe(32);
    expect(recovery.relinkedPixel[0]).toBeLessThan(10);
    expect(recovery.relinkedPixel[2]).toBeGreaterThan(245);
    expect(recovery.relinkedTask).toBe('completed');
    expect(recovery.newTileTasks).toBe(1);
    expect(Math.max(...recovery.relinked)).toBeCloseTo(0.125, 2);
    expect(recovery.oldBinsRemoved).toBe(true);
  });
  test(`video thumbnail derivatives reuse a delayed native source after refresh ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const fixture = await mediaVideo(page, 1);
    const saved = await page.evaluate(
      async ({ base, bytes, mimeType }) => {
        const { createEditor } = (await import(
          base + 'editor.js'
        )) as typeof import('../../src/editor');
        const namespace = 'test-' + crypto.randomUUID();
        window.editor = await createEditor({ namespace });
        const asset = await window.editor.assets.import(
          new File([new Uint8Array(bytes)], 'delayed.webm', { type: mimeType }),
        ).completion;
        const tiles = await window.editor.assets.thumbnails(
          asset.id,
          [0, 1000000],
          64,
        ).completion;
        const sheet = await window.editor.assets.contactSheet(
          asset.id,
          [0, 1000000],
          64,
        ).completion;
        const bitmap = await createImageBitmap(tiles[0]!.blob);
        const canvas = new OffscreenCanvas(64, 36),
          context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        const pixel = [...context.getImageData(8, 8, 1, 1).data];
        const result = {
          namespace,
          assetId: asset.id,
          sizes: tiles.map((tile) => tile.blob.size),
          sheetSize: sheet.blob.size,
          pixel,
        };
        await window.editor.dispose();
        return result;
      },
      { base, bytes: [...fixture.buffer], mimeType: fixture.mimeType },
    );
    expect(saved.pixel[1]).toBeGreaterThan(240);
    expect(saved.pixel[0]).toBeLessThan(15);
    await page.reload();
    const workers: string[] = [];
    page.on('worker', (worker) => workers.push(worker.url()));
    await page.evaluate(
      async ({ base, saved }) => {
        const { createEditor } = (await import(
          base + 'editor.js'
        )) as typeof import('../../src/editor');
        window.editor = await createEditor({ namespace: saved.namespace });
      },
      { base, saved },
    );
    await page.evaluate(() => {
      const fail = () => {
        throw new Error('Cache hit opened a video decoder or encoded a canvas');
      };
      VideoDecoder.prototype.configure = fail;
      OffscreenCanvas.prototype.convertToBlob = fail;
    });
    const replay = await page.evaluate(async (saved) => {
      const tiles = await window.editor.assets.thumbnails(
        saved.assetId,
        [1000000, 0],
        64,
      ).completion;
      const sheet = await window.editor.assets.contactSheet(
        saved.assetId,
        [0, 1000000],
        64,
      ).completion;
      await window.editor.dispose();
      return {
        sizes: tiles.map((tile) => tile.blob.size),
        sheetSize: sheet.blob.size,
      };
    }, saved);
    expect(workers).toEqual([]);
    expect(replay).toEqual({
      sizes: [...saved.sizes].reverse(),
      sheetSize: saved.sheetSize,
    });
  });
}
