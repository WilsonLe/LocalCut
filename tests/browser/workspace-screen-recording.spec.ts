import { openWorkspaceGroup } from './workspace-settings-helper';
import { chromium, expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Asset, Project } from '../../src/editor';

async function source(page: Page) {
  await page.evaluate(() => {
    const state = {
      calls: 0,
      mode: 'ready',
      stream: null as MediaStream | null,
      release: null as (() => void) | null,
      options: null as DisplayMediaStreamOptions | null,
    };
    Object.assign(window, { recordingFixture: state });
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: async (options: DisplayMediaStreamOptions) => {
        state.calls++;
        state.options = options;
        if (state.mode === 'denied')
          throw new DOMException('Denied', 'NotAllowedError');
        if (state.mode === 'held')
          await new Promise<void>((resolve) => {
            state.release = resolve;
          });
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext('2d')!;
        let frame = 0;
        const draw = () => {
          ctx.fillStyle = '#00ff00';
          ctx.fillRect(0, 0, 320, 180);
          ctx.fillStyle = '#ff0000';
          ctx.fillRect((frame++ % 10) * 10, 0, 10, 10);
        };
        draw();
        const stream = canvas.captureStream(30);
        const timer = setInterval(draw, 33);
        if (options.audio && state.mode !== 'no-audio') {
          const audio = new AudioContext();
          const oscillator = audio.createOscillator();
          const gain = audio.createGain();
          gain.gain.value = 0.1;
          const sink = audio.createMediaStreamDestination();
          oscillator.connect(gain).connect(sink);
          oscillator.start();
          void audio.resume();
          stream.addTrack(sink.stream.getAudioTracks()[0]!);
          const track = sink.stream.getAudioTracks()[0]!;
          const stop = track.stop.bind(track);
          track.stop = () => {
            oscillator.stop();
            void audio.close();
            stop();
          };
        }
        const track = stream.getVideoTracks()[0]!;
        const stop = track.stop.bind(track);
        track.stop = () => {
          clearInterval(timer);
          stop();
        };
        state.stream = stream;
        return stream;
      },
    });
  });
}
async function fixture(page: Page, expression: string) {
  return page.evaluate((expression) => {
    const state = (
      window as unknown as {
        recordingFixture: {
          mode: string;
          calls: number;
          stream: MediaStream;
          release: () => void;
        };
      }
    ).recordingFixture;
    if (
      expression === 'denied' ||
      expression === 'held' ||
      expression === 'ready' ||
      expression === 'no-audio'
    )
      state.mode = expression;
    if (expression === 'release') state.release();
    if (expression === 'ended') {
      state.stream.getVideoTracks()[0]!.stop();
      state.stream.getVideoTracks()[0]!.dispatchEvent(new Event('ended'));
    }
    return {
      calls: state.calls,
      ended:
        state.stream
          ?.getTracks()
          .every((track) => track.readyState === 'ended') ?? false,
    };
  }, expression);
}
async function open(page: Page) {
  const expand = page.getByRole('button', {
    name: 'Expand media',
    exact: true,
  });
  await expect(
    page.getByRole('button', { name: /^(Expand|Collapse) media$/ }),
  ).toBeVisible();
  if (await expand.isVisible()) await expand.click();
  await page
    .getByRole('button', { name: 'Record screen', exact: true })
    .click();
  return page.getByRole('dialog', { name: 'Record screen', exact: true });
}
async function snapshot(
  page: Page,
  base: string,
): Promise<{ project: Project; assets: Asset[] }> {
  return page.evaluate(async (base) => {
    const { createEditor } = (await import(
      base + 'editor.js'
    )) as typeof import('../../src/editor');
    const editor = await createEditor();
    try {
      const project = await editor.projects.snapshot(
        (await editor.projects.list())[0]!.id,
      );
      const ids = [
        ...new Set(
          project.tracks.flatMap((track) =>
            track.clips
              .map((clip) => clip.assetId)
              .filter((id): id is string => !!id),
          ),
        ),
      ];
      const assets = await Promise.all(
        ids.map((id) => editor.assets.inspect(id)),
      );
      return { project, assets };
    } finally {
      await editor.dispose();
    }
  }, base);
}
for (const base of ['/', '/LocalCut/']) {
  test(`screen recording native media imports, persists and exports ${base}`, async ({
    page,
  }, info) => {
    await page.goto(base);
    await source(page);
    let dialog = await open(page);
    expect((await fixture(page, '')).calls).toBe(0);
    await dialog
      .getByRole('checkbox', { name: 'Include shared audio' })
      .check();
    await dialog
      .getByRole('button', { name: 'Choose source and record' })
      .click();
    await expect(
      dialog.getByRole('button', { name: 'Stop recording' }),
    ).toBeVisible();
    await expect(dialog.getByRole('status')).toContainText('0:01');
    await page.screenshot({ path: info.outputPath('recording-live.png') });
    await dialog.getByRole('button', { name: 'Stop recording' }).click();
    await expect(
      dialog.getByRole('button', { name: 'Add to media' }),
    ).toBeEnabled();
    expect((await fixture(page, '')).ended).toBe(true);
    const preview = dialog.getByLabel('Recorded video preview');
    await expect
      .poll(() =>
        preview.evaluate((video: HTMLVideoElement) => video.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: info.outputPath('recording-ready-narrow.png'),
    });
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await dialog.getByRole('button', { name: 'Add to media' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page
        .getByRole('button', { name: /Screen recording .*webm/, exact: false })
        .first(),
    ).toBeVisible();
    const saved = await snapshot(page, base);
    expect(saved.assets[0]).toMatchObject({
      kind: 'video',
      width: 320,
      height: 180,
      status: 'ready',
      videoCodec: 'vp9',
      audioCodec: 'opus',
    });
    expect(saved.assets[0]!.durationUs).toBeGreaterThan(500000);
    const projectId = saved.project.id;
    await page.reload();
    await expect
      .poll(async () => (await snapshot(page, base)).project.id)
      .toBe(projectId);
    const exportMenu = await openWorkspaceGroup(page, 'Export');
    await expect(
      exportMenu.getByRole('menuitem', { name: 'Export video', exact: true }),
    ).toBeEnabled();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    // Exercise actual native exports and reopen them through the public facade.
    const exports = await page.evaluate(
      async ({ base, projectId }) => {
        const { createEditor } = (await import(
          base + 'editor.js'
        )) as typeof import('../../src/editor');
        const editor = await createEditor();
        try {
          const results = [];
          for (const format of ['mp4', 'webm'] as const) {
            const artifact = await editor.exports.start(projectId, { format })
              .completion;
            try {
              const file = artifact.file;
              const asset = await editor.assets.import(
                new File([file], 'export.' + format, { type: file.type }),
              ).completion;
              const frames = await editor.assets.thumbnails(asset.id, [0], 32)
                .completion;
              const bitmap = await createImageBitmap(frames[0]!.blob);
              const canvas = new OffscreenCanvas(32, 18);
              const ctx = canvas.getContext('2d')!;
              ctx.drawImage(bitmap, 0, 0, 32, 18);
              bitmap.close();
              results.push({
                audio: asset.audioCodec,
                peak: Math.max(
                  ...(await editor.assets.waveform(asset.id, 32).completion),
                ),
                pixel: [...ctx.getImageData(16, 9, 1, 1).data],
              });
            } finally {
              await artifact.dispose();
            }
          }
          return results;
        } finally {
          await editor.dispose();
        }
      },
      { base, projectId },
    );
    expect(exports.map((result) => result.audio)).toEqual(['aac', 'opus']);
    for (const result of exports) {
      expect(result.pixel[1]).toBeGreaterThan(220);
      expect(result.peak).toBeGreaterThan(0.05);
    }
    await source(page);
    dialog = await open(page);
    await fixture(page, 'denied');
    await dialog
      .getByRole('button', { name: 'Choose source and record' })
      .click();
    await expect(dialog.getByRole('alert')).toContainText(
      'cancelled or denied',
    );
    await fixture(page, 'ready');
    await dialog
      .getByRole('button', { name: 'Choose source and record' })
      .click();
    await expect(
      dialog.getByRole('button', { name: 'Stop recording' }),
    ).toBeVisible();
    await expect(dialog.getByRole('status')).toContainText('0:01');
    await fixture(page, 'ended');
    await expect(
      dialog.getByRole('button', { name: 'Add to media' }),
    ).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    expect((await fixture(page, '')).ended).toBe(true);
    expect((await snapshot(page, base)).project.revision).toBe(
      saved.project.revision,
    );
  });

  test(`screen recording requires requested sound and allows source retry or video-only capture ${base}`, async ({
    page,
  }, info) => {
    await page.goto(base);
    await source(page);
    const dialog = await open(page);
    const audio = dialog.getByRole('checkbox', {
      name: 'Include shared audio',
      exact: true,
    });
    await audio.check();
    await fixture(page, 'no-audio');
    await dialog
      .getByRole('button', { name: 'Choose source and record' })
      .click();
    await expect(dialog.getByRole('alert')).toContainText(
      'Your browser did not share audio',
    );
    await expect(dialog).toContainText('Chrome');
    await expect(
      dialog.getByRole('button', { name: 'Stop recording' }),
    ).not.toBeVisible();
    expect((await fixture(page, '')).ended).toBe(true);
    expect(await page.evaluate(() => indexedDB.databases())).toHaveLength(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: info.outputPath('missing-shared-audio.png'),
    });
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await fixture(page, 'ready');
    await dialog
      .getByRole('button', { name: 'Choose source and record' })
      .click();
    await expect(dialog.getByRole('status')).toContainText(
      'Shared audio included',
    );
    await expect(dialog.getByRole('status')).toContainText('0:01');
    await page.evaluate(() => {
      const stream = (
        window as unknown as { recordingFixture: { stream: MediaStream } }
      ).recordingFixture.stream;
      stream.getAudioTracks()[0]!.stop();
      stream.getAudioTracks()[0]!.dispatchEvent(new Event('ended'));
    });
    await expect(dialog.getByRole('status')).toContainText(
      'shared audio ended',
    );
    await expect(
      dialog.getByRole('button', { name: 'Add to media' }),
    ).toBeEnabled();
    await page.screenshot({ path: info.outputPath('audio-ended-ready.png') });
    expect((await fixture(page, '')).ended).toBe(true);
    await dialog.getByRole('button', { name: 'Discard', exact: true }).click();
    await open(page);
    await audio.uncheck();
    await fixture(page, 'no-audio');
    await dialog
      .getByRole('button', { name: 'Choose source and record' })
      .click();
    await expect(
      dialog.getByRole('button', { name: 'Stop recording' }),
    ).toBeVisible();
    await expect(dialog.getByRole('status')).toContainText('0:01');
    await dialog.getByRole('button', { name: 'Stop recording' }).click();
    await expect(
      dialog.getByRole('button', { name: 'Add to media' }),
    ).toBeEnabled();
    await dialog.getByRole('button', { name: 'Discard', exact: true }).click();
    expect((await fixture(page, '')).ended).toBe(true);
  });

  test(`screen recording pending permission and active capture discard ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    await source(page);
    let dialog = await open(page);
    await fixture(page, 'held');
    await dialog
      .getByRole('button', { name: 'Choose source and record' })
      .click();
    await expect(dialog.getByRole('status')).toBeVisible();
    await dialog.getByRole('button', { name: 'Discard', exact: true }).click();
    await fixture(page, 'release');
    await expect.poll(async () => (await fixture(page, '')).ended).toBe(true);
    await fixture(page, 'ready');
    dialog = await open(page);
    await dialog
      .getByRole('button', { name: 'Choose source and record' })
      .click();
    await expect(
      dialog.getByRole('button', { name: 'Stop recording' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    expect((await fixture(page, '')).ended).toBe(true);
    // Discard never initialized editing storage or created a project.
    expect(await page.evaluate(() => indexedDB.databases())).toHaveLength(0);
    dialog = await open(page);
    await dialog
      .getByRole('button', { name: 'Choose source and record' })
      .click();
    await expect(
      dialog.getByRole('button', { name: 'Stop recording' }),
    ).toBeVisible();
    await page.evaluate(() => {
      location.hash = '#/invalid-recording-route';
    });
    await expect(dialog).not.toBeVisible();
    await expect.poll(async () => (await fixture(page, '')).ended).toBe(true);
    await page.goBack();
    await expect(
      page.getByRole('button', { name: 'Workspace settings', exact: true }),
    ).toBeVisible();
    await expect(dialog).not.toBeVisible();
  });
}

// A dedicated stable-Chrome instance selects only our synthetic tab. This exercises
// real getDisplayMedia without recording the user's desktop or replacing capture.
test('screen recording native tab capture at both static bases', async ({
  baseURL,
}) => {
  test.setTimeout(60000);
  const browser = await chromium.launch({
    channel: 'chrome',
    executablePath: process.env.LOCALCUT_CHROME_EXECUTABLE,
    // Headless defaults mute browser output, including the tab audio we test.
    ignoreDefaultArgs: ['--mute-audio'],
    args: [
      '--auto-select-tab-capture-source-by-title=LocalCut capture fixture',
    ],
  });
  try {
    for (const base of ['/', '/LocalCut/']) {
      const context = await browser.newContext({ reducedMotion: 'reduce' });
      try {
        const origin = baseURL!;
        const target = await context.newPage();
        await target.route('**/capture-fixture', (route) =>
          route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><title>LocalCut capture fixture</title><style>body{margin:0;background:#00ff00}div{width:10px;height:10px;background:red;animation:move 1s infinite alternate}@keyframes move{to{transform:translateX(100px)}}</style><div></div>',
          }),
        );
        await target.goto(origin + '/capture-fixture');
        await target.evaluate(() => {
          const button = document.createElement('button');
          button.textContent = 'Play fixture sound';
          button.onclick = () => {
            const audio = new AudioContext();
            Object.assign(window, { fixtureAudio: audio });
            const oscillator = audio.createOscillator();
            const gain = audio.createGain();
            gain.gain.value = 0.1;
            oscillator.connect(gain).connect(audio.destination);
            oscillator.start();
            void audio.resume();
            window.addEventListener(
              'pagehide',
              () => {
                void audio.close();
              },
              { once: true },
            );
          };
          document.body.append(button);
        });
        await target
          .getByRole('button', { name: 'Play fixture sound' })
          .click();
        await expect
          .poll(() =>
            target.evaluate(
              () =>
                (window as unknown as { fixtureAudio: AudioContext })
                  .fixtureAudio.state,
            ),
          )
          .toBe('running');
        const page = await context.newPage();
        await page.goto(origin + base);
        await page.evaluate(() => {
          const capture = navigator.mediaDevices.getDisplayMedia.bind(
            navigator.mediaDevices,
          );
          navigator.mediaDevices.getDisplayMedia = async (options) => {
            const stream = await capture(options);
            Object.assign(window, { nativeCapture: stream });
            return stream;
          };
        });
        const dialog = await open(page);
        await dialog
          .getByRole('checkbox', { name: 'Include shared audio', exact: true })
          .check();
        await dialog
          .getByRole('button', { name: 'Choose source and record' })
          .click();
        await expect(
          dialog.getByRole('button', { name: 'Stop recording' }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () =>
              (
                window as unknown as { nativeCapture: MediaStream }
              ).nativeCapture
                .getVideoTracks()[0]!
                .getSettings().displaySurface,
          ),
        ).toBe('browser');
        await expect(dialog.getByRole('status')).toContainText('0:01');
        // Cover real browser whole-source cessation as well as LocalCut stop.
        if (base === '/LocalCut/') await target.close();
        else
          await dialog.getByRole('button', { name: 'Stop recording' }).click();
        await expect(
          dialog.getByRole('button', { name: 'Add to media' }),
        ).toBeEnabled();
        await dialog.getByRole('button', { name: 'Add to media' }).click();
        await expect(dialog).not.toBeVisible();
        await expect
          .poll(async () => (await snapshot(page, base)).assets.length)
          .toBe(1);
        const saved = await snapshot(page, base);
        expect(saved.assets[0]!.videoCodec).toBe('vp9');
        expect(saved.assets[0]!.audioCodec).toBe('opus');
        const peak = await page.evaluate(
          async ({ base, assetId }) => {
            const { createEditor } = (await import(
              base + 'editor.js'
            )) as typeof import('../../src/editor');
            const editor = await createEditor();
            try {
              return Math.max(
                ...(await editor.assets.waveform(assetId, 32).completion),
              );
            } finally {
              await editor.dispose();
            }
          },
          { base, assetId: saved.assets[0]!.id },
        );
        expect(peak).toBeGreaterThan(0.05);
        expect(saved.assets[0]!.durationUs).toBeGreaterThan(500000);
        const green = await page.evaluate(
          async ({ base, assetId, timeUs }) => {
            const { createEditor } = (await import(
              base + 'editor.js'
            )) as typeof import('../../src/editor');
            const editor = await createEditor();
            try {
              const frames = await editor.assets.thumbnails(
                assetId,
                [timeUs],
                32,
              ).completion;
              const bitmap = await createImageBitmap(frames[0]!.blob);
              const canvas = new OffscreenCanvas(32, 18);
              const ctx = canvas.getContext('2d')!;
              ctx.drawImage(bitmap, 0, 0, 32, 18);
              bitmap.close();
              return ctx.getImageData(16, 9, 1, 1).data[1];
            } finally {
              await editor.dispose();
            }
          },
          {
            base,
            assetId: saved.assets[0]!.id,
            timeUs: Math.floor(saved.assets[0]!.durationUs / 2),
          },
        );
        expect(green).toBeGreaterThan(220);
        expect(
          await page.evaluate(() =>
            (window as unknown as { nativeCapture: MediaStream }).nativeCapture
              .getTracks()
              .every((track) => track.readyState === 'ended'),
          ),
        ).toBe(true);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
});
