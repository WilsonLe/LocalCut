import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { BrowserContext } from '@playwright/test';
import type { Asset, Project, Transcript } from '../../src/editor';
import {
  installHarness,
  call,
  projectReady,
  workspaceReady,
} from './webmcp-helper';
async function routeTranscriptionCache(context: BrowserContext) {
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
}

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
  await routeTranscriptionCache(context);
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
    const transcriptCount = async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('test-asr-v1');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<number>((resolve, reject) => {
          const request = db
            .transaction('transcripts')
            .objectStore('transcripts')
            .count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } finally {
        db.close();
      }
    };
    const beforeCancel = await transcriptCount();
    const cancelledJob = window.editor.transcription.transcribe(asset.id);
    const unsubscribe = cancelledJob.subscribe((event) => {
      if (event.stage === 'inference') cancelledJob.cancel();
    });
    const cancelled = await cancelledJob.completion.then(
      () => 'unexpected-success',
      (error: { code: string }) => error.code,
    );
    unsubscribe();
    const afterCancel = await transcriptCount();
    // A fresh worker performs automatic language detection after cancellation.
    // Deliberately use endpoints not aligned to a 16 kHz sample.
    const ranged = await window.editor.transcription.transcribe(asset.id, {
      startUs: 1,
      endUs: asset.durationUs - 1,
    }).completion;
    const project = await window.editor.projects.create(
      'Source-timed transcript',
    );
    await window.editor.commands.apply({
      projectId: project.id,
      requestId: 'link-range',
      expectedRevision: 0,
      operations: [
        { type: 'addTrack', track: { id: 'speech', kind: 'audio' } },
        {
          type: 'insertClip',
          trackId: 'speech',
          clip: {
            id: 'speech-clip',
            kind: 'audio',
            assetId: asset.id,
            transcriptId: ranged.id,
            startUs: 0,
            durationUs: asset.durationUs,
            sourceOutUs: asset.durationUs,
          },
        },
      ],
    });
    const backup = JSON.parse(
      await window.editor.projects.exportJSON(project.id),
    );
    await window.editor.dispose();
    return {
      missing,
      assetId: asset.id,
      durationUs: asset.durationUs,
      transcript,
      overlap,
      cancelled,
      beforeCancel,
      afterCancel,
      ranged,
      backupTranscriptCount: backup.transcripts.length,
    };
  });
  expect(info.missing).toBe('MODEL_REQUIRED');
  expect(info.cancelled).toBe('CANCELLED');
  expect(info.afterCancel).toBe(info.beforeCancel);
  expect(info.backupTranscriptCount).toBe(1);
  expect(info.ranged.cues.length).toBeGreaterThan(0);
  for (const cue of info.ranged.cues) {
    expect(cue.timeUs).toBeGreaterThanOrEqual(1);
    expect(cue.endUs).toBeLessThanOrEqual(info.durationUs - 1);
  }
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

