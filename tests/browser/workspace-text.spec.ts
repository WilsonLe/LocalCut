import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Project } from '../../src/core/model';

async function snapshot(
  page: Page,
  base: string,
  name = 'Text library',
): Promise<Project> {
  return page.evaluate(
    async ({ base, name }) => {
      const { createEditor } = await import(base + 'editor.js');
      const editor = await createEditor();
      try {
        return await editor.projects.snapshot(
          (await editor.projects.list()).find((p: Project) => p.name === name)!
            .id,
        );
      } finally {
        await editor.dispose();
      }
    },
    { base, name },
  );
}
for (const base of ['/', '/LocalCut/']) {
  test(`bundled font pages and editable animated templates ${base}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(base);
    const id = await page.evaluate(async (base) => {
      const { createEditor } = await import(base + 'editor.js');
      const editor = await createEditor();
      try {
        return (await editor.projects.create('Animated library')).id;
      } finally {
        await editor.dispose();
      }
    }, base);
    await page.goto(`${base}#/project/${id}`);
    await page.getByRole('button', { name: 'Add text', exact: true }).click();
    const library = page.getByRole('dialog', { name: 'Add text', exact: true });
    await library.getByRole('button', { name: 'Fonts', exact: true }).click();
    await expect(library.getByRole('button', { name: /^Insert / })).toHaveCount(
      24,
    );
    await expect(library.getByRole('status')).toContainText('1,797 fonts');
    await library.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(library.getByRole('status')).toContainText('Page 2');
    await library
      .getByRole('button', { name: 'Filter vietnamese', exact: true })
      .click();
    await library.getByLabel('Search text library').fill('Inter modern');
    await expect(
      library.getByRole('button', { name: 'Insert Inter', exact: true }),
    ).toBeVisible();
    if (base === '/')
      await page.screenshot({ path: 'docs/images/text-fonts.png' });
    await library
      .getByRole('button', { name: 'Insert Inter', exact: true })
      .click();
    const properties = page.getByRole('dialog', {
      name: 'Clip properties',
      exact: true,
    });
    await expect(
      properties.getByRole('combobox', { name: 'Font', exact: true }),
    ).toContainText('Inter');
    await properties
      .getByRole('button', { name: 'Apply properties', exact: true })
      .click();
    await page.getByRole('button', { name: 'Add text', exact: true }).click();
    await library
      .getByRole('button', { name: 'Filter animated', exact: true })
      .click();
    await expect(library.getByRole('button', { name: /^Insert / })).toHaveCount(
      5,
    );
    await library
      .getByRole('button', { name: 'Insert Handmade 5 frames', exact: true })
      .click();
    await properties
      .getByRole('button', { name: 'Animation settings', exact: true })
      .click();
    const sample = properties.locator('canvas');
    const samplePixels = () =>
      sample.evaluate((node: HTMLCanvasElement) => {
        const pixels = node
          .getContext('2d')!
          .getImageData(0, 0, node.width, node.height).data;
        let lit = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i]! + pixels[i + 1]! + pixels[i + 2]! > 60) lit++;
        return lit;
      });
    await properties.getByLabel('Milliseconds per frame').fill('');
    await expect.poll(samplePixels).toBeGreaterThan(100);
    expect(
      await properties
        .getByLabel('Milliseconds per frame')
        .evaluate((node: HTMLInputElement) => node.checkValidity()),
    ).toBe(false);
    await properties.getByLabel('Milliseconds per frame').fill('100');
    await properties
      .getByLabel('Text variations (optional, one per frame)')
      .fill('one\ntwo\nthree\nfour\nfive\nsix');
    await expect.poll(samplePixels).toBeGreaterThan(100);
    // Let a full-motion six-frame draft reach its formerly crashing sixth step.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const start = performance.now();
          const tick = () => {
            if (performance.now() - start >= 700) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );
    expect(errors).toEqual([]);
    await properties.getByLabel('Milliseconds per frame').fill('240');
    await properties
      .getByLabel('Text variations (optional, one per frame)')
      .fill('one\ntwo');
    expect(
      await properties
        .getByLabel('Text variations (optional, one per frame)')
        .evaluate((node: HTMLTextAreaElement) => node.checkValidity()),
    ).toBe(false);
    await properties
      .getByRole('combobox', { name: 'Animation frames', exact: true })
      .click();
    await page.getByRole('option', { name: '3 frames', exact: true }).click();
    expect(
      await properties
        .getByLabel('Text variations (optional, one per frame)')
        .evaluate((node: HTMLTextAreaElement) => node.checkValidity()),
    ).toBe(true);
    await properties
      .getByLabel('Text variations (optional, one per frame)')
      .fill('hello\nhey\nhi');
    await properties.getByLabel('Text', { exact: true }).fill('');
    await expect.poll(samplePixels).toBeGreaterThan(100);
    await properties
      .getByRole('button', { name: 'Apply properties', exact: true })
      .click();
    await expect(properties).not.toBeVisible();
    const animation = (
      await snapshot(page, base, 'Animated library')
    ).tracks[0]!.clips.find((clip) => clip.text?.animation)!.text!.animation;
    expect(animation).toMatchObject({
      kind: 'handmade',
      stepMs: 240,
      frames: 3,
      loop: true,
      variations: ['hello', 'hey', 'hi'],
    });
    expect(
      (await snapshot(page, base, 'Animated library')).tracks[0]!.clips.find(
        (clip) => clip.text?.animation,
      )!.text!.text,
    ).toBe('');
    await page.reload();
    expect(
      (await snapshot(page, base, 'Animated library')).tracks[0]!.clips.find(
        (clip) => clip.text?.animation,
      )!.text!.animation,
    ).toEqual(animation);
    await page.getByRole('button', { name: 'Add text', exact: true }).click();
    await library
      .getByRole('button', { name: 'Filter typing', exact: true })
      .click();
    await library
      .getByRole('button', { name: 'Insert Typewriter', exact: true })
      .click();
    await properties
      .getByRole('button', { name: 'Animation settings', exact: true })
      .click();
    await properties.getByLabel('Milliseconds per character').fill('80');
    await properties
      .getByRole('button', { name: 'Loop animation', exact: true })
      .click();
    await properties
      .getByRole('button', { name: 'Apply properties', exact: true })
      .click();
    expect(
      (await snapshot(page, base, 'Animated library')).tracks[0]!.clips.find(
        (clip) => clip.text?.animation?.kind === 'typewriter',
      )!.text!.animation,
    ).toEqual({ kind: 'typewriter', stepMs: 80, loop: true });
  });
  test(`searchable fonts and text templates insert, edit, undo and reload ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
    await page
      .getByRole('menuitem', { name: 'New project', exact: true })
      .click();
    await page.getByLabel('Project name').fill('Text library');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await page.getByRole('button', { name: 'Add text', exact: true }).click();
    const library = page.getByRole('dialog', { name: 'Add text', exact: true });
    await expect(library.getByRole('button', { name: /^Insert / })).toHaveCount(
      17,
    );
    if (base === '/')
      await page.screenshot({
        animations: 'disabled',
        path: 'docs/images/text-library.png',
      });
    await library.getByLabel('Search text library').fill('unmatched');
    await expect(
      library.getByText('No matches.', { exact: false }),
    ).toBeVisible();
    await library.getByLabel('Search text library').fill('cute');
    await library.getByRole('button', { name: 'Fonts', exact: true }).click();
    await expect(
      library.getByRole('button', { name: 'Insert Soft rounded', exact: true }),
    ).toBeVisible();
    await library.getByLabel('Search text library').fill('Patrick cute');
    await expect(
      library.getByRole('button', { name: 'Insert Patrick Hand', exact: true }),
    ).toBeVisible();
    await expect(
      library.getByText('Local system fonts;', { exact: false }),
    ).toHaveCount(0);
    await library
      .getByRole('button', { name: 'Templates', exact: true })
      .click();
    await library.getByLabel('Search text library').fill('curved');
    await library
      .getByRole('button', { name: 'Insert Around the sun', exact: true })
      .click();
    const properties = page.getByRole('dialog', {
      name: 'Clip properties',
      exact: true,
    });
    await expect(properties).toBeVisible();
    const clip = (await snapshot(page, base)).tracks[0]!.clips[0]!;
    expect(clip.text).toMatchObject({
      curve: 100,
      fontFamily: 'rounded',
      fontWeight: 'bold',
    });
    await properties
      .getByLabel('Text', { exact: true })
      .fill('Summer memories');
    await properties
      .getByRole('combobox', { name: 'Font', exact: true })
      .click();
    await page
      .getByRole('combobox', { name: 'Search fonts', exact: true })
      .fill('minimal mono');
    await page.getByRole('option', { name: /Minimal mono/ }).click();
    await properties
      .getByRole('button', { name: 'Shadow', exact: true })
      .click();
    await properties.getByLabel('Highlight color').fill('#fde047');
    await properties.getByLabel('Text color').fill('#18181b');
    await properties.getByLabel('Outline width').fill('2');
    await properties
      .getByRole('button', { name: 'Apply properties', exact: true })
      .click();
    await expect(properties).not.toBeVisible();
    expect(
      (await snapshot(page, base)).tracks[0]!.clips[0]!.text,
    ).toMatchObject({
      text: 'Summer memories',
      fontFamily: 'mono',
      curve: 100,
      background: '#fde047',
      outlineWidth: 2,
      shadow: { blur: 8 },
    });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await snapshot(page, base)).tracks[0]!.clips[0]!.text!.text,
      )
      .toBe('AROUND THE SUN');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await snapshot(page, base)).tracks[0]!.clips[0]!.text!.text,
      )
      .toBe('Summer memories');
    await page.reload();
    await page
      .getByRole('button', { name: 'Open project', exact: true })
      .click();
    await page.getByRole('button', { name: /^Text library/ }).click();
    await page
      .getByRole('button', { name: 'Summer memories', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Clip properties', exact: true })
      .click();
    await expect(page.getByLabel('Curve (degrees)')).toHaveValue('100');
    await expect(
      page.getByRole('combobox', { name: 'Font', exact: true }),
    ).toContainText('Minimal mono');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Add text', exact: true }).click();
    await expect(library).toBeVisible();
    await expect(
      library.getByRole('button', { name: 'Insert Plain text', exact: true }),
    ).toBeVisible();
    await expect(
      library.getByText('Typewriter', { exact: true }),
    ).toBeVisible();
    await expect(
      library.getByText('animated · typing · typewriter · minimal', {
        exact: true,
      }),
    ).toBeVisible();
    if (base === '/')
      await page.screenshot({
        animations: 'disabled',
        path: 'docs/images/text-library-narrow.png',
      });
    await library.getByLabel('Search text library').fill('highlighted');
    await library
      .getByRole('button', { name: 'Insert Highlight', exact: true })
      .click();
    await expect(properties).toBeVisible();
    await properties
      .getByRole('button', { name: 'Apply properties' })
      .scrollIntoViewIfNeeded();
    await expect(
      properties.getByRole('button', { name: 'Apply properties' }),
    ).toBeInViewport();
  });
  test(`existing text font sizes remain editable ${base}`, async ({ page }) => {
    await page.goto(base);
    await page.evaluate(async (base) => {
      const { createEditor } = await import(base + 'editor.js');
      const editor = await createEditor();
      try {
        const project = await editor.projects.create('Existing font sizes');
        await editor.commands.apply({
          projectId: project.id,
          expectedRevision: 0,
          requestId: 'legacy-sizes',
          operations: [
            { type: 'addTrack', track: { id: 'overlay', kind: 'overlay' } },
            ...[1001, 0.5].map((fontSize, index) => ({
              type: 'insertClip',
              trackId: 'overlay',
              clip: {
                id: 'text-' + index,
                kind: 'text',
                startUs: index * 1000000,
                durationUs: 1000000,
                text: { text: 'Existing ' + fontSize, fontSize },
              },
            })),
          ],
        });
      } finally {
        await editor.dispose();
      }
    }, base);
    await page
      .getByRole('button', { name: 'Open project', exact: true })
      .click();
    await page.getByRole('button', { name: /^Existing font sizes/ }).click();
    for (const fontSize of [1001, 0.5]) {
      await page
        .getByRole('button', { name: 'Existing ' + fontSize, exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Clip properties', exact: true })
        .click();
      const form = page.getByRole('dialog', {
        name: 'Clip properties',
        exact: true,
      });
      const input = form.getByLabel('Font size', { exact: true });
      await expect(input).toHaveValue(String(fontSize));
      await form.getByLabel('Text', { exact: true }).fill('Edited ' + fontSize);
      await form
        .getByRole('button', { name: 'Apply properties', exact: true })
        .click();
      await expect(form).not.toBeVisible();
      const saved = await snapshot(page, base, 'Existing font sizes');
      expect(
        saved.tracks[0]!.clips.find((clip) => clip.text?.fontSize === fontSize)!
          .text,
      ).toMatchObject({ text: 'Edited ' + fontSize, fontSize });
    }
    await page.getByRole('button', { name: 'Edited 0.5', exact: true }).click();
    await page
      .getByRole('button', { name: 'Clip properties', exact: true })
      .click();
    const input = page.getByLabel('Font size', { exact: true });
    await input.fill('0');
    expect(
      await input.evaluate((node: HTMLInputElement) => node.checkValidity()),
    ).toBe(false);
    await page
      .getByRole('button', { name: 'Apply properties', exact: true })
      .click();
    await expect(
      page.getByRole('dialog', { name: 'Clip properties', exact: true }),
    ).toBeVisible();
    expect(
      (await snapshot(page, base, 'Existing font sizes')).tracks[0]!.clips[1]!
        .text!.fontSize,
    ).toBe(0.5);
  });
}
