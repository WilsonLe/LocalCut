import { dismissNotifications } from './workspace-notifications-helper';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Project } from '../../src/editor';

async function videoSource(page: Page, base: string) {
  return page.evaluate(async (base) => {
    const { createEditor } = (await import(
      base + 'editor.js'
    )) as typeof import('../../src/editor');
    const editor = await createEditor({
      namespace: 'test-source-' + crypto.randomUUID(),
    });
    let artifact:
      | Awaited<ReturnType<typeof editor.exports.start>['completion']>
      | undefined;
    try {
      const canvas = new OffscreenCanvas(128, 72),
        ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 128, 72);
      const image = await editor.assets.import(
        new File([await canvas.convertToBlob()], 'red.png', {
          type: 'image/png',
        }),
      ).completion;
      const speech = await editor.assets.import(
        new File(
          [await (await fetch('/fixtures/jfk.wav')).blob()],
          'speech.wav',
          { type: 'audio/wav' },
        ),
      ).completion;
      const p = await editor.projects.create('Source', {
        width: 128,
        height: 72,
      });
      await editor.commands.apply({
        projectId: p.id,
        expectedRevision: 0,
        requestId: 'source',
        operations: [
          { type: 'addTrack', track: { id: 'v', kind: 'video' } },
          { type: 'addTrack', track: { id: 'a', kind: 'audio' } },
          {
            type: 'insertClip',
            trackId: 'v',
            clip: {
              id: 'image',
              kind: 'image',
              assetId: image.id,
              startUs: 0,
              durationUs: 2000000,
              width: 128,
              height: 72,
            },
          },
          {
            type: 'insertClip',
            trackId: 'a',
            clip: {
              id: 'speech',
              kind: 'audio',
              assetId: speech.id,
              startUs: 0,
              durationUs: 2000000,
              sourceOutUs: 2000000,
            },
          },
        ],
      });
      artifact = await editor.exports.start(p.id, { format: 'mp4' }).completion;
      return [...new Uint8Array(await artifact.file.arrayBuffer())];
    } finally {
      await artifact?.dispose();
      await editor.dispose();
    }
  }, base);
}
async function snapshot(
  page: Page,
  base: string,
  name: string,
): Promise<Project> {
  return page.evaluate(
    async ({ base, name }) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const p = (await editor.projects.list()).find((p) => p.name === name);
        if (!p) throw new Error('Missing UI project');
        return editor.projects.snapshot(p.id);
      } finally {
        await editor.dispose();
      }
    },
    { base, name },
  );
}
for (const base of ['/', '/LocalCut/']) {
  test(`timeline add tracks preserves empty lanes, history and persistence ${base}`, async ({
    page,
  }, testInfo) => {
    await page.goto(base);
    const add = page.getByRole('button', { name: 'Add track', exact: true });
    await expect(add).toHaveCount(0);
    const main = page.getByRole('main', { name: 'Video editor', exact: true });
    await main.focus();
    await page.keyboard.press('n');
    await page
      .getByLabel('Project name', { exact: true })
      .fill('Track controls');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await expect(add).toBeVisible();
    const p = () => snapshot(page, base, 'Track controls');
    const lanes = page.locator('.timeline-track');
    await add.focus();
    await page.keyboard.press('Enter');
    const videoChoice = page.getByRole('button', {
      name: 'Video track',
      exact: true,
    });
    const audioChoice = page.getByRole('button', {
      name: 'Audio track',
      exact: true,
    });
    await expect(videoChoice).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(audioChoice).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(videoChoice).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(lanes).toHaveCount(1);
    await expect(add).toBeFocused();
    await expect(lanes.first()).toContainText('Video 1');
    await expect(
      page.getByRole('slider', { name: 'Playhead position' }),
    ).toHaveCount(0);
    for (const kind of ['Audio track', 'Video track']) {
      await add.click();
      await page.getByRole('button', { name: kind, exact: true }).click();
      await expect(add).toBeFocused();
    }
    await expect(lanes).toHaveCount(3);
    const saved = await p();
    expect(saved.tracks.map((track) => track.kind)).toEqual([
      'video',
      'audio',
      'video',
    ]);
    expect(saved.tracks.every((track) => track.clips.length === 0)).toBe(true);
    expect(new Set(saved.tracks.map((track) => track.id)).size).toBe(3);
    expect(saved.revision).toBe(3);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(lanes).toHaveCount(2);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(lanes).toHaveCount(3);
    expect((await p()).tracks).toEqual(saved.tracks);
    await page.reload();
    await expect(lanes).toHaveCount(3);
    expect((await p()).tracks).toEqual(saved.tracks);

    await test.step('drag and keyboard reorder saved layers with history', async () => {
      const label = lanes
        .last()
        .getByRole('button', { name: 'Reorder Video 3' });
      const from = (await label.boundingBox())!;
      const to = (await lanes.first().boundingBox())!;
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x + 20, to.y + to.height / 2, { steps: 8 });
      await page.keyboard.press('Escape');
      await page.mouse.up();
      expect((await p()).tracks).toEqual(saved.tracks);
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x + 20, to.y + to.height / 2, { steps: 8 });
      await page.mouse.up();
      await expect
        .poll(async () => (await p()).tracks.map((t) => t.id))
        .toEqual([
          saved.tracks[2]!.id,
          saved.tracks[0]!.id,
          saved.tracks[1]!.id,
        ]);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect.poll(async () => (await p()).tracks).toEqual(saved.tracks);
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      const moved = await p();
      const handle = lanes
        .first()
        .getByRole('button', { name: 'Reorder Video 1' });
      await handle.focus();
      await page.keyboard.press('Alt+ArrowDown');
      await expect
        .poll(async () => (await p()).tracks.map((t) => t.id))
        .toEqual([
          saved.tracks[0]!.id,
          saved.tracks[2]!.id,
          saved.tracks[1]!.id,
        ]);
      await expect(
        page.getByRole('button', { name: 'Reorder Video 2' }),
      ).toBeFocused();
      await page.keyboard.press('Alt+ArrowUp');
      await expect.poll(async () => (await p()).tracks).toEqual(moved.tracks);
      await page.reload();
      await expect(lanes).toHaveCount(3);
      expect((await p()).tracks).toEqual(moved.tracks);
      // Restore the original track arrangement for the import/history checks below.
      await page
        .getByRole('button', { name: 'Reorder Video 1' })
        .press('Alt+ArrowDown');
      await expect
        .poll(async () => (await p()).tracks[1]?.id)
        .toBe(saved.tracks[2]!.id);
      await page
        .getByRole('button', { name: 'Reorder Video 2' })
        .press('Alt+ArrowDown');
      await expect.poll(async () => (await p()).tracks).toEqual(saved.tracks);
    });

    const image = await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(32, 32);
      canvas.getContext('2d')!.fillRect(0, 0, 32, 32);
      return [
        ...new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer()),
      ];
    });
    const chooser = page.waitForEvent('filechooser');
    await main.focus();
    await page.keyboard.press('ControlOrMeta+i');
    await (
      await chooser
    ).setFiles({
      name: 'track.png',
      mimeType: 'image/png',
      buffer: Buffer.from(image),
    });
    await expect(page.locator('.timeline-clip.image')).toHaveCount(1);
    await expect(lanes).toHaveCount(3);
    await expect(
      page.getByRole('slider', { name: 'Playhead position' }),
    ).toHaveAttribute('aria-valuenow', '0');
    expect((await p()).tracks.map((track) => track.clips.length)).toEqual([
      1, 0, 0,
    ]);

    await page.getByRole('button', { name: 'Versions', exact: true }).click();
    await page
      .getByRole('group', { name: 'Saved versions' })
      .getByRole('button')
      .last()
      .click();
    await expect(page.getByText(/Version \d+ · Read-only/)).toBeVisible();
    await expect(add).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Return to current', exact: true })
      .click();
    await expect(add).toBeVisible();

    await add.click();
    await page.screenshot({
      path: testInfo.outputPath('add-tracks-desktop.png'),
    });
    await page.keyboard.press('Escape');
    await dismissNotifications(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await add.click();
    const menu = page.getByRole('group', { name: 'Track type', exact: true });
    await expect(menu).toBeVisible();
    const bounds = await menu.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: testInfo.outputPath('add-tracks-mobile.png'),
    });
    await page
      .getByRole('button', { name: 'Audio track', exact: true })
      .click();
    await expect(lanes).toHaveCount(4);
    expect((await p()).tracks.at(-1)?.kind).toBe('audio');
  });

  test(`timeline audio separation, grouping and editable overlap templates ${base}`, async ({
    page,
  }, testInfo) => {
    await page.goto(base);
    const buffer = Buffer.from(await videoSource(page, base));
    const main = page.getByRole('main', { name: 'Video editor', exact: true });
    await main.focus();
    await page.keyboard.press('n');
    await page.getByLabel('Project name', { exact: true }).fill('Timeline');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    const chooser = page.waitForEvent('filechooser');
    await main.focus();
    await page.keyboard.press('ControlOrMeta+i');
    await (
      await chooser
    ).setFiles([
      { name: 'first.mp4', mimeType: 'video/mp4', buffer },
      { name: 'second.mp4', mimeType: 'video/mp4', buffer },
    ]);
    const p = () => snapshot(page, base, 'Timeline');
    await expect
      .poll(async () => (await p()).tracks.flatMap((t) => t.clips).length)
      .toBe(2);
    const first = page.locator('.timeline-clip.video').nth(0),
      second = page.locator('.timeline-clip.video').nth(1);
    await first.click();
    await page
      .getByRole('button', { name: 'Separate audio', exact: true })
      .click();
    await expect
      .poll(async () => (await p()).tracks.flatMap((t) => t.clips).length)
      .toBe(3);
    const separated = await p();
    await expect(
      page.locator('.timeline-clip.audio .timeline-waveform'),
    ).toBeAttached();
    expect(separated.tracks[0]!.clips[0]!.muted).toBe(true);
    expect(
      separated.tracks.find((t) => t.kind === 'audio')!.clips[0]!.assetId,
    ).toBe(separated.tracks[0]!.clips[0]!.assetId);
    await first.click();
    await page.locator('.timeline-clip.audio').click({ modifiers: ['Shift'] });
    await page
      .getByRole('button', { name: 'Group clips', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await p()).tracks.flatMap((t) => t.clips).filter((c) => c.groupId)
            .length,
      )
      .toBe(2);
    await first.click();
    await expect(
      page.locator('.timeline-clip[aria-pressed="true"]'),
    ).toHaveCount(2);
    await page
      .getByRole('button', { name: 'Clip properties', exact: true })
      .click();
    await page.getByLabel('Start (seconds)', { exact: true }).fill('0.5');
    await page
      .getByRole('button', { name: 'Apply properties', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await p()).tracks.filter((t) => t.kind === 'audio')[0]!.clips[0]!
            .startUs,
      )
      .toBe(500000);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(async () => (await p()).tracks[0]!.clips[0]!.startUs)
      .toBe(0);
    await first.click();
    await page.keyboard.press('d');
    await expect
      .poll(async () => (await p()).tracks.flatMap((t) => t.clips).length)
      .toBe(5);
    expect(
      new Set(
        (await p()).tracks
          .flatMap((t) => t.clips)
          .flatMap((c) => (c.groupId ? [c.groupId] : [])),
      ).size,
    ).toBe(2);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(async () => (await p()).tracks.flatMap((t) => t.clips).length)
      .toBe(3);
    await first.click();
    await page.keyboard.press('Delete');
    await expect
      .poll(async () => (await p()).tracks.flatMap((t) => t.clips).length)
      .toBe(1);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(async () => (await p()).tracks.flatMap((t) => t.clips).length)
      .toBe(3);
    await first.click();
    await page.keyboard.press('ControlOrMeta+Shift+g');
    await expect
      .poll(
        async () =>
          (await p()).tracks.flatMap((t) => t.clips).filter((c) => c.groupId)
            .length,
      )
      .toBe(0);
    await second.click();
    await page
      .getByRole('button', { name: 'Clip properties', exact: true })
      .click();
    await page.getByLabel('Start (seconds)', { exact: true }).fill('1');
    await page
      .getByRole('button', { name: 'Apply properties', exact: true })
      .click();
    await expect(
      page.getByRole('button', {
        name: 'Overlap transition overlap',
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Overlap transition overlap', exact: true })
      .click();
    await page
      .getByRole('combobox', { name: 'Transition template', exact: true })
      .click();
    await page.getByRole('option', { name: 'Zoom in', exact: true }).click();
    await expect
      .poll(async () => (await p()).transitions[0]?.templateId)
      .toBe('zoom-in');
    expect(
      (await p()).tracks[0]!.clips[1]!.keyframes.width!.length,
    ).toBeGreaterThan(1);
    await page.getByRole('button', { name: 'Commands', exact: true }).click();
    await page
      .getByRole('option', { name: /Blur dissolve transition template/ })
      .click();
    await expect
      .poll(async () => (await p()).transitions[0]?.templateId)
      .toBe('blur-dissolve');
    const beforeRemove = await p();
    await page
      .getByRole('combobox', { name: 'Transition template', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'Remove blend', exact: true })
      .click();
    await expect.poll(async () => (await p()).transitions.length).toBe(0);
    expect((await p()).tracks[0]!.clips[1]!.keyframes).toEqual(
      beforeRemove.tracks[0]!.clips[1]!.keyframes,
    );
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(async () => (await p()).transitions[0]?.templateId)
      .toBe('blur-dissolve');
    await page.screenshot({
      path: testInfo.outputPath('timeline-desktop.png'),
    });
    await page.reload();
    await page
      .getByRole('button', { name: 'Open project', exact: true })
      .click();
    await page.getByRole('button', { name: /^Timeline / }).click();
    await expect(
      page.getByRole('button', {
        name: 'Blur dissolve transition overlap',
        exact: true,
      }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('button', {
        name: 'Blur dissolve transition overlap',
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('combobox', { name: 'Transition template', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('timeline-narrow.png') });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

  test(`native separated audio, template preview/export and persisted history ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const bytes = await videoSource(page, base);
    const result = await page.evaluate(
      async ({ base, bytes }) => {
        const { createEditor } = (await import(
          base + 'editor.js'
        )) as typeof import('../../src/editor');
        const namespace = 'test-timeline-' + crypto.randomUUID();
        let editor = await createEditor({ namespace });
        const audio = new AudioContext({ sampleRate: 48000 });
        const buffers: Float32Array[] = [];
        const nativeSource = audio.createBufferSource.bind(audio);
        audio.createBufferSource = () => {
          const node = nativeSource();
          const start = node.start.bind(node);
          node.start = (when = 0, offset = 0, duration?: number) => {
            buffers.push(node.buffer!.getChannelData(0).slice());
            start(when, offset, duration);
          };
          return node;
        };
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 72;
        const artifacts: Awaited<
          ReturnType<typeof editor.exports.start>['completion']
        >[] = [];
        try {
          const asset = await editor.assets.import(
            new File([Uint8Array.from(bytes)], 'source.mp4', {
              type: 'video/mp4',
            }),
          ).completion;
          const p = await editor.projects.create('Native timeline', {
            width: 128,
            height: 72,
          });
          await editor.commands.apply({
            projectId: p.id,
            expectedRevision: 0,
            requestId: 'assemble',
            operations: [
              { type: 'addTrack', track: { id: 'video', kind: 'video' } },
              { type: 'addTrack', track: { id: 'audio', kind: 'audio' } },
              {
                type: 'insertClip',
                trackId: 'video',
                clip: {
                  id: 'a',
                  kind: 'video',
                  assetId: asset.id,
                  startUs: 0,
                  durationUs: 1000000,
                  sourceInUs: 250000,
                  sourceOutUs: 1750000,
                  speed: 1.5,
                  gain: 0.4,
                  fadeInUs: 100000,
                  width: 128,
                  height: 72,
                },
              },
            ],
          });
          const sample = async () => {
            buffers.length = 0;
            const session = editor.preview.session(p.id, canvas, audio);
            try {
              await session.play();
              session.pause();
              if (!buffers.length) throw new Error('No real PCM scheduled');
              return buffers[0]!.slice();
            } finally {
              session.dispose();
            }
          };
          await audio.resume();
          const before = await sample();
          const batch = {
            projectId: p.id,
            expectedRevision: 1,
            requestId: 'separate',
            operations: [
              {
                type: 'separateAudio' as const,
                clipId: 'a',
                audioClipId: 'sound',
                trackId: 'audio',
              },
            ],
          };
          const receipt = await editor.commands.apply(batch);
          const replay = await editor.commands.apply(batch);
          const after = await sample();
          let maxDiff = 0;
          for (let i = 0; i < before.length; i++)
            maxDiff = Math.max(maxDiff, Math.abs(before[i]! - after[i]!));
          await editor.commands.apply({
            projectId: p.id,
            expectedRevision: 2,
            requestId: 'group',
            operations: [
              { type: 'groupClips', groupId: 'group', clipIds: ['a', 'sound'] },
            ],
          });
          await editor.projects.versions.save(p.id);
          const versions = await editor.projects.versions.list(p.id);
          const groupedVersion = versions[0]!;
          const backup = await editor.projects.exportJSON(p.id);
          const imported = await editor.projects.importJSON(backup);
          await editor.dispose();
          editor = await createEditor({ namespace });
          const reopened = await editor.projects.open(p.id);
          await editor.commands.undo(p.id, 'undo', reopened.revision);
          const ungrouped = await editor.projects.snapshot(p.id);
          await editor.commands.redo(p.id, 'redo', ungrouped.revision);
          const restored = await editor.projects.snapshot(p.id);
          const historical = await editor.projects.versions.snapshot(
            p.id,
            groupedVersion.id,
          );
          await editor.commands.apply({
            projectId: p.id,
            expectedRevision: restored.revision,
            requestId: 'overlap',
            operations: [
              {
                type: 'insertClip',
                trackId: 'video',
                clip: {
                  id: 'b',
                  kind: 'video',
                  assetId: asset.id,
                  startUs: 500000,
                  durationUs: 1000000,
                  sourceOutUs: 1000000,
                  muted: true,
                  width: 128,
                  height: 72,
                },
              },
              {
                type: 'applyTransitionTemplate',
                transitionId: 'template',
                trackId: 'video',
                fromClipId: 'a',
                toClipId: 'b',
                template: 'slide-left',
                strength: 0.8,
              },
            ],
          });
          const frame = await editor.preview.frame(p.id, 750000).completion;
          canvas.getContext('2d')!.drawImage(frame.image, 0, 0);
          frame.image.close();
          const pixel = [
            ...canvas.getContext('2d')!.getImageData(64, 36, 1, 1).data,
          ];
          const formats = [];
          for (const format of ['mp4', 'webm'] as const) {
            const artifact = await editor.exports.start(p.id, { format })
              .completion;
            artifacts.push(artifact);
            const decoded = await editor.assets.import(
              new File([artifact.file], 'result.' + format, {
                type: format === 'mp4' ? 'video/mp4' : 'video/webm',
              }),
            ).completion;
            const decodedAudio = await audio.decodeAudioData(
              await artifact.file.arrayBuffer(),
            );
            formats.push({
              format,
              audioCodec: decoded.audioCodec,
              durationUs: decoded.durationUs,
              maxAudio: Math.max(
                ...decodedAudio.getChannelData(0).slice(0, 24000).map(Math.abs),
              ),
            });
          }
          const templatePixels = [];
          for (const template of [
            'crossfade',
            'black',
            'slide-left',
            'slide-right',
            'zoom-in',
            'zoom-out',
            'blur-dissolve',
          ] as const) {
            const visual = await editor.projects.create(template, {
              width: 128,
              height: 72,
            });
            await editor.commands.apply({
              projectId: visual.id,
              expectedRevision: 0,
              requestId: 'recipe',
              operations: [
                { type: 'addTrack', track: { id: 'v', kind: 'video' } },
                {
                  type: 'insertClip',
                  trackId: 'v',
                  clip: {
                    id: 'left',
                    kind: 'video',
                    assetId: asset.id,
                    startUs: 0,
                    durationUs: 1000000,
                    sourceOutUs: 1000000,
                    width: 128,
                    height: 72,
                    muted: true,
                  },
                },
                {
                  type: 'insertClip',
                  trackId: 'v',
                  clip: {
                    id: 'right',
                    kind: 'video',
                    assetId: asset.id,
                    startUs: 500000,
                    durationUs: 1000000,
                    sourceOutUs: 1000000,
                    width: 128,
                    height: 72,
                    muted: true,
                  },
                },
                {
                  type: 'applyTransitionTemplate',
                  transitionId: 't',
                  trackId: 'v',
                  fromClipId: 'left',
                  toClipId: 'right',
                  template,
                  strength: 0.8,
                },
              ],
            });
            const sample = await editor.preview.frame(visual.id, 750000)
              .completion;
            canvas.getContext('2d')!.drawImage(sample.image, 0, 0);
            sample.image.close();
            templatePixels.push({
              template,
              pixel: [
                ...canvas.getContext('2d')!.getImageData(64, 36, 1, 1).data,
              ],
            });
          }
          const silentCanvas = document.createElement('canvas');
          silentCanvas.width = 128;
          silentCanvas.height = 72;
          const stream = silentCanvas.captureStream(30);
          const recorder = new MediaRecorder(stream, {
            mimeType: 'video/webm;codecs=vp8',
          });
          const chunks: Blob[] = [];
          recorder.ondataavailable = (event) => chunks.push(event.data);
          const stopped = new Promise<void>((resolve) => {
            recorder.onstop = () => resolve();
          });
          recorder.start();
          for (let i = 0; i < 6; i++) {
            silentCanvas.getContext('2d')!.fillRect(i, 0, 10, 10);
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          recorder.stop();
          await stopped;
          for (const track of stream.getTracks()) track.stop();
          const silentAsset = await editor.assets.import(
            new File(chunks, 'silent.webm', { type: 'video/webm' }),
          ).completion;
          const silentProject = await editor.projects.create('silent');
          await editor.commands.apply({
            projectId: silentProject.id,
            expectedRevision: 0,
            requestId: 'silent-video',
            operations: [
              { type: 'addTrack', track: { id: 'v', kind: 'video' } },
              { type: 'addTrack', track: { id: 'a', kind: 'audio' } },
              {
                type: 'insertClip',
                trackId: 'v',
                clip: {
                  id: 'silent',
                  kind: 'video',
                  assetId: silentAsset.id,
                  startUs: 0,
                  durationUs: silentAsset.durationUs,
                  sourceOutUs: silentAsset.durationUs,
                },
              },
            ],
          });
          const silentError = await editor.commands
            .apply({
              projectId: silentProject.id,
              expectedRevision: 1,
              requestId: 'separate-silent',
              operations: [
                {
                  type: 'separateAudio',
                  clipId: 'silent',
                  audioClipId: 'silent-audio',
                  trackId: 'a',
                },
              ],
            })
            .then(
              () => '',
              (error: { code: string }) => error.code,
            );
          const silentUnchanged = await editor.projects.snapshot(
            silentProject.id,
          );
          return {
            templatePixels,
            silentError,
            silentRevision: silentUnchanged.revision,
            silentMuted: silentUnchanged.tracks[0]!.clips[0]!.muted,
            silentAudioCount: silentUnchanged.tracks[1]!.clips.length,
            maxDiff,
            beforeLength: before.length,
            afterLength: after.length,
            amplitude: Math.max(...before.map(Math.abs)),
            receipt,
            replay,
            importedGroups: imported.tracks
              .flatMap((t) => t.clips)
              .map((c) => c.groupId),
            reopenedGroups: reopened.tracks
              .flatMap((t) => t.clips)
              .map((c) => c.groupId),
            ungrouped: ungrouped.tracks
              .flatMap((t) => t.clips)
              .map((c) => c.groupId),
            restored: restored.tracks
              .flatMap((t) => t.clips)
              .map((c) => c.groupId),
            historical: historical.project.tracks
              .flatMap((t) => t.clips)
              .map((c) => c.groupId),
            pixel,
            formats,
          };
        } finally {
          for (const artifact of artifacts) await artifact.dispose();
          await audio.close();
          await editor.dispose();
        }
      },
      { base, bytes },
    );
    expect(result.silentError).toBe('INVALID_COMMAND');
    expect(result.silentRevision).toBe(1);
    expect(result.silentMuted).toBe(false);
    expect(result.silentAudioCount).toBe(0);
    expect(result.beforeLength).toBe(result.afterLength);
    expect(result.maxDiff).toBeLessThan(0.000001);
    expect(result.amplitude).toBeGreaterThan(0.01);
    expect(result.receipt).toEqual(result.replay);
    for (const key of [
      'importedGroups',
      'reopenedGroups',
      'restored',
      'historical',
    ] as const)
      expect(result[key]).toEqual(['group', 'group']);
    expect(result.ungrouped).toEqual([undefined, undefined]);
    for (const sample of result.templatePixels) {
      if (sample.template === 'black') expect(sample.pixel[0]).toBeLessThan(5);
      else expect(sample.pixel[0]).toBeGreaterThan(150);
      expect(sample.pixel[3]).toBe(255);
    }
    expect(result.pixel[0]).toBeGreaterThan(150);
    expect(result.pixel[3]).toBe(255);
    for (const format of result.formats) {
      expect(format.audioCodec).toBeTruthy();
      expect(format.maxAudio).toBeGreaterThan(0.01);
      expect(format.durationUs).toBeGreaterThanOrEqual(1499999);
    }
  });
}
