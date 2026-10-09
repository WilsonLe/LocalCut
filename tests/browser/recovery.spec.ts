import { test, expect } from '@playwright/test';
test('fresh-namespace backups restore metadata, transcript captions and relink originals', async ({
  page,
}) => {
  await page.goto('/LocalCut/');
  const result = await page.evaluate(async () => {
    const { createEditor } = (await import(
      String('/LocalCut/editor.js')
    )) as typeof import('../../src/editor/index');
    const namespace = 'test-' + crypto.randomUUID();
    const source = await createEditor({ namespace });
    const p = await source.projects.create('backup', {
      width: 256,
      height: 144,
    });
    const canvas = new OffscreenCanvas(256, 144),
      ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'red';
    ctx.fillRect(0, 0, 256, 144);
    const image = await source.assets.import(
      new File([await canvas.convertToBlob()], 'original.png', {
        type: 'image/png',
      }),
    ).completion;
    await source.commands.apply({
      projectId: p.id,
      expectedRevision: 0,
      requestId: 'assemble',
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
    const artifact = await source.exports.start(p.id, { format: 'webm' })
      .completion;
    const original = new File(
      [await artifact.file.arrayBuffer()],
      'original.webm',
      {
        type: 'video/webm',
      },
    );
    const asset = await source.assets.import(original).completion;
    await artifact.dispose();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(namespace + '-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('transcripts', 'readwrite');
      tx.objectStore('transcripts').put({
        id: 'speech',
        assetId: asset.id,
        model: 'fixture',
        revision: 'pinned',
        cues: [
          { id: 'cue', timeUs: 0, endUs: 900000, text: 'Restored captions' },
        ],
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    await source.commands.apply({
      projectId: p.id,
      expectedRevision: 1,
      requestId: 'video',
      operations: [
        { type: 'removeClip', clipId: 'c' },
        {
          type: 'insertClip',
          trackId: 't',
          clip: {
            id: 'v',
            kind: 'video',
            assetId: asset.id,
            transcriptId: 'speech',
            startUs: 0,
            durationUs: 1000000,
            sourceOutUs: 1000000,
            width: 256,
            height: 144,
          },
        },
      ],
    });
    const before = await source.preview.frame(p.id, 100000).completion;
    const pixels = (image: ImageBitmap) => {
      ctx.drawImage(image, 0, 0);
      image.close();
      return [...ctx.getImageData(0, 0, 256, 144).data];
    };
    const expected = pixels(before.image);
    const backup = await source.projects.exportJSON(p.id);
    const restoredNamespace = 'test-' + crypto.randomUUID();
    const restored = await createEditor({ namespace: restoredNamespace });
    const copy = await restored.projects.importJSON(backup);
    const clip = copy.tracks[0]!.clips[0]!;
    const restoredStatus = (await restored.assets.inspect(clip.assetId!))
      .status;
    const missing = await restored.preview.frame(copy.id, 0).completion.then(
      () => '',
      (e: { code: string }) => e.code,
    );
    const presentation = document.createElement('canvas');
    presentation.width = 256;
    presentation.height = 144;
    const audio = new AudioContext();
    await audio.resume();
    const session = restored.preview.session(copy.id, presentation, audio),
      errors: string[] = [];
    session.onError((e) => errors.push(e.code));
    const playback = await session.play().then(
      () => '',
      (e: { code: string }) => e.code,
    );
    session.dispose();
    await audio.close();
    const restoreRoot = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle(restoredNamespace);
    const partial = await (
      await restoreRoot.getFileHandle(clip.assetId!, { create: true })
    ).createWritable();
    await partial.write('interrupted relink');
    await partial.close();
    const restoreDB = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open(restoredNamespace + '-v1');
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = restoreDB.transaction('journal', 'readwrite');
      tx.objectStore('journal').put({
        id: 'interrupted',
        target: clip.assetId!,
        kind: 'import',
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    restoreDB.close();
    const peer = await createEditor({ namespace: restoredNamespace });
    let releaseLock!: () => void, readyLock!: () => void;
    const acquired = new Promise<void>((r) => {
      readyLock = r;
    });
    const held = new Promise<void>((r) => {
      releaseLock = r;
    });
    const lock = navigator.locks.request(
      `${restoredNamespace}:asset:${clip.assetId!}`,
      async () => {
        readyLock();
        await held;
      },
    );
    await acquired;
    const waiting = restored.assets.relink(clip.assetId!, original);
    await new Promise((r) => setTimeout(r, 50));
    waiting.cancel();
    const cancelledLock = await waiting.completion.then(
      () => '',
      (e: { code: string }) => e.code,
    );
    releaseLock();
    await lock;
    const races = await Promise.allSettled([
      restored.assets.relink(clip.assetId!, original).completion,
      peer.assets.relink(clip.assetId!, original).completion,
    ]);
    const relinks = races
      .map((r) =>
        r.status === 'fulfilled'
          ? 'ready'
          : (r.reason as { code: string }).code,
      )
      .sort();
    await peer.dispose();
    const playbackAudio = new AudioContext();
    await playbackAudio.resume();
    const playing = restored.preview.session(
      copy.id,
      presentation,
      playbackAudio,
    );
    await playing.play();
    // Observe native playback progress instead of assuming the audio clock has
    // advanced after a particular wall-clock delay on a busy CI runner.
    const progressDeadline = performance.now() + 5000;
    while (
      playing.currentTimeUs < 50000 &&
      performance.now() < progressDeadline
    )
      await new Promise((r) => setTimeout(r, 10));
    const advancedUs = playing.currentTimeUs;
    playing.pause();
    const paused = playing.currentTimeUs;
    await new Promise((r) => setTimeout(r, 50));
    const stable = paused === playing.currentTimeUs;
    await playing.seek(200000);
    const seeked = playing.currentTimeUs === 200000;
    playing.dispose();
    await playbackAudio.close();
    const frame = await restored.preview.frame(copy.id, 100000).completion;
    const same =
      JSON.stringify(pixels(frame.image)) === JSON.stringify(expected);
    const a = await restored.preview.frame(copy.id, 0, {
      width: 128,
      height: 72,
    }).completion;
    const b = await restored.preview.frame(copy.id, 0, {
      width: 128,
      height: 36,
    }).completion;
    const sizes = [
      [a.image.width, a.image.height],
      [b.image.width, b.image.height],
    ];
    a.image.close();
    b.image.close();
    const transcript = await restored.transcription.transcript(
      clip.transcriptId!,
    );
    const malformed = JSON.parse(backup) as { assets: unknown[] };
    malformed.assets = [];
    const rejected = await restored.projects
      .importJSON(JSON.stringify(malformed))
      .then(
        () => '',
        (e: { code: string }) => e.code,
      );
    const count = (await restored.projects.list()).length;
    await source.dispose();
    await restored.dispose();
    return {
      same,
      missing,
      playback,
      errors,
      sizes,
      transcript: transcript?.cues[0]?.text,
      revision: copy.revision,
      remapped: clip.assetId !== asset.id,
      rejected,
      count,
      relinks,
      cancelledLock,
      restoredStatus,
      advancedUs,
      stable,
      seeked,
    };
  });
  const { advancedUs, ...restoredResult } = result;
  expect(advancedUs).toBeGreaterThanOrEqual(50000);
  expect(advancedUs).toBeLessThan(1000000);
  expect(restoredResult).toEqual({
    same: true,
    missing: 'MISSING_ASSET',
    playback: 'MISSING_ASSET',
    errors: ['MISSING_ASSET'],
    sizes: [
      [128, 72],
      [128, 36],
    ],
    transcript: 'Restored captions',
    revision: 0,
    remapped: true,
    rejected: 'INVALID_DOCUMENT',
    count: 1,
    relinks: ['INVALID_COMMAND', 'ready'],
    cancelledLock: 'CANCELLED',
    restoredStatus: 'missing',
    stable: true,
    seeked: true,
  });
});
