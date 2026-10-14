import { expect, test } from '@playwright/test';
import { behaviorBases } from './coverage-bases';

// Opt in: run serially without other browser workloads for comparable FPS.
// Observe canvas writes at repaint boundaries, rather than counting clock/UI ticks.
for (const base of behaviorBases) {
  test(`measured editor playback frame delivery ${base}`, async ({
    page,
  }, info) => {
    test.skip(
      process.env.LOCALCUT_MEASURE_PLAYBACK !== '1',
      'Opt-in FPS benchmark',
    );
    test.setTimeout(180000);
    await page.goto(base);
    const projects = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const canvas = new OffscreenCanvas(1920, 1080),
          ctx = canvas.getContext('2d')!;
        const gradient = ctx.createLinearGradient(0, 0, 1920, 1080);
        gradient.addColorStop(0, '#193e91');
        gradient.addColorStop(1, '#c83252');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 1920, 1080);
        const image = await editor.assets.import(
          new File([await canvas.convertToBlob()], 'gradient.png', {
            type: 'image/png',
          }),
        ).completion;
        const source = await editor.projects.create('FPS moving source', {
          width: 1920,
          height: 1080,
          frameRate: { num: 30, den: 1 },
        });
        await editor.commands.apply({
          projectId: source.id,
          expectedRevision: 0,
          requestId: 'fps-source',
          operations: [
            { type: 'addTrack', track: { id: 'v', kind: 'video' } },
            { type: 'addTrack', track: { id: 'o', kind: 'overlay' } },
            {
              type: 'insertClip',
              trackId: 'v',
              clip: {
                id: 'gradient',
                kind: 'image',
                assetId: image.id,
                startUs: 0,
                durationUs: 12000000,
                width: 1920,
                height: 1080,
              },
            },
            {
              type: 'insertClip',
              trackId: 'o',
              clip: {
                id: 'moving',
                kind: 'text',
                startUs: 0,
                durationUs: 12000000,
                y: 200,
                text: {
                  text: 'Native 1080p30 playback',
                  fontSize: 100,
                  color: 'white',
                },
                keyframes: {
                  x: [
                    { timeUs: 0, value: 0 },
                    { timeUs: 12000000, value: 900 },
                  ],
                },
              },
            },
          ],
        });
        const artifact = await editor.exports.start(source.id, {
          format: 'mp4',
        }).completion;
        let video;
        try {
          video = await editor.assets.import(
            new File([artifact.file], 'moving-1080p30.mp4', {
              type: 'video/mp4',
            }),
          ).completion;
        } finally {
          await artifact.dispose();
        }
        const frames = 12 * 48000,
          wav = new ArrayBuffer(44 + frames * 4),
          view = new DataView(wav);
        const text = (offset: number, value: string) => {
          for (let i = 0; i < value.length; i++)
            view.setUint8(offset + i, value.charCodeAt(i));
        };
        text(0, 'RIFF');
        view.setUint32(4, wav.byteLength - 8, true);
        text(8, 'WAVE');
        text(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 2, true);
        view.setUint32(24, 48000, true);
        view.setUint32(28, 192000, true);
        view.setUint16(32, 4, true);
        view.setUint16(34, 16, true);
        text(36, 'data');
        view.setUint32(40, frames * 4, true);
        // Silence still exercises the native PCM/AudioContext scheduling path.
        const audio = await editor.assets.import(
          new File([wav], 'silence.wav', { type: 'audio/wav' }),
        ).completion;
        const ids: { workload: string; id: string }[] = [];
        for (const effects of [false, true]) {
          const p = await editor.projects.create(
            effects ? 'FPS color grade' : 'FPS plain video',
            { width: 1920, height: 1080, frameRate: { num: 30, den: 1 } },
          );
          await editor.commands.apply({
            projectId: p.id,
            expectedRevision: 0,
            requestId: 'fps-assembly',
            operations: [
              { type: 'addTrack', track: { id: 'v', kind: 'video' } },
              { type: 'addTrack', track: { id: 'a', kind: 'audio' } },
              { type: 'addTrack', track: { id: 'o', kind: 'overlay' } },
              {
                type: 'insertClip',
                trackId: 'v',
                clip: {
                  id: 'video',
                  kind: 'video',
                  assetId: video.id,
                  startUs: 0,
                  durationUs: 12000000,
                  sourceOutUs: 12000000,
                  width: 1920,
                  height: 1080,
                  ...(effects
                    ? {
                        colorPreset: 'warm' as const,
                        colorStrength: 0.5,
                        saturation: 1.1,
                      }
                    : {}),
                },
              },
              {
                type: 'insertClip',
                trackId: 'a',
                clip: {
                  id: 'audio',
                  kind: 'audio',
                  assetId: audio.id,
                  startUs: 0,
                  durationUs: 12000000,
                  sourceOutUs: 12000000,
                },
              },
              ...Array.from({ length: 60 }, (_, i) => ({
                type: 'insertClip' as const,
                trackId: 'o',
                clip: {
                  id: 'label-' + i,
                  kind: 'text' as const,
                  startUs: i * 200000,
                  durationUs: 200000,
                  y: 900,
                  text: { text: 'Timeline label ' + i, fontSize: 48 },
                },
              })),
            ],
          });
          ids.push({ workload: effects ? 'graded' : 'plain', id: p.id });
        }
        return ids;
      } finally {
        await editor.dispose();
      }
    }, base);
    const measurements = [];
    for (const project of projects) {
      await page.goto(`${base}#/project/${project.id}`);
      const play = page.getByRole('button', {
        name: 'Play preview',
        exact: true,
      });
      const pause = page.getByRole('button', {
        name: 'Pause preview',
        exact: true,
      });
      await expect(play).toBeVisible();
      await page.evaluate(() => {
        const native = CanvasRenderingContext2D.prototype.drawImage;
        const target = document.querySelector<HTMLCanvasElement>(
          'canvas[aria-label="Video preview"]',
        )!;
        const sample = new OffscreenCanvas(64, 36);
        const sampleContext = sample.getContext('2d', {
          willReadFrequently: true,
        })!;
        const meter = {
          writes: 0,
          content: 0,
          width: 0,
          height: 0,
          frames: [] as {
            at: number;
            writes: number;
            timeUs: number;
            content: number;
          }[],
          recording: false,
          raf: 0,
        };
        CanvasRenderingContext2D.prototype.drawImage = function (
          this: CanvasRenderingContext2D,
          ...args: [CanvasImageSourceWebCodecs, ...number[]]
        ) {
          Reflect.apply(native, this, args);
          if (this.canvas === target) {
            meter.writes++;
            const image = args[0] as ImageBitmap;
            meter.width = image.width;
            meter.height = image.height;
            sampleContext.drawImage(image, 0, 0, 64, 36);
            const pixels = sampleContext.getImageData(0, 0, 64, 36).data;
            let hash = 2166136261;
            for (const value of pixels)
              hash = Math.imul(hash ^ value, 16777619);
            meter.content = hash;
          }
        };
        let seen = meter.writes;
        const tick = () => {
          if (meter.recording && meter.writes !== seen) {
            meter.frames.push({
              content: meter.content,
              at: performance.now(),
              writes: meter.writes,
              timeUs: Number(
                document
                  .querySelector('[aria-label="Playhead position"]')
                  ?.getAttribute('aria-valuenow'),
              ),
            });
          }
          seen = meter.writes;
          meter.raf = requestAnimationFrame(tick);
        };
        meter.raf = requestAnimationFrame(tick);
        Object.assign(window, { playbackMeter: meter });
      });
      for (let trial = 0; trial < 3; trial++) {
        await page
          .getByRole('button', { name: 'Go to first frame', exact: true })
          .click();
        await play.click();
        await expect(pause).toBeVisible();
        // Warm source/PCM/font caches and exclude startup from steady playback.
        await expect
          .poll(async () =>
            Number(
              await page
                .getByRole('slider', { name: 'Playhead position' })
                .getAttribute('aria-valuenow'),
            ),
          )
          .toBeGreaterThan(1000000);
        const result = await page.evaluate(async () => {
          const meter = (
            window as unknown as {
              playbackMeter: {
                writes: number;
                width: number;
                height: number;
                recording: boolean;
                frames: {
                  at: number;
                  writes: number;
                  timeUs: number;
                  content: number;
                }[];
              };
            }
          ).playbackMeter;
          meter.frames = [];
          const started = performance.now();
          const startUs = Number(
            document
              .querySelector('[aria-label="Playhead position"]')
              ?.getAttribute('aria-valuenow'),
          );
          meter.recording = true;
          await new Promise((resolve) => setTimeout(resolve, 5000));
          meter.recording = false;
          const elapsedMs = performance.now() - started;
          const distinct = meter.frames.filter(
            (frame, i) =>
              i === 0 || frame.content !== meter.frames[i - 1]!.content,
          );
          const gaps = distinct
            .slice(1)
            .map((f, i) => f.at - distinct[i]!.at)
            .sort((a, b) => a - b);
          return {
            fps: (distinct.length * 1000) / elapsedMs,
            canvasWritesPerSecond: (meter.frames.length * 1000) / elapsedMs,
            frames: distinct.length,
            elapsedMs,
            p95GapMs: gaps[Math.floor(gaps.length * 0.95)] ?? 0,
            maxGapMs: gaps.at(-1) ?? 0,
            playbackAdvanceUs:
              Number(
                document
                  .querySelector('[aria-label="Playhead position"]')
                  ?.getAttribute('aria-valuenow'),
              ) - startUs,
            bitmapWidth: meter.width,
            bitmapHeight: meter.height,
          };
        });
        await pause.click();
        measurements.push({
          workload: project.workload,
          trial: trial + 1,
          ...result,
        });
        const minimumFps = Number(process.env.LOCALCUT_PLAYBACK_MIN_FPS ?? 0);
        expect(result.fps).toBeGreaterThan(minimumFps);
        expect(result.playbackAdvanceUs).toBeGreaterThan(4000000);
      }
    }
    console.log('PLAYBACK_MEASUREMENTS', JSON.stringify(measurements));
    await info.attach('playback-fps.json', {
      body: JSON.stringify(measurements, null, 2),
      contentType: 'application/json',
    });
  });
}
