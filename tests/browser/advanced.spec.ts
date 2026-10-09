import { test, expect } from '@playwright/test';
test('crossfade/black composition, audio retiming, recovery and owned cleanup', async ({
  page,
}) => {
  await page.goto('/LocalCut/');
  const result = await page.evaluate(async () => {
    const { createEditor } = (await import(
        String('/LocalCut/editor.js')
      )) as typeof import('../../src/editor/index'),
      namespace = 'test-' + crypto.randomUUID(),
      editor = await createEditor({ namespace });
    const p = await editor.projects.create('transition', {
        width: 256,
        height: 144,
      }),
      sourceCanvas = new OffscreenCanvas(256, 144),
      ctx = sourceCanvas.getContext('2d')!;
    const videos: string[] = [];
    for (const color of ['red', 'blue']) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 256, 144);
      const image = await editor.assets.import(
        new File([await sourceCanvas.convertToBlob()], 'color.png', {
          type: 'image/png',
        }),
      ).completion;
      const q = await editor.projects.create(color, {
        width: 256,
        height: 144,
      });
      await editor.commands.apply({
        projectId: q.id,
        requestId: 'assemble',
        expectedRevision: 0,
        operations: [
          { type: 'addTrack', track: { id: 't', kind: 'video' } },
          {
            type: 'insertClip',
            trackId: 't',
            clip: {
              id: 'c',
              kind: 'image',
              assetId: image.id,
              startUs: 0,
              durationUs: 1000000,
              width: 256,
              height: 144,
            },
          },
        ],
      });
      const artifact = await editor.exports.start(q.id, { format: 'webm' })
        .completion;
      videos.push(
        (
          await editor.assets.import(
            new File([artifact.file], 'source.webm', { type: 'video/webm' }),
          ).completion
        ).id,
      );
      await artifact.dispose();
    }
    await editor.commands.apply({
      projectId: p.id,
      requestId: 'assemble',
      expectedRevision: 0,
      operations: [
        { type: 'addTrack', track: { id: 'lower', kind: 'overlay' } },
        {
          type: 'insertClip',
          trackId: 'lower',
          clip: {
            id: 'lower-text',
            kind: 'text',
            startUs: 0,
            durationUs: 2000000,
            width: 256,
            height: 144,
            text: { text: 'background', background: 'lime' },
          },
        },
        { type: 'addTrack', track: { id: 'video', kind: 'video' } },
        {
          type: 'insertClip',
          trackId: 'video',
          clip: {
            id: 'a',
            kind: 'video',
            assetId: videos[0],
            startUs: 0,
            durationUs: 1000000,
            sourceOutUs: 1000000,
            width: 256,
            height: 144,
          },
        },
        {
          type: 'insertClip',
          trackId: 'video',
          clip: {
            id: 'b',
            kind: 'video',
            assetId: videos[1],
            startUs: 500000,
            durationUs: 1000000,
            sourceOutUs: 1000000,
            width: 256,
            height: 144,
          },
        },
        {
          type: 'addTransition',
          transition: {
            id: 'transition',
            trackId: 'video',
            fromClipId: 'a',
            toClipId: 'b',
            kind: 'crossfade',
          },
        },
      ],
    });
    const pixel = async () => {
        const f = await editor.preview.frame(p.id, 750000).completion;
        ctx.drawImage(f.image, 0, 0);
        f.image.close();
        return [...ctx.getImageData(50, 50, 1, 1).data];
      },
      crossfade = await pixel();
    await editor.commands.apply({
      projectId: p.id,
      requestId: 'black',
      expectedRevision: 1,
      operations: [
        { type: 'removeTransition', transitionId: 'transition' },
        {
          type: 'addTransition',
          transition: {
            id: 'black',
            trackId: 'video',
            fromClipId: 'a',
            toClipId: 'b',
            kind: 'black',
          },
        },
      ],
    });
    const black = await pixel();
    const proxy = await editor.assets.derivative(videos[0]!, 'proxy')
      .completion;
    const sheet = await editor.assets.contactSheet(videos[0]!, [0, 500000], 64)
      .completion;
    // A deterministic PCM tone supplies frequency and alignment evidence after real encoding.
    const data = new ArrayBuffer(44 + 96000),
      v = new DataView(data),
      str = (o: number, s: string) => {
        for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
      };
    str(0, 'RIFF');
    v.setUint32(4, data.byteLength - 8, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, 48000, true);
    v.setUint32(28, 96000, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, 'data');
    v.setUint32(40, 96000, true);
    for (let i = 0; i < 48000; i++)
      v.setInt16(
        44 + 2 * i,
        i < 4800 ? 0 : Math.sin((2 * Math.PI * 440 * i) / 48000) * 16000,
        true,
      );
    const tone = await editor.assets.import(
      new File([data], 'tone.wav', { type: 'audio/wav' }),
    ).completion;
    const q = await editor.projects.create('tone', { width: 256, height: 144 });
    await editor.commands.apply({
      projectId: q.id,
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
            assetId: tone.id,
            startUs: 0,
            durationUs: 500000,
            sourceOutUs: 1000000,
            speed: 2,
          },
        },
      ],
    });
    const audioContext = new AudioContext({ sampleRate: 48000 }),
      audioResults: {
        format: string;
        hz: number;
        onset: number;
        duration: number;
      }[] = [];
    for (const format of ['mp4', 'webm'] as const) {
      const artifact = await editor.exports.start(q.id, { format }).completion,
        asset = await editor.assets.import(
          new File([artifact.file], 'tone.' + format, {
            type: format === 'mp4' ? 'video/mp4' : 'video/webm',
          }),
        ).completion,
        pcm = await editor.assets.derivative(asset.id, 'pcm').completion,
        decoded = await audioContext.decodeAudioData(await pcm.arrayBuffer()),
        samples = decoded.getChannelData(0);
      let crossings = 0;
      for (let i = 9601; i < 19200; i++)
        if (samples[i - 1]! < 0 && samples[i]! >= 0) crossings++;
      const onset =
        samples.findIndex((s) => Math.abs(s) > 0.1) / decoded.sampleRate;
      audioResults.push({
        format,
        hz: (crossings * decoded.sampleRate) / 9600,
        onset,
        duration: decoded.duration,
      });
      await artifact.dispose();
    }
    await audioContext.close();
    await editor.dispose();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open(namespace + '-v1');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }),
      root = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle(namespace);
    const orphan = await root.getFileHandle('interrupted-original', {
        create: true,
      }),
      writer = await orphan.createWritable();
    await writer.write('orphan');
    await writer.close();
    const tx = db.transaction('journal', 'readwrite');
    tx.objectStore('journal').put({
      id: 'interrupted',
      kind: 'import',
      target: 'interrupted-original',
    });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    const foreign = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle('another-app', { create: true });
    const file = await foreign.getFileHandle('preserve', { create: true });
    const write = await file.createWritable();
    await write.write('keep');
    await write.close();
    const reopened = await createEditor({ namespace });
    let recovered = false;
    try {
      await root.getFileHandle('interrupted-original');
    } catch {
      recovered = true;
    }
    await root.removeEntry(videos[0]!);
    const missing = await reopened.preview.frame(p.id, 0).completion.then(
      () => '',
      (e: { code: string }) => e.code,
    );
    await reopened.dispose();
    return {
      crossfade,
      black,
      proxyBytes: proxy.size,
      sheetBytes: sheet.blob.size,
      audioResults,
      recovered,
      missing,
      foreign: await (await file.getFile()).text(),
    };
  });
  expect(result.crossfade[0]).toBeGreaterThan(120);
  expect(result.crossfade[0]).toBeLessThan(136);
  expect(result.crossfade[2]).toBeGreaterThan(120);
  expect(result.black).toEqual([0, 0, 0, 255]);
  expect(result.proxyBytes).toBeGreaterThan(100);
  expect(result.sheetBytes).toBeGreaterThan(100);
  for (const audio of result.audioResults) {
    expect(Math.abs(audio.hz - 880)).toBeLessThanOrEqual(5);
    expect(Math.abs(audio.onset - 0.05)).toBeLessThan(0.025);
    expect(audio.duration).toBeCloseTo(0.5, 1);
  }
  expect(result.recovered).toBe(true);
  expect(result.missing).toBe('MISSING_ASSET');
  expect(result.foreign).toBe('keep');
});

