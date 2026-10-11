import { expect, test } from '@playwright/test';

for (const base of ['/', '/LocalCut/']) {
  test(`preview frame controls keep integer positions and resume playback ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    for (const frameRate of [
      { num: 30, den: 1 },
      { num: 30000, den: 1001 },
    ]) {
      const durationUs = 1_000_021;
      const id = await page.evaluate(
        async ({ base, frameRate, durationUs }) => {
          const { createEditor } = (await import(
            base + 'editor.js'
          )) as typeof import('../../src/editor');
          const editor = await createEditor();
          try {
            const canvas = new OffscreenCanvas(128, 72);
            const context = canvas.getContext('2d')!;
            context.fillStyle = '#ff0000';
            context.fillRect(0, 0, 128, 72);
            const asset = await editor.assets.import(
              new File(
                [await canvas.convertToBlob({ type: 'image/png' })],
                'playback.png',
                { type: 'image/png' },
              ),
            ).completion;
            const project = await editor.projects.create('Frame playback', {
              width: 128,
              height: 72,
              frameRate,
            });
            await editor.commands.apply({
              projectId: project.id,
              expectedRevision: project.revision,
              requestId: crypto.randomUUID(),
              operations: [
                { type: 'addTrack', track: { id: 'video', kind: 'video' } },
                {
                  type: 'insertClip',
                  trackId: 'video',
                  clip: {
                    id: 'image',
                    kind: 'image',
                    assetId: asset.id,
                    startUs: 0,
                    durationUs,
                    width: 128,
                    height: 72,
                  },
                },
              ],
            });
            return project.id;
          } finally {
            await editor.dispose();
          }
        },
        { base, frameRate, durationUs },
      );
      await page.goto(`${base}#/project/${id}`);
      const playhead = page.getByRole('slider', { name: 'Playhead position' });
      const next = page.getByRole('button', {
        name: 'Next frame',
        exact: true,
      });
      const previous = page.getByRole('button', {
        name: 'Previous frame',
        exact: true,
      });
      const play = page.getByRole('button', {
        name: 'Play preview',
        exact: true,
      });
      const pause = page.getByRole('button', {
        name: 'Pause preview',
        exact: true,
      });
      const position = async () =>
        Number(await playhead.getAttribute('aria-valuenow'));
      const frameUs = (1e6 * frameRate.den) / frameRate.num;
      await next.click();
      await previous.click();
      await expect(playhead).toHaveAttribute('aria-valuenow', '0');
      await next.click();
      await play.click();
      await expect(pause).toBeVisible();
      await expect.poll(position).toBeGreaterThan(frameUs + 50_000);
      await pause.click();
      const stopped = await position();
      expect(Number.isSafeInteger(stopped)).toBe(true);
      await previous.click();
      expect(await position()).toBe(Math.round(stopped - frameUs));
      await play.click();
      await expect(pause).toBeVisible();
      await expect.poll(position).toBeGreaterThan(stopped);
      await pause.click();

      // End moves to the final frame. Repeated Next clamps to the preview's
      // last-frame boundary, which is fractional at these frame rates.
      await playhead.press('End');
      await next.click();
      await next.click();
      await expect(playhead).toHaveAttribute(
        'aria-valuenow',
        String(Math.round(durationUs - frameUs)),
      );
      await play.click();
      // The marker is bounded to the project's half-open interval, even when
      // the playback clock reaches the exact endpoint.
      await expect(playhead).toHaveAttribute(
        'aria-valuenow',
        String(durationUs - 1),
      );
      await expect(play).toBeVisible();
      await play.click();
      await expect(pause).toBeVisible();
      await expect.poll(position).toBeGreaterThan(50_000);
      await pause.click();
      expect(await position()).toBeLessThan(durationUs);
      await expect(
        page.getByText('Seek outside project', { exact: true }),
      ).toHaveCount(0);
    }
  });
}
