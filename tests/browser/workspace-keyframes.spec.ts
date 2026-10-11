import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Project } from '../../src/editor';

async function snapshot(
  page: Page,
  base: string,
  id: string,
): Promise<Project> {
  return page.evaluate(
    async ({ base, id }) => {
      const { createEditor } = await import(base + 'editor.js');
      const editor = await createEditor();
      try {
        return await editor.projects.snapshot(id);
      } finally {
        await editor.dispose();
      }
    },
    { base, id },
  );
}

async function sourceDigest(page: Page, assetId: string) {
  return page.evaluate(async (assetId) => {
    const root = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle('localcut');
    const original = await (await root.getFileHandle(assetId)).getFile();
    return Array.from(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', await original.arrayBuffer()),
      ),
    );
  }, assetId);
}

for (const base of ['/', '/LocalCut/']) {
  test(`object keyframes isolate instances, persist and render native exports @journey ${base}`, async ({
    page,
  }, testInfo) => {
    await page.goto(base);
    const id = await page.evaluate(async (base) => {
      const { createEditor } = await import(base + 'editor.js');
      const editor = await createEditor();
      try {
        const p = await editor.projects.create('Object animation', {
          width: 256,
          height: 144,
        });
        const canvas = new OffscreenCanvas(32, 32),
          ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'red';
        ctx.fillRect(0, 0, 32, 32);
        const source = await editor.assets.import(
          new File([await canvas.convertToBlob()], 'Square.png', {
            type: 'image/png',
          }),
        ).completion;
        await editor.commands.apply({
          projectId: p.id,
          expectedRevision: 0,
          requestId: 'seed',
          operations: [
            { type: 'addTrack', track: { id: 'track', kind: 'video' } },
            ...['first', 'second'].map((id, index) => ({
              type: 'insertClip',
              trackId: 'track',
              clip: {
                id,
                kind: 'image',
                assetId: source.id,
                startUs: index * 2e6,
                durationUs: 2e6,
                width: 32,
                height: 32,
              },
            })),
          ],
        });
        return p.id;
      } finally {
        await editor.dispose();
      }
    }, base);
    await page.goto(`${base}#/project/${id}`);
    const first = page.locator('[data-clip-id="first"]');
    const form = page.getByRole('dialog', {
      name: 'Clip properties',
      exact: true,
    });
    const initial = await snapshot(page, base, id);
    const digest = await sourceDigest(
      page,
      initial.tracks[0]!.clips[0]!.assetId!,
    );
    await test.step('author several properties and reject duplicate times', async () => {
      await first.dblclick();
      await form.getByText('Animation', { exact: true }).click();
      await form
        .getByRole('button', { name: 'Add at playhead', exact: true })
        .click();
      await form
        .getByRole('button', { name: 'Add at end', exact: true })
        .click();
      await form
        .getByLabel('Point 2 time (seconds)', { exact: true })
        .fill('0');
      await expect(
        form.getByRole('button', { name: 'Apply properties' }),
      ).toHaveCount(0);
      await form
        .getByLabel('Point 2 time (seconds)', { exact: true })
        .fill('2');
      await form.getByLabel('Point 2 value', { exact: true }).fill('160');
      await form
        .getByRole('combobox', { name: 'Animated property', exact: true })
        .click();
      await page.getByRole('option', { name: 'Opacity', exact: true }).click();
      await form
        .getByRole('button', { name: 'Add at start', exact: true })
        .click();
      await form
        .getByRole('button', { name: 'Add at end', exact: true })
        .click();
      await form.getByLabel('Point 2 value', { exact: true }).fill('0.5');
      for (const [label, incomplete, repaired] of [
        ['Point 2 value', '', '0.5'],
        ['Point 2 time (seconds)', '', '2'],
        ['Base value', '', '1'],
        ['Point 2 value', '2', '0.5'],
      ]) {
        await form.getByLabel(label!, { exact: true }).fill(incomplete!);
        await form
          .getByRole('combobox', { name: 'Animated property', exact: true })
          .click();
        await page.getByRole('option', { name: /^Position X/ }).click();
        await expect(
          form.getByRole('button', { name: 'Apply properties', exact: true }),
        ).toHaveCount(0);
        // Enter must not publish a hidden property's incomplete numeric draft.
        await form.getByLabel('Base value', { exact: true }).press('Enter');
        await expect(form).toBeVisible();
        expect(await snapshot(page, base, id)).toEqual(initial);
        await form
          .getByRole('combobox', { name: 'Animated property', exact: true })
          .click();
        await page.getByRole('option', { name: /^Opacity/ }).click();
        await expect(form.getByLabel(label!, { exact: true })).toHaveValue(
          incomplete!,
        );
        await form.getByLabel(label!, { exact: true }).fill(repaired!);
        await expect(
          form.getByRole('button', { name: 'Apply properties', exact: true }),
        ).toBeVisible();
      }
      await expect(
        form.getByRole('img', { name: 'Keyframe animation graph' }),
      ).toBeVisible();
      await testInfo.attach('animation-controls', {
        body: await form.screenshot(),
        contentType: 'image/png',
      });
      await form
        .getByRole('button', { name: 'Apply properties', exact: true })
        .click();
      await expect(form).not.toBeVisible();
      const p = await snapshot(page, base, id);
      expect(p.tracks[0]!.clips[1]).toEqual(initial.tracks[0]!.clips[1]);
      expect(
        p.tracks[0]!.clips[0]!.keyframes.x?.map((key) => key.value),
      ).toEqual([0, 160]);
      expect(
        p.tracks[0]!.clips[0]!.keyframes.opacity?.map((key) => key.value),
      ).toEqual([1, 0.5]);
    });
    const authored = await snapshot(page, base, id);
    let timedProjectId = '';
    await test.step('reload and history retain instance-owned curves', async () => {
      await page.reload();
      await first.click();
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect
        .poll(
          async () =>
            (await snapshot(page, base, id)).tracks[0]!.clips[0]!.keyframes,
        )
        .toEqual({});
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect
        .poll(
          async () =>
            (await snapshot(page, base, id)).tracks[0]!.clips[0]!.keyframes,
        )
        .toEqual(authored.tracks[0]!.clips[0]!.keyframes);
    });
    await test.step('real worker pixels and reopened MP4/WebM prove movement and opacity', async () => {
      const output = await page.evaluate(
        async ({ base, id }) => {
          const { createEditor } = await import(base + 'editor.js');
          const editor = await createEditor();
          const canvas = new OffscreenCanvas(256, 144),
            ctx = canvas.getContext('2d')!;
          const pixels = async (projectId: string, timeUs: number) => {
            const frame = await editor.preview.frame(projectId, timeUs)
              .completion;
            try {
              ctx.drawImage(frame.image, 0, 0);
              return [16, 96].map((x) =>
                Array.from(ctx.getImageData(x, 16, 1, 1).data),
              );
            } finally {
              frame.image.close();
            }
          };
          try {
            const preview = await pixels(id, 1e6),
              second = await pixels(id, 2.5e6);
            const reopened = [];
            let decodedId = '';
            for (const format of ['mp4', 'webm'] as const) {
              const output = await editor.exports.start(id, { format })
                .completion;
              try {
                const asset = await editor.assets.import(
                  new File([output.file], `result.${format}`, {
                    type: format === 'mp4' ? 'video/mp4' : 'video/webm',
                  }),
                ).completion;
                const decoded = await editor.projects.create(
                  'Decoded animation',
                  { width: 256, height: 144 },
                );
                decodedId = decoded.id;
                await editor.commands.apply({
                  projectId: decoded.id,
                  requestId: 'decode',
                  expectedRevision: 0,
                  operations: [
                    {
                      type: 'addTrack',
                      track: { id: 'decoded-track', kind: 'video' },
                    },
                    {
                      type: 'insertClip',
                      trackId: 'decoded-track',
                      clip: {
                        id: 'decoded',
                        kind: 'video',
                        assetId: asset.id,
                        startUs: 0,
                        durationUs: asset.durationUs,
                        sourceOutUs: asset.durationUs,
                        width: 256,
                        height: 144,
                      },
                    },
                  ],
                });
                reopened.push(await pixels(decoded.id, 1e6));
              } finally {
                await output.dispose();
              }
            }
            return { preview, second, reopened, decodedId };
          } finally {
            await editor.dispose();
          }
        },
        { base, id },
      );
      for (const pixels of [output.preview, ...output.reopened]) {
        expect(pixels[0]![0]).toBeLessThan(20);
        expect(pixels[1]![0]).toBeGreaterThan(170);
        expect(pixels[1]![0]).toBeLessThan(210);
        expect(pixels[1]![1]).toBeLessThan(20);
      }
      expect(output.second[0]![0]).toBeGreaterThan(240);
      expect(output.second[1]![0]).toBeLessThan(20);
      timedProjectId = output.decodedId;
      expect(
        await sourceDigest(page, initial.tracks[0]!.clips[0]!.assetId!),
      ).toEqual(digest);
    });
    await test.step('mobile inspection, hold, removal and cancellation', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await first.dblclick();
      await form.getByText('Animation', { exact: true }).click();
      await form
        .getByRole('combobox', { name: 'Point 1 interpolation', exact: true })
        .click();
      await page.getByRole('option', { name: 'Hold', exact: true }).click();
      await form
        .getByRole('button', { name: 'Apply properties', exact: true })
        .click();
      await expect(form).not.toBeVisible();
      expect(
        (await snapshot(page, base, id)).tracks[0]!.clips[0]!.keyframes.x![0]!
          .interpolation,
      ).toBe('hold');
      await first.dblclick();
      await form.getByText('Animation', { exact: true }).click();
      await form.getByLabel('Point 2 value', { exact: true }).fill('');
      await form
        .getByRole('button', { name: 'Remove point 2', exact: true })
        .click();
      await form
        .getByRole('button', { name: 'Clear property animation', exact: true })
        .click();
      await form
        .getByRole('button', { name: 'Apply properties', exact: true })
        .click();
      await expect(form).not.toBeVisible();
      const cleared = await snapshot(page, base, id);
      expect(cleared.tracks[0]!.clips[0]!.keyframes.x).toEqual([]);
      expect(cleared.tracks[0]!.clips[0]!.keyframes.opacity).toEqual(
        authored.tracks[0]!.clips[0]!.keyframes.opacity,
      );
      await first.dblclick();
      await form.getByText('Animation', { exact: true }).click();
      await form
        .getByRole('button', { name: 'Add at start', exact: true })
        .click();
      await form.getByRole('button', { name: 'Close', exact: true }).click();
      expect(await snapshot(page, base, id)).toEqual(cleared);
      await page.evaluate(
        async ({ base, id }) => {
          const { createEditor } = await import(base + 'editor.js');
          const editor = await createEditor();
          try {
            const p = await editor.projects.snapshot(id);
            await editor.commands.apply({
              projectId: id,
              expectedRevision: p.revision,
              requestId: 'lock',
              operations: [
                {
                  type: 'updateTrack',
                  trackId: 'track',
                  patch: { locked: true },
                },
              ],
            });
          } finally {
            await editor.dispose();
          }
        },
        { base, id },
      );
      await page.reload();
      await first.dblclick();
      await form.getByText('Animation', { exact: true }).click();
      await expect(
        form.getByRole('button', { name: 'Add at start', exact: true }),
      ).toHaveCount(0);
      await expect(
        form.getByLabel('Base value', { exact: true }),
      ).toHaveAttribute('readonly', '');
      await expect(
        form.getByRole('button', { name: 'Apply properties', exact: true }),
      ).toHaveCount(0);
    });
    await test.step('editing a curve with a speed ramp retains engine retiming for all properties', async () => {
      const duration = await page.evaluate(
        async ({ base, id }) => {
          const { createEditor } = await import(base + 'editor.js');
          const editor = await createEditor();
          try {
            const p = await editor.projects.snapshot(id),
              clip = p.tracks[0].clips[0];
            await editor.commands.apply({
              projectId: id,
              expectedRevision: p.revision,
              requestId: 'animated-video',
              operations: [
                {
                  type: 'updateClip',
                  clipId: clip.id,
                  patch: {
                    keyframes: {
                      x: [
                        {
                          id: 'video-x-start',
                          timeUs: 0,
                          value: 0,
                          interpolation: 'linear',
                        },
                        {
                          id: 'video-x-end',
                          timeUs: clip.durationUs,
                          value: 80,
                          interpolation: 'linear',
                        },
                      ],
                    },
                  },
                },
              ],
            });
            return clip.durationUs;
          } finally {
            await editor.dispose();
          }
        },
        { base, id: timedProjectId },
      );
      await page.goto(`${base}#/project/${timedProjectId}`);
      await page.locator('[data-clip-id="decoded"]').click();
      await page
        .getByRole('button', { name: 'Clip properties', exact: true })
        .click();
      await form.getByText('Animation', { exact: true }).click();
      await form
        .getByRole('combobox', { name: 'Animated property', exact: true })
        .click();
      await page.getByRole('option', { name: 'Gain', exact: true }).click();
      await form
        .getByRole('button', { name: 'Add at start', exact: true })
        .click();
      await form
        .getByRole('button', { name: 'Add at end', exact: true })
        .click();
      await form.getByLabel('Point 2 value', { exact: true }).fill('0.25');
      await form
        .getByRole('combobox', { name: 'Speed profile', exact: true })
        .click();
      await page
        .getByRole('option', { name: 'Custom ramp', exact: true })
        .click();
      await form.getByLabel('Point 1 speed', { exact: true }).fill('2');
      await form.getByLabel('Point 2 speed', { exact: true }).fill('2');
      await form
        .getByRole('button', { name: 'Apply properties', exact: true })
        .click();
      await expect(form).not.toBeVisible();
      const clip = (await snapshot(page, base, timedProjectId)).tracks[0]!
        .clips[0]!;
      expect(clip.durationUs).toBe(Math.round(duration / 2));
      expect(clip.keyframes.x!.at(-1)!.timeUs).toBe(clip.durationUs);
      expect(clip.keyframes.gain!.at(-1)!.timeUs).toBe(clip.durationUs);
      expect(clip.keyframes.gain!.at(-1)!.value).toBe(0.25);
    });
  });
}
