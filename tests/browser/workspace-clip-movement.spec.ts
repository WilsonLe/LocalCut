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
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
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

for (const base of ['/', '/LocalCut/']) {
  test(`timeline clip movement supports mouse, touch, snapping and history ${base}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(base);
    const id = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const canvas = new OffscreenCanvas(128, 72);
        canvas.getContext('2d')!.fillRect(0, 0, 128, 72);
        const image = await editor.assets.import(
          new File([await canvas.convertToBlob()], 'move.png', {
            type: 'image/png',
          }),
        ).completion;
        const p = await editor.projects.create('Clip movement', {
          width: 128,
          height: 72,
        });
        await editor.commands.apply({
          projectId: p.id,
          expectedRevision: 0,
          requestId: crypto.randomUUID(),
          operations: [
            { type: 'addTrack', track: { id: 'v1', kind: 'video' } },
            { type: 'addTrack', track: { id: 'v2', kind: 'video' } },
            { type: 'addTrack', track: { id: 'a', kind: 'audio' } },
            {
              type: 'addTrack',
              track: { id: 'locked', kind: 'video', locked: true },
            },
            {
              type: 'insertClip',
              trackId: 'v1',
              clip: {
                id: 'moving',
                kind: 'image',
                assetId: image.id,
                startUs: 0,
                durationUs: 1_000_000,
              },
            },
            {
              type: 'insertClip',
              trackId: 'v1',
              clip: {
                id: 'tail',
                kind: 'image',
                assetId: image.id,
                startUs: 4_000_000,
                durationUs: 1_000_000,
              },
            },
          ],
        });
        return p.id;
      } finally {
        await editor.dispose();
      }
    }, base);
    await page.goto(`${base}#/project/${id}`);
    await page
      .getByRole('button', { name: 'Collapse chat', exact: true })
      .click();
    const read = () => snapshot(page, base, id);
    const clip = page.locator('[data-clip-id="moving"]');
    const ghost = page.locator('.timeline-clip-move-placeholder');
    const lane = (track: string) =>
      page.locator(`[data-track-id="${track}"] .track-lane`);
    const snapping = page.getByRole('button', {
      name: 'Snapping',
      exact: true,
    });
    await expect(snapping).toHaveAttribute('aria-pressed', 'true');
    const enabledIcon = await snapping.locator('svg').innerHTML();
    await snapping.click();
    expect(await snapping.locator('svg').innerHTML()).not.toBe(enabledIcon);
    await expect(snapping).toHaveAttribute('aria-pressed', 'false');
    const begin = async (track: string, fraction: number) => {
      await clip.scrollIntoViewIfNeeded();
      const from = (await clip.boundingBox())!;
      const to = (await lane(track).boundingBox())!;
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x + to.width * fraction, to.y + to.height / 2, {
        steps: 8,
      });
      return to;
    };
    const before = await read();
    // A click stays selection-only; dragging previews without a revision.
    await clip.click();
    await expect(clip).toHaveAttribute('aria-pressed', 'true');
    expect((await read()).revision).toBe(before.revision);
    await begin('v1', 0.35);
    await expect(ghost).toBeVisible();
    const withinStart = Number(await ghost.getAttribute('data-start-us'));
    expect(withinStart).toBeCloseTo(1_250_000, -4);
    expect((await read()).revision).toBe(before.revision);
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await read()).tracks[0]!.clips.find((c) => c.id === 'moving')!
            .startUs,
      )
      .toBe(withinStart);
    const within = await read();
    expect(within.revision).toBe(before.revision + 1);
    await begin('v2', 0.6);
    await expect(ghost).toBeVisible();
    const acrossStart = Number(await ghost.getAttribute('data-start-us'));
    expect(acrossStart).toBeCloseTo(2_500_000, -4);
    await page.screenshot({
      path: testInfo.outputPath('clip-move-desktop.png'),
    });
    await page.mouse.up();
    await expect
      .poll(async () => (await read()).tracks[1]!.clips.length)
      .toBe(1);
    const moved = await read();
    expect(moved.tracks[1]!.clips[0]).toEqual({
      ...before.tracks[0]!.clips.find((c) => c.id === 'moving')!,
      startUs: acrossStart,
    });
    expect(moved.revision).toBe(within.revision + 1);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => (await read()).tracks).toEqual(within.tracks);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(async () => (await read()).tracks).toEqual(moved.tracks);
    await page.reload();
    await expect(clip).toBeVisible();
    expect((await read()).tracks).toEqual(moved.tracks);
    await expect(snapping).toHaveAttribute('aria-pressed', 'false');
    const unchanged = (await read()).revision;
    for (const target of ['a', 'locked']) {
      await begin(target, 0.4);
      await expect(ghost).toHaveCount(0);
      await page.mouse.up();
      expect((await read()).revision).toBe(unchanged);
    }
    await begin('v1', 0.4);
    await expect(ghost).toBeVisible();
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(ghost).toHaveCount(0);
    expect((await read()).revision).toBe(unchanged);
    // Either clip edge can align to another clip boundary.
    await snapping.click();
    await begin('v1', 0.703);
    await expect(ghost).toHaveAttribute('data-start-us', '3000000');
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await read()).tracks[0]!.clips.find((c) => c.id === 'moving')!
            .startUs,
      )
      .toBe(3_000_000);
    // Interface scale and timeline zoom still use physical screen pixels.
    await page.evaluate(() =>
      localStorage.setItem(
        'localcut.appearance.v1',
        JSON.stringify({ version: 1, preferences: { interfaceSize: 'large' } }),
      ),
    );
    await page.reload();
    await snapping.click();
    const view = page.getByLabel('Timeline view', { exact: true });
    await view.hover();
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -40);
    await page.keyboard.up('Control');
    await clip.scrollIntoViewIfNeeded();
    const from = (await clip.boundingBox())!;
    const to = (await lane('v2').boundingBox())!;
    const vp = (await view.boundingBox())!;
    const targetX = Math.min(
      vp.x + vp.width - 20,
      from.x + from.width / 2 + 20,
    );
    const expectedStart = Math.round(
      3_000_000 +
        ((targetX - (from.x + from.width / 2)) * 5_000_000) / to.width,
    );
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetX, to.y + to.height / 2, { steps: 8 });
    await expect(ghost).toBeVisible();
    expect(Number(await ghost.getAttribute('data-start-us'))).toBeCloseTo(
      expectedStart,
      -2,
    );
    await page.keyboard.press('Escape');
    await page.mouse.up();
    // Native Chrome touch input exercises capture and touch-action at phone size.
    await page.evaluate(() =>
      localStorage.removeItem('localcut.appearance.v1'),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await clip.scrollIntoViewIfNeeded();
    const touchFrom = (await clip.boundingBox())!;
    const touchTo = (await lane('v2').boundingBox())!;
    const x = touchFrom.x + touchFrom.width / 2;
    const y = touchFrom.y + touchFrom.height / 2;
    const cdp = await page.context().newCDPSession(page);
    try {
      const revision = (await read()).revision;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y }],
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x - 20, y: touchTo.y + touchTo.height / 2 }],
      });
      await expect(ghost).toBeVisible();
      const touchStart = Number(await ghost.getAttribute('data-start-us'));
      await page.screenshot({
        path: testInfo.outputPath('clip-move-mobile.png'),
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
      await expect
        .poll(
          async () =>
            (await read()).tracks[1]!.clips.find((c) => c.id === 'moving')
              ?.startUs,
        )
        .toBe(touchStart);
      expect((await read()).revision).toBe(revision + 1);
      // Cancel a second gesture without committing or leaving a placeholder.
      const movedBox = (await clip.boundingBox())!;
      const tx = movedBox.x + movedBox.width / 2;
      const ty = movedBox.y + movedBox.height / 2;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: tx, y: ty }],
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: tx + 15, y: ty }],
      });
      await expect(ghost).toBeVisible();
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchCancel',
        touchPoints: [],
      });
      await expect(ghost).toHaveCount(0);
      expect((await read()).revision).toBe(revision + 1);
    } finally {
      await cdp.detach();
    }
    const playback = page.locator('.playback-controls > div');
    await expect(playback.getByRole('button')).toHaveCount(5);
    const positions = await playback
      .getByRole('button')
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getBoundingClientRect().y),
      );
    expect(new Set(positions).size).toBe(1);
    await test.step('grouped audio and visual members keep offsets and reject locked sources', async () => {
      await page.setViewportSize({ width: 1440, height: 1600 });
      await page.evaluate(
        async ({ base, id }) => {
          const { createEditor } = (await import(
            base + 'editor.js'
          )) as typeof import('../../src/editor');
          const editor = await createEditor();
          try {
            const audio = await editor.assets.import(
              new File(
                [await (await fetch('/fixtures/jfk.wav')).blob()],
                'linked.wav',
                { type: 'audio/wav' },
              ),
            ).completion;
            const p = await editor.projects.snapshot(id);
            await editor.commands.apply({
              projectId: id,
              expectedRevision: p.revision,
              requestId: crypto.randomUUID(),
              operations: [
                { type: 'addTrack', track: { id: 'a2', kind: 'audio' } },
                {
                  type: 'insertClip',
                  trackId: 'a',
                  clip: {
                    id: 'sound',
                    kind: 'audio',
                    assetId: audio.id,
                    startUs: 2_000_000,
                    durationUs: 1_000_000,
                    sourceOutUs: 1_000_000,
                  },
                },
                {
                  type: 'groupClips',
                  clipIds: ['moving', 'sound'],
                  groupId: 'linked',
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
      const linked = await read();
      const sound = page.locator('[data-clip-id="sound"]');
      const moveSound = async (target: string) => {
        await lane(target).scrollIntoViewIfNeeded();
        await sound.scrollIntoViewIfNeeded();
        const source = (await sound.boundingBox())!;
        const destination = (await lane(target).boundingBox())!;
        await page.mouse.move(
          source.x + source.width / 2,
          source.y + source.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
          destination.x + destination.width * 0.4,
          destination.y + destination.height / 2,
          { steps: 8 },
        );
      };
      await moveSound('v1');
      await expect(ghost).toHaveCount(0);
      await page.mouse.up();
      expect((await read()).revision).toBe(linked.revision);
      await moveSound('a2');
      await expect(ghost).toHaveCount(2);
      const soundStart = Number(
        await lane('a2')
          .locator('.timeline-clip-move-placeholder')
          .getAttribute('data-start-us'),
      );
      await page.mouse.up();
      await expect
        .poll(
          async () =>
            (await read()).tracks.find((t) => t.id === 'a2')!.clips.length,
        )
        .toBe(1);
      const grouped = await read();
      const oldVisual = linked.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === 'moving')!;
      const newVisual = grouped.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === 'moving')!;
      expect(newVisual).toEqual({
        ...oldVisual,
        startUs: oldVisual.startUs + soundStart - 2_000_000,
      });
      expect(grouped.revision).toBe(linked.revision + 1);
      await page.evaluate(
        async ({ base, id }) => {
          const { createEditor } = (await import(
            base + 'editor.js'
          )) as typeof import('../../src/editor');
          const editor = await createEditor();
          try {
            const p = await editor.projects.snapshot(id);
            await editor.commands.apply({
              projectId: id,
              expectedRevision: p.revision,
              requestId: crypto.randomUUID(),
              operations: [
                { type: 'updateTrack', trackId: 'a2', patch: { locked: true } },
              ],
            });
          } finally {
            await editor.dispose();
          }
        },
        { base, id },
      );
      await page.reload();
      const locked = await read();
      await begin('v1', 0.4);
      await expect(ghost).toHaveCount(0);
      await page.mouse.up();
      expect((await read()).revision).toBe(locked.revision);
    });
  });
}

for (const base of ['/', '/LocalCut/']) {
  test(`timeline narrow clips keep a touch drag target beside resize handles ${base}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base);
    const id = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const canvas = new OffscreenCanvas(128, 72);
        canvas.getContext('2d')!.fillRect(0, 0, 128, 72);
        const asset = await editor.assets.import(
          new File([await canvas.convertToBlob()], 'narrow.png', {
            type: 'image/png',
          }),
        ).completion;
        const p = await editor.projects.create('Narrow touch drag', {
          width: 128,
          height: 72,
        });
        await editor.commands.apply({
          projectId: p.id,
          expectedRevision: 0,
          requestId: crypto.randomUUID(),
          operations: [
            { type: 'addTrack', track: { id: 'source', kind: 'video' } },
            { type: 'addTrack', track: { id: 'destination', kind: 'video' } },
            {
              type: 'insertClip',
              trackId: 'source',
              clip: {
                id: 'narrow',
                kind: 'image',
                assetId: asset.id,
                startUs: 2_000_000,
                durationUs: 200_000,
              },
            },
            {
              type: 'insertClip',
              trackId: 'source',
              clip: {
                id: 'tail',
                kind: 'image',
                assetId: asset.id,
                startUs: 4_000_000,
                durationUs: 1_000_000,
              },
            },
          ],
        });
        return p.id;
      } finally {
        await editor.dispose();
      }
    }, base);
    await page.goto(`${base}#/project/${id}`);
    const clip = page.locator('[data-clip-id="narrow"]');
    await clip.scrollIntoViewIfNeeded();
    const from = (await clip.boundingBox())!;
    expect(from.width).toBeLessThan(30);
    const centerHitsClip = await clip.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return (
        document
          .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
          ?.closest('button') === el
      );
    });
    expect(centerHitsClip).toBe(true);
    const to = (await page
      .locator('[data-track-id="destination"] .track-lane')
      .boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
          { x: from.x + from.width / 2, y: from.y + from.height / 2 },
        ],
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: from.x + from.width / 2 - 20, y: to.y + to.height / 2 },
        ],
      });
      await expect(
        page.locator('.timeline-clip-move-placeholder'),
      ).toBeVisible();
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
      await expect
        .poll(
          async () => (await snapshot(page, base, id)).tracks[1]!.clips.length,
        )
        .toBe(1);
      const moved = await snapshot(page, base, id);
      expect(moved.revision).toBe(2);
      expect(moved.tracks[1]!.clips[0]!.durationUs).toBe(200_000);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect
        .poll(
          async () =>
            (await snapshot(page, base, id)).tracks[0]!.clips.find(
              (c) => c.id === 'narrow',
            )?.startUs,
        )
        .toBe(2_000_000);
      const handle = page
        .getByRole('button', { name: 'Resize end of narrow.png', exact: true })
        .first();
      await handle.focus();
      await page.keyboard.press('ArrowRight');
      await expect
        .poll(
          async () =>
            (await snapshot(page, base, id)).tracks[0]!.clips.find(
              (c) => c.id === 'narrow',
            )?.durationUs,
        )
        .toBe(233_333);
    } finally {
      await cdp.detach();
    }
  });
}
