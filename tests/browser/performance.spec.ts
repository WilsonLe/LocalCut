import { test as base, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Incognito OPFS stores file payloads in RAM. Measure processing in the normal
// disk-backed browser environment, with an isolated disposable profile.
const test = base.extend({
  context: async ({ playwright, baseURL }, provide, testInfo) => {
    const profile = await mkdtemp(join(tmpdir(), 'localcut-performance-'));
    const context = await playwright.chromium
      .launchPersistentContext(profile, {
        channel: 'chrome',
        executablePath: process.env.LOCALCUT_CHROME_EXECUTABLE,
        baseURL,
      })
      .catch(async (error: unknown) => {
        await rm(profile, { recursive: true, force: true });
        throw error;
      });
    try {
      await context.tracing.start({
        screenshots: true,
        snapshots: true,
        sources: true,
      });
      await provide(context);
    } finally {
      try {
        const failed = testInfo.status !== testInfo.expectedStatus;
        const path = failed ? testInfo.outputPath('trace.zip') : undefined;
        await context.tracing.stop({ path });
        if (path)
          await testInfo.attach('trace', {
            path,
            contentType: 'application/zip',
          });
      } finally {
        try {
          await context.close();
        } finally {
          await rm(profile, { recursive: true, force: true });
        }
      }
    }
  },
});
test.use({ trace: 'off' }); // The custom profile fixture retains failed traces.

test('@performance warmup, two-minute and five-minute 1080p export', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(1800000);
  const cdp = await context.browser()!.newBrowserCDPSession();
  const measurements: {
    duration: number;
    elapsedMs: number;
    bytes: number;
    rss: number[];
    processRss: { atMs: number; byType: Record<string, number> }[];
  }[] = [];
  await page.goto('/LocalCut/');
  const source = await page.evaluate(async () => {
    const { createEditor } = (await import(
      String('/LocalCut/editor.js')
    )) as typeof import('../../src/editor/index');
    window.editor = await createEditor({ namespace: 'test-performance' });
    const canvas = new OffscreenCanvas(1920, 1080),
      ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 1920, 1080);
    gradient.addColorStop(0, 'red');
    gradient.addColorStop(1, 'blue');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1920, 1080);
    const editor = window.editor;
    const image = await editor.assets.import(
      new File([await canvas.convertToBlob()], 'gradient.png', {
        type: 'image/png',
      }),
    ).completion;
    const sampleRate = 48000,
      data = new ArrayBuffer(44 + sampleRate * 4),
      view = new DataView(data),
      text = (offset: number, value: string) => {
        for (let i = 0; i < value.length; i++)
          view.setUint8(offset + i, value.charCodeAt(i));
      };
    text(0, 'RIFF');
    view.setUint32(4, data.byteLength - 8, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, sampleRate * 4, true);
    for (let i = 0; i < sampleRate; i++) {
      view.setInt16(
        44 + i * 4,
        Math.sin((i * 2 * Math.PI * 440) / sampleRate) * 8000,
        true,
      );
      view.setInt16(
        46 + i * 4,
        Math.sin((i * 2 * Math.PI * 660) / sampleRate) * 8000,
        true,
      );
    }
    const tone = await editor.assets.import(
      new File([data], 'stereo-tone.wav', { type: 'audio/wav' }),
    ).completion;
    const project = await editor.projects.create('encoded performance source');
    await editor.commands.apply({
      projectId: project.id,
      requestId: 'source',
      expectedRevision: 0,
      operations: [
        { type: 'addTrack', track: { id: 'video', kind: 'video' } },
        { type: 'addTrack', track: { id: 'audio', kind: 'audio' } },
        {
          type: 'insertClip',
          trackId: 'video',
          clip: {
            id: 'source-image',
            kind: 'image',
            assetId: image.id,
            startUs: 0,
            durationUs: 1e6,
            keyframes: {
              opacity: [
                { timeUs: 0, value: 0.6 },
                { timeUs: 1e6, value: 1 },
              ],
            },
          },
        },
        {
          type: 'insertClip',
          trackId: 'audio',
          clip: {
            id: 'source-tone',
            kind: 'audio',
            assetId: tone.id,
            startUs: 0,
            durationUs: 1e6,
            sourceOutUs: 1e6,
          },
        },
      ],
    });
    const artifact = await editor.exports.start(project.id, { format: 'mp4' })
      .completion;
    try {
      window.asset = await editor.assets.import(
        new File([artifact.file], 'gradient-and-tone.mp4', {
          type: 'video/mp4',
        }),
      ).completion;
    } finally {
      await artifact.dispose();
      await editor.projects.delete(project.id);
    }
    const waveform = await editor.assets.waveform(window.asset.id, 32)
      .completion;
    return { ...window.asset, peak: Math.max(...waveform) };
  });
  expect(source.videoCodec).toBe('avc');
  expect(source.audioCodec).toBe('aac');
  expect(source.channels).toBe(2);
  expect(source.width).toBe(1920);
  expect(source.height).toBe(1080);
  expect(source.durationUs).toBe(1e6);
  expect(source.peak).toBeGreaterThan(0.15);
  let indexAssetId = '';
  for (const duration of [10, 120, 300]) {
    const rss: number[] = [];
    const processRss: { atMs: number; byType: Record<string, number> }[] = [];
    let sampling = true;
    const sample = async () => {
      while (sampling) {
        const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
        const ids = processInfo.map((p: { id: number }) => String(p.id));
        try {
          const rows = execFileSync(
            'ps',
            ['-o', 'pid=,rss=', '-p', ids.join(',')],
            { encoding: 'utf8' },
          )
            .trim()
            .split('\n');
          const byType: Record<string, number> = {};
          for (const row of rows) {
            const [id, value] = row.trim().split(/\s+/).map(Number);
            const type =
              processInfo.find((process: { id: number }) => process.id === id)
                ?.type ?? 'unknown';
            byType[type] = (byType[type] ?? 0) + value! * 1024;
          }
          rss.push(
            Object.values(byType).reduce((sum, value) => sum + value, 0),
          );
          processRss.push({ atMs: Date.now(), byType });
        } catch {
          /* A retired worker can disappear between snapshots. */
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    };
    const sampler = sample(),
      started = Date.now();
    const result = await page.evaluate(async (seconds) => {
      const editor = window.editor,
        p = await editor.projects.create('performance');
      await editor.commands.apply({
        projectId: p.id,
        requestId: 'assembly',
        expectedRevision: 0,
        operations: [
          { type: 'addTrack', track: { id: 'visual', kind: 'video' } },
          { type: 'addTrack', track: { id: 'titles', kind: 'overlay' } },
          ...Array.from({ length: seconds }, (_, i) => [
            {
              type: 'insertClip' as const,
              trackId: 'visual',
              clip: {
                id: 'source-' + i,
                kind: 'video' as const,
                assetId: window.asset.id,
                startUs: i * 1e6,
                durationUs: 1e6,
                sourceOutUs: 1e6,
              },
            },
            {
              type: 'insertClip' as const,
              trackId: 'titles',
              clip: {
                id: 'label-' + i,
                kind: 'text' as const,
                startUs: i * 1e6,
                durationUs: 1e6,
                width: 600,
                height: 100,
                y: 100,
                text: {
                  text: 'LocalCut export validation',
                  fontSize: 48,
                  color: 'white',
                  background: 'black',
                },
                keyframes: {
                  x: [
                    { timeUs: 0, value: (i / seconds) * 1200 },
                    { timeUs: 1e6, value: ((i + 1) / seconds) * 1200 },
                  ],
                },
              },
            },
          ]).flat(),
        ],
      });
      const task = editor.exports.start(p.id, { format: 'mp4' });
      await new Promise<void>((resolve) => {
        const unsubscribe = task.subscribe((e) => {
          if (e.stage === 'encode') {
            unsubscribe();
            resolve();
          }
        });
      });
      const seekStart = performance.now(),
        frame = await editor.preview.frame(p.id, seconds * 500000, {
          width: 480,
          height: 270,
        }).completion;
      frame.image.close();
      const seekMs = performance.now() - seekStart,
        artifact = await task.completion;
      const asset = await editor.assets.import(
        new File([artifact.file], 'export.mp4', { type: 'video/mp4' }),
      ).completion;
      const bytes = artifact.file.size;
      await artifact.dispose();
      await editor.projects.delete(p.id);
      return {
        assetId: asset.id,
        bytes,
        durationUs: asset.durationUs,
        videoCodec: asset.videoCodec,
        audioCodec: asset.audioCodec,
        seekMs,
      };
    }, duration);
    sampling = false;
    await sampler;
    indexAssetId = result.assetId;
    expect(result.durationUs).toBe(duration * 1e6);
    expect(result.videoCodec).toBe('avc');
    expect(result.audioCodec).toBe('aac');
    expect(result.seekMs).toBeLessThan(5000);
    measurements.push({
      duration,
      elapsedMs: Date.now() - started,
      bytes: result.bytes,
      rss,
      processRss,
    });
    console.log(JSON.stringify(measurements.at(-1)));
  }
  // Compare steady-state native browser+worker RSS, beyond warmup, rather than JS heap alone.
  const steady = (values: number[]) =>
    values.slice(Math.floor(values.length / 2)).sort((a, b) => a - b)[
      Math.floor(values.length / 4)
    ] ?? 0;
  const two = steady(measurements[1]!.rss),
    five = steady(measurements[2]!.rss);
  const indexing = await page.evaluate(async (assetId) => {
    const run = await window.editor.assets.analyze(assetId).completion;
    return {
      scanMs: run.analysis.scanMs,
      generationMs: run.analysis.generationMs,
      samples: run.analysis.frames.length,
      scenes: run.analysis.scenes.length,
      artifactBytes: run.analysis.scenes
        .flatMap((s) => s.artifacts)
        .reduce((n, a) => n + a.size, 0),
    };
  }, indexAssetId);
  expect(indexing.samples).toBe(1200);
  expect(indexing.scenes).toBeGreaterThan(0);
  expect(indexing.artifactBytes).toBeGreaterThan(0);
  console.log(JSON.stringify({ indexing }));
  await page.evaluate(() => window.editor.dispose());
  await cdp.detach();
  await testInfo.attach('performance-evidence', {
    body: JSON.stringify(
      {
        workload: {
          width: 1920,
          height: 1080,
          frameRate: 30,
          sourceDurationSeconds: 1,
          videoCodec: source.videoCodec,
          audioCodec: source.audioCodec,
          audioSampleRate: source.sampleRate,
          audioChannels: source.channels,
          sourceToneHz: [440, 660],
          sourceAudioPeak: source.peak,
          description:
            'Repeated one-second H.264/AAC source with animated gradient and stereo tones; sequential video clips and animated text overlays.',
        },
        measurements,
        indexing,
        steadyRss: { two, five },
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  expect(two).toBeGreaterThan(0);
  expect(five - two).toBeLessThan(128 * 1024 * 1024);
});
