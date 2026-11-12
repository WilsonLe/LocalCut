import { test, expect, type Page } from '@playwright/test';
import { behaviorBases } from './coverage-bases';
import { closeMediaImport } from './workspace-import-helper';
import { openVersions } from './workspace-settings-helper';

async function openSounds(page: Page) {
  const expand = page.getByRole('button', {
    name: 'Expand media',
    exact: true,
  });
  if (await expand.isVisible()) await expand.click();
  await page
    .getByRole('button', { name: 'Sound effects', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Sound effects',
    exact: true,
  });
  await expect(dialog.getByLabel('Search sound effects')).toBeVisible();
  await expect(
    dialog.getByRole('combobox', { name: 'Sound category' }),
  ).toContainText('All categories');
  return dialog;
}

for (const base of behaviorBases) {
  test(`sound library browsing, native preview, import, timeline and reload ${base}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.goto(base);
    await expect(
      page.getByRole('main', { name: 'Video editor', exact: true }),
    ).toBeVisible();
    expect(requests.filter((url) => url.includes('/sounds/'))).toEqual([]);
    const before = await page.evaluate(async () =>
      (await indexedDB.databases()).map((db) => db.name),
    );
    const dialog = await openSounds(page);
    await expect(dialog.getByRole('listitem')).toHaveCount(12);
    expect(requests.filter((url) => url.includes('/sounds/audio/'))).toEqual(
      [],
    );
    const search = dialog.getByLabel('Search sound effects');
    await search.fill('whoosh');
    await expect(dialog.getByRole('listitem')).toHaveCount(3);
    await dialog.getByRole('combobox', { name: 'Sound category' }).click();
    await page.getByRole('option', { name: 'Footsteps', exact: true }).click();
    await expect(
      dialog.getByText('No sounds found.', { exact: false }),
    ).toBeVisible();
    await search.fill('concrete');
    await expect(dialog.getByRole('listitem')).toHaveCount(3);
    await dialog.getByRole('combobox', { name: 'Sound category' }).click();
    await page
      .getByRole('option', { name: 'All categories', exact: true })
      .click();
    await search.fill('deep whoosh');
    await expect(dialog.getByRole('listitem')).toHaveCount(1);
    const audio = dialog.locator('audio');
    await dialog.getByLabel('Preview volume').fill('0.2');
    await dialog
      .getByRole('button', { name: 'Preview Deep whoosh', exact: true })
      .click();
    await expect
      .poll(() =>
        audio.evaluate((node) => (node as HTMLAudioElement).currentTime),
      )
      .toBeGreaterThan(0);
    expect(
      await audio.evaluate((node) => (node as HTMLAudioElement).volume),
    ).toBe(0.2);
    const url = await audio.getAttribute('src');
    expect(url).toMatch(/^blob:/);
    await dialog
      .getByRole('button', { name: 'Stop Deep whoosh', exact: true })
      .click();
    expect(
      await audio.evaluate(
        (node) =>
          (node as HTMLAudioElement).paused && !node.getAttribute('src'),
      ),
    ).toBe(true);
    expect(
      await page.evaluate(async (url) => {
        try {
          await fetch(url!);
          return false;
        } catch {
          return true;
        }
      }, url),
    ).toBe(true);
    expect(
      await page.evaluate(async () =>
        (await indexedDB.databases()).map((db) => db.name),
      ),
    ).toEqual(before);
    const downloads = requests.filter((value) =>
      value.includes('/sounds/audio/'),
    ).length;
    await dialog
      .getByRole('button', { name: 'Add Deep whoosh to Media', exact: true })
      .click();
    await closeMediaImport(page);
    expect(
      requests.filter((value) => value.includes('/sounds/audio/')),
    ).toHaveLength(downloads);
    await expect(page.locator('.timeline-clip')).toHaveCount(0);
    await expect(
      page.getByRole('button', {
        name: 'Asset details for Deep whoosh.wav',
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Add track', exact: true }).click();
    await page
      .getByRole('button', { name: 'Audio track', exact: true })
      .click();
    const lane = page.locator('.track-lane').last();
    const bounds = (await lane.boundingBox())!;
    const card = (await page
      .getByRole('button', {
        name: 'Asset details for Deep whoosh.wav',
        exact: true,
      })
      .boundingBox())!;
    await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      card.x + card.width / 2 + 12,
      card.y + card.height / 2,
      { steps: 3 },
    );
    await page.mouse.move(bounds.x + 40, bounds.y + bounds.height / 2, {
      steps: 12,
    });
    await expect(page.locator('.timeline-media-placeholder')).toBeVisible();
    await page.mouse.up();
    await expect(page.locator('.timeline-clip.audio')).toHaveCount(1);
    const main = page.getByRole('main', { name: 'Video editor', exact: true });
    await main.focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('.timeline-clip.audio')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(page.locator('.timeline-clip.audio')).toHaveCount(1);
    await page.reload();
    await expect(page.locator('.timeline-clip.audio')).toHaveCount(1);

    const output = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      const decoder = new AudioContext({ sampleRate: 48000 });
      let artifact:
        | Awaited<ReturnType<typeof editor.exports.start>['completion']>
        | undefined;
      try {
        const projectId = decodeURIComponent(
          location.hash.match(/^#\/project\/([^?]+)/)![1]!,
        );
        const project = await editor.projects.snapshot(projectId);
        const clip = project.tracks.flatMap((track) => track.clips)[0]!;
        const asset = await editor.assets.inspect(
          'assetId' in clip ? clip.assetId! : '',
        );
        const support = await editor.exports.preflight(projectId, {
          format: 'mp4',
        }).completion;
        if (!support.supported)
          throw new Error('Required native MP4/AAC codec unavailable');
        artifact = await editor.exports.start(projectId, { format: 'mp4' })
          .completion;
        const decoded = await decoder.decodeAudioData(
          await artifact.file.arrayBuffer(),
        );
        let finite = true,
          energy = 0;
        for (let channel = 0; channel < decoded.numberOfChannels; channel++)
          for (const value of decoded.getChannelData(channel)) {
            finite &&= Number.isFinite(value);
            energy += value * value;
          }
        await editor.projects.versions.save(projectId);
        return {
          name: asset.name,
          kind: asset.kind,
          finite,
          rms: Math.sqrt(energy / decoded.length / decoded.numberOfChannels),
          bytes: artifact.file.size,
          duration: decoded.duration,
        };
      } finally {
        await artifact?.dispose();
        await decoder.close();
        await editor.dispose();
      }
    }, base);
    expect(output).toMatchObject({
      name: 'Deep whoosh.wav',
      kind: 'audio',
      finite: true,
    });
    expect(output.rms).toBeGreaterThan(0.0001);
    expect(output.bytes).toBeGreaterThan(1000);
    expect(output.duration).toBeGreaterThan(3);

    await openSounds(page);
    await page.screenshot({
      path: info.outputPath('sound-effects-desktop.png'),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog).toBeVisible();
    const mobile = (await dialog.boundingBox())!;
    expect(mobile.x).toBeGreaterThanOrEqual(0);
    expect(mobile.x + mobile.width).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: info.outputPath('sound-effects-mobile.png'),
    });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Expand media', exact: true }),
    ).toBeFocused();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openVersions(page);
    await page
      .getByRole('group', { name: 'Saved versions' })
      .getByRole('button')
      .last()
      .click();
    await expect(page.getByText(/Version \d+ · Read-only/)).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Sound effects', exact: true }),
    ).toHaveCount(0);
  });

  test(`sound library recovers from failures and cancels a project-switched download ${base}`, async ({
    page,
  }) => {
    let broken = true;
    await page.route('**/sounds/catalog.json', (route) =>
      broken
        ? route.fulfill({ json: { version: 1, license: 'unknown' } })
        : route.continue(),
    );
    await page.goto(base);
    await expect(
      page.getByRole('main', { name: 'Video editor', exact: true }),
    ).toBeVisible();
    const dialog = await openSounds(page);
    await expect(dialog.getByRole('alert')).toContainText('could not load');
    broken = false;
    await dialog
      .getByRole('button', { name: 'Retry library', exact: true })
      .click();
    await expect(dialog.getByRole('listitem')).toHaveCount(12);
    let corrupt = 0;
    await page.route('**/sounds/audio/*.wav', (route) => {
      corrupt++;
      return route.fulfill({
        contentType: 'audio/wav',
        body: Buffer.alloc(48),
      });
    });
    await dialog.getByLabel('Search sound effects').fill('deep whoosh');
    await dialog
      .getByRole('button', { name: 'Preview Deep whoosh', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toContainText(
      'failed its file check',
    );
    expect(corrupt).toBe(2);
    expect(await dialog.locator('audio').getAttribute('src')).toBeNull();
    await page.unroute('**/sounds/audio/*.wav');
    await page.keyboard.press('Escape');
    const ids = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        return [
          (await editor.projects.create('Sound origin')).id,
          (await editor.projects.create('Sound destination')).id,
        ];
      } finally {
        await editor.dispose();
      }
    }, base);
    await page.goto(`${base}#/project/${ids[0]}`);
    const origin = await openSounds(page);
    await origin.getByLabel('Search sound effects').fill('deep whoosh');
    let release!: () => void, arrived!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    await page.route('**/sounds/audio/*.wav', async (route) => {
      arrived();
      await gate;
      await route.continue().catch(() => {});
    });
    try {
      await origin
        .getByRole('button', { name: 'Add Deep whoosh to Media', exact: true })
        .click();
      await reached;
      await page.evaluate((id) => {
        location.hash = '#/project/' + id;
      }, ids[1]);
      await expect(origin).not.toBeVisible();
      await expect(page).toHaveURL(new RegExp(ids[1]!));
    } finally {
      release();
    }
    await page.unrouteAll({ behavior: 'wait' });
    const counts = await page.evaluate(
      async ({ base, ids }) => {
        const { createEditor } = (await import(
          base + 'editor.js'
        )) as typeof import('../../src/editor');
        const editor = await createEditor();
        try {
          return await Promise.all(
            ids.map(
              async (id) =>
                (await editor.library.forProject(id).list()).entries.length,
            ),
          );
        } finally {
          await editor.dispose();
        }
      },
      { base, ids },
    );
    expect(counts).toEqual([0, 0]);
    await expect(
      page.getByRole('dialog', { name: 'Import media', exact: true }),
    ).toHaveCount(0);
  });
}