// This rehearses the published workflow with real STT and production consumers.
// Host-agent selection/normalization/listening quality is separate evidence.
test('@transcription indexing saves real source cues and visible content after reload', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(300000);
  page.setDefaultTimeout(15000);
  await routeTranscriptionCache(context);
  await installHarness(page);
  await page.goto('/LocalCut/');
  await workspaceReady(page);
  const catalog = await call<{ skills: { name: string }[] }>(page, 'skills', {
    action: 'list',
  });
  expect(catalog.skills.map((skill) => skill.name)).toContain(
    'localcut-indexing',
  );
  const guidance = await call<{ content: string }>(page, 'skills', {
    action: 'get',
    name: 'localcut-indexing',
  });
  expect(guidance.content).toContain('analyze');
  const created = await call<{ project: Project }>(page, 'workspace', {
    action: 'create_project',
    name: 'Indexing speech rehearsal',
  });
  const projectId = created.project.id;
  await projectReady(page, projectId);
  const picker = page.waitForEvent('filechooser');
  await call(page, 'workspace', {
    action: 'import_files',
    expectedProjectId: projectId,
  });
  await (await picker).setFiles('tests/fixtures/jfk.wav');
  let asset!: Asset;
  await expect(async () => {
    const inspected = await call<{ assets: Asset[] }>(page, 'inspect_project');
    expect(inspected.assets).toHaveLength(1);
    asset = inspected.assets[0]!;
  }).toPass();
  const importDialog = page.getByRole('dialog', {
    name: 'Import media',
    exact: true,
  });
  await expect(importDialog).toContainText('Finished');
  await importDialog.getByRole('button', { name: 'Okay', exact: true }).click();
  const assetId = asset.id;
  const inspect = () =>
    call<Asset>(page, 'asset', { action: 'inspect', projectId, assetId });
  const wait = <T>(jobId: string) =>
    call<{ state: string; result: T }>(page, 'job', {
      projectId,
      jobId,
      action: 'wait',
    });
  const analysis = await call<{ jobId: string }>(page, 'asset', {
    action: 'analyze',
    projectId,
    assetId,
  });
  expect((await wait(analysis.jobId)).state).toBe('completed');
  const empty = await inspect();
  // Negative control: completed technical analysis leaves semantic indexing incomplete.
  expect(empty.clips![0]).toMatchObject({ context: '', transcript: '' });

  const humanClip = {
    ...empty.clips![0]!,
    id: 'human',
    name: 'Human notes',
    context: 'Keep this source.',
    transcript: 'Supplied wording — leave unchanged.',
  };
  await call(page, 'asset', {
    action: 'update_clips',
    projectId,
    assetId,
    expectedClipsRevision: empty.clipsRevision,
    clips: [...empty.clips!, humanClip],
  });
  const before = await inspect();
  const status = await call<{ ready: boolean }>(page, 'transcription', {
    action: 'status',
    projectId,
  });
  if (!status.ready) {
    const prepare = await call<{ jobId: string }>(page, 'transcription', {
      action: 'prepare',
      projectId,
    });
    expect((await wait(prepare.jobId)).state).toBe('completed');
  }
  const job = await call<{ jobId: string }>(page, 'transcription', {
    action: 'transcribe',
    projectId,
    assetId,
    language: 'english',
    startUs: 0,
    endUs: asset.durationUs,
  });
  const recognition = await wait<Transcript>(job.jobId);
  expect(recognition.state).toBe('completed');
  const raw = await call<Transcript>(page, 'transcription', {
    action: 'read',
    projectId,
    transcriptId: recognition.result.id,
  });
  expect(raw).toEqual(recognition.result);
  expect(
    raw.cues
      .map((cue) => cue.text)
      .join(' ')
      .toLowerCase(),
  ).toContain('ask not what your country can do for you');
  expect(raw.cues.length).toBeGreaterThan(0);
  for (const cue of raw.cues) {
    expect(cue.timeUs).toBeGreaterThanOrEqual(0);
    expect(cue.endUs).toBeLessThanOrEqual(asset.durationUs);
  }
  // Known attributed fixture: attach raw recognition unchanged in this transport
  // rehearsal. This is not an automated LLM normalization or listening claim.
  const indexed = {
    ...before.clips![0]!,
    name: 'Civic responsibility',
    context:
      'A speaker addresses fellow Americans, urging them to ask what they can do for their country.',
    transcript: raw.cues.map((cue) => cue.text).join('\n'),
    transcriptCues: raw.cues.map(({ id, timeUs, endUs, text }) => ({
      id,
      timeUs,
      endUs,
      text,
    })),
  };
  const clips = [indexed, humanClip];
  const write = {
    action: 'update_clips',
    projectId,
    assetId,
    expectedClipsRevision: before.clipsRevision,
    clips,
  };
  expect(await call(page, 'asset', write)).toMatchObject({ clips });
  expect(await call(page, 'asset', write)).toMatchObject({
    isError: true,
    error: { code: 'REVISION_CONFLICT' },
  });
  expect((await inspect()).clips).toEqual(clips);
  expect(
    await call(page, 'transcription', {
      action: 'read',
      projectId,
      transcriptId: raw.id,
    }),
  ).toEqual(raw);

  const verifyTabs = async () => {
    if (
      (await page
        .locator('#workspace-media-content')
        .getAttribute('aria-hidden')) === 'true'
    )
      await page
        .getByRole('button', { name: 'Expand media', exact: true })
        .click();
    await page
      .getByRole('button', { name: 'Asset details for jfk.wav', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'jfk.wav', exact: true });
    await dialog
      .getByRole('option', { name: /^Civic responsibility / })
      .click();
    await dialog.getByRole('tab', { name: 'Context', exact: true }).click();
    await expect(
      dialog.getByRole('textbox', { name: 'Context', exact: true }),
    ).toHaveValue(indexed.context);
    await page.screenshot({ path: '.artifacts/indexing-speech-context.png' });
    await dialog.getByRole('tab', { name: 'Transcript', exact: true }).click();
    for (const cue of indexed.transcriptCues)
      await expect(dialog.getByText(cue.text, { exact: true })).toBeVisible();
    await page.screenshot({
      path: '.artifacts/indexing-speech-transcript.png',
    });
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  };
  await verifyTabs();
  for (const jobId of [analysis.jobId, job.jobId])
    await call(page, 'job', { projectId, jobId, action: 'release' });
  await page.reload();
  await projectReady(page, projectId);
  expect((await inspect()).clips).toEqual(clips);
  await verifyTabs();
  await testInfo.attach('indexing-workflow-evidence', {
    body: JSON.stringify(
      {
        assetId,
        sourceRange: [0, asset.durationUs],
        raw,
        clips,
        limitation:
          'Real local STT, controlled attachment/UI/reload. No host-agent adherence, LLM normalization or listening claim.',
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});
