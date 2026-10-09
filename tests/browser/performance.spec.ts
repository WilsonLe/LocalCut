import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
test('@performance warmup, two-minute and five-minute 1080p export', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(1800000);
  const cdp = await browser.newBrowserCDPSession();
  const measurements: {
    duration: number;
    elapsedMs: number;
    bytes: number;
    rss: number[];
  }[] = [];
  await page.goto('/LocalCut/');
  await page.evaluate(async () => {
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
    window.asset = await window.editor.assets.import(
      new File([await canvas.convertToBlob()], 'gradient.png', {
        type: 'image/png',
      }),
    ).completion;
  });
  for (const duration of [10, 120, 300]) {
    const rss: number[] = [];
    let sampling = true;
    const sample = async () => {
      while (sampling) {
        const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
        const ids = processInfo.map((p: { id: number }) => String(p.id));
        try {
          rss.push(
            execFileSync('ps', ['-o', 'rss=', '-p', ids.join(',')], {
              encoding: 'utf8',
            })
              .trim()
              .split(/\s+/)
              .reduce((n, v) => n + Number(v) * 1024, 0),
          );
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
                id: 'gradient-' + i,
                kind: 'image' as const,
                assetId: window.asset.id,
                startUs: i * 1e6,
                durationUs: 1e6,
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
      return { bytes, durationUs: asset.durationUs, seekMs };
    }, duration);
    sampling = false;
    await sampler;
    expect(result.durationUs).toBe(duration * 1e6);
    expect(result.seekMs).toBeLessThan(5000);
    measurements.push({
      duration,
      elapsedMs: Date.now() - started,
      bytes: result.bytes,
      rss,
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
  expect(two).toBeGreaterThan(0);
  expect(five - two).toBeLessThan(128 * 1024 * 1024);
  await page.evaluate(() => window.editor.dispose());
  await cdp.detach();
  await testInfo.attach('performance-evidence', {
    body: JSON.stringify({ measurements, steadyRss: { two, five } }, null, 2),
    contentType: 'application/json',
  });
});