test('typed effects apply to text, transforms and half-open burned captions', async ({
  page,
}) => {
  await page.goto('/LocalCut/');
  const result = await page.evaluate(async () => {
    const { createEditor } = (await import(
        String('/LocalCut/editor.js')
      )) as typeof import('../../src/editor/index'),
      editor = await createEditor({ namespace: 'test-' + crypto.randomUUID() }),
      p = await editor.projects.create('effects', { width: 256, height: 144 });
    await editor.commands.apply({
      projectId: p.id,
      requestId: 'assembly',
      expectedRevision: 0,
      operations: [
        { type: 'addTrack', track: { id: 'overlay', kind: 'overlay' } },
        {
          type: 'insertClip',
          trackId: 'overlay',
          clip: {
            id: 'label',
            kind: 'text',
            startUs: 0,
            durationUs: 1000000,
            x: 32,
            width: 128,
            height: 72,
            grayscale: 1,
            brightness: 0.5,
            text: {
              text: 'Sample',
              fontSize: 32,
              color: 'white',
              background: 'red',
            },
          },
        },
      ],
    });
    const pixel = async (id: string, t: number, x: number, y: number) => {
        const f = await editor.preview.frame(id, t).completion,
          c = new OffscreenCanvas(256, 144),
          ctx = c.getContext('2d')!;
        ctx.drawImage(f.image, 0, 0);
        f.image.close();
        return [...ctx.getImageData(x, y, 1, 1).data];
      },
      gray = await pixel(p.id, 0, 33, 1),
      outside = await pixel(p.id, 0, 200, 1);
    const q = await editor.projects.create('captions', {
      width: 256,
      height: 144,
    });
    await editor.commands.apply({
      projectId: q.id,
      requestId: 'cues',
      expectedRevision: 0,
      operations: [
        { type: 'addTrack', track: { id: 'captions', kind: 'overlay' } },
        {
          type: 'insertClip',
          trackId: 'captions',
          clip: {
            id: 'caption',
            kind: 'caption',
            startUs: 0,
            durationUs: 500000,
            width: 256,
            height: 144,
            text: { text: '', fontSize: 32, background: 'orange' },
            cues: [{ id: 'cue', timeUs: 100000, endUs: 200000, text: 'Hello' }],
          },
        },
      ],
    });
    const cue = await pixel(q.id, 150000, 1, 1),
      ended = await pixel(q.id, 200000, 1, 1);
    await editor.dispose();
    return { gray, outside, cue, ended };
  });
  expect(result.gray[0]).toBeGreaterThan(20);
  expect(result.gray[0]).toBeLessThan(35);
  expect(result.gray.slice(0, 3).every((c) => c === result.gray[0])).toBe(true);
  expect(result.outside).toEqual([0, 0, 0, 255]);
  expect(result.cue).toEqual([255, 165, 0, 255]);
  expect(result.ended).toEqual([0, 0, 0, 255]);
});
