import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
test('@transcription real Whisper preparation, inference and cached reload', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(900000);
  expect(
    createHash('sha256')
      .update(await readFile('tests/fixtures/jfk.wav'))
      .digest('hex'),
  ).toBe('59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e');
  if (process.env.LOCALCUT_ASR_CACHE) {
    const folder = process.env.LOCALCUT_ASR_CACHE;
    const manifest = JSON.parse(
      await readFile(folder + '/manifest.json', 'utf8'),
    ) as { url: string; name: string; sha256: string; size: number }[];
    for (const item of manifest) {
      const data = await readFile(folder + '/' + item.name);
      expect(createHash('sha256').update(data).digest('hex')).toBe(item.sha256);
      await context.route(item.url, (route) =>
        route.fulfill({
          status: 200,
          body: route.request().method() === 'HEAD' ? Buffer.alloc(0) : data,
          headers: {
            'content-length': String(item.size),
            'content-type': item.name.endsWith('.json')
              ? 'application/json'
              : 'application/octet-stream',
          },
        }),
      );
    }
  }
  const requests: { url: string; method: string }[] = [];
  context.on('request', (r) =>
    requests.push({ url: r.url(), method: r.method() }),
  );
  await page.goto('/LocalCut/');
  const info = await page.evaluate(async () => {
    const { createEditor } = (await import(
      String('/LocalCut/editor.js')
    )) as typeof import('../../src/editor/index');
    window.editor = await createEditor({ namespace: 'test-asr' });
    const file = await (await fetch('/fixtures/jfk.wav')).blob();
    const asset = await window.editor.assets.import(
      new File([file], 'jfk.wav', { type: 'audio/wav' }),
    ).completion;
    const missing = await window.editor.transcription
      .transcribe(asset.id, { language: 'english' })
      .completion.then(
        () => '',
        (e: { code: string }) => e.code,
      );
    const prepared = await window.editor.transcription.prepare().completion;
    if (!prepared.ready) throw new Error(JSON.stringify(prepared));
    const transcript = await window.editor.transcription.transcribe(asset.id, {
      language: 'english',
    }).completion;
    // Repeat the attributed sample to exceed a 30-second window and exercise overlap stitching.
    const source = new Uint8Array(await file.arrayBuffer()),
      view = new DataView(source.buffer);
    let offset = 12,
      pcm: Uint8Array | undefined;
    while (offset + 8 <= source.length) {
      const size = view.getUint32(offset + 4, true);
      if (
        String.fromCharCode(...source.subarray(offset, offset + 4)) === 'data'
      ) {
        pcm = source.subarray(offset + 8, offset + 8 + size);
        break;
      }
      offset += 8 + size + (size % 2);
    }
    if (!pcm) throw new Error('Fixture PCM missing');
    const joined = new Uint8Array(44 + pcm.length * 3),
      header = new DataView(joined.buffer);
    const str = (at: number, text: string) => {
      for (let i = 0; i < text.length; i++) joined[at + i] = text.charCodeAt(i);
    };
    str(0, 'RIFF');
    header.setUint32(4, joined.length - 8, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    header.setUint32(16, 16, true);
    header.setUint16(20, 1, true);
    header.setUint16(22, 1, true);
    header.setUint32(24, 16000, true);
    header.setUint32(28, 32000, true);
    header.setUint16(32, 2, true);
    header.setUint16(34, 16, true);
    str(36, 'data');
    header.setUint32(40, pcm.length * 3, true);
    for (let i = 0; i < 3; i++) joined.set(pcm, 44 + i * pcm.length);
    const longer = await window.editor.assets.import(
      new File([joined], 'overlap.wav', { type: 'audio/wav' }),
    ).completion;
    const overlap = await window.editor.transcription.transcribe(longer.id, {
      language: 'english',
    }).completion;
    await window.editor.dispose();
    return { missing, assetId: asset.id, transcript, overlap };
  });
  expect(info.missing).toBe('MODEL_REQUIRED');
  expect(
    info.transcript.cues
      .map((c) => c.text)
      .join(' ')
      .toLowerCase(),
  ).toContain('ask not what your country can do for you');
  expect(info.transcript.cues.length).toBeGreaterThan(0);
  for (let i = 0; i < info.transcript.cues.length; i++) {
    const c = info.transcript.cues[i]!;
    expect(c.endUs).toBeGreaterThan(c.timeUs);
    if (i)
      expect(c.timeUs).toBeGreaterThanOrEqual(
        info.transcript.cues[i - 1]!.timeUs,
      );
  }
  expect(
    info.overlap.cues
      .map((c) => c.text)
      .join(' ')
      .toLowerCase()
      .replace(/[^a-z ]/g, ' ')
      .replace(/\s+/g, ' ')
      .match(/fellow americans ask not/g),
  ).toHaveLength(3);
  for (let i = 1; i < info.overlap.cues.length; i++)
    expect(info.overlap.cues[i]!.timeUs).toBeGreaterThanOrEqual(
      info.overlap.cues[i - 1]!.timeUs,
    );
  const remote = requests.filter((r) => !r.url.startsWith('http://127.0.0.1'));
  expect(remote.length).toBeGreaterThan(0);
  expect(remote.every((r) => r.method === 'GET' || r.method === 'HEAD')).toBe(
    true,
  );
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.reload();
  const replay = await page.evaluate(async (assetId) => {
    const { createEditor } = (await import(
      String('/LocalCut/editor.js')
    )) as typeof import('../../src/editor/index');
    window.editor = await createEditor({ namespace: 'test-asr' });
    const status = await window.editor.transcription.status();
    const transcript = await window.editor.transcription.transcribe(assetId, {
      language: 'english',
    }).completion;
    await window.editor.transcription.clearModelCache();
    const retained = await window.editor.transcription.transcript(
      transcript.id,
    );
    await window.editor.dispose();
    return { status, transcript, retained };
  }, info.assetId);
  expect(replay.status.ready).toBe(true);
  expect(replay.transcript.cues.map((c) => c.text).join(' ')).toEqual(
    info.transcript.cues.map((c) => c.text).join(' '),
  );
  expect(replay.retained).toEqual(replay.transcript);
  await testInfo.attach('transcription-evidence', {
    body: JSON.stringify({ info, replay, remote }, null, 2),
    contentType: 'application/json',
  });
});
