import { behaviorBases } from './coverage-bases';
import { expect, test } from '@playwright/test';

for (const base of behaviorBases) {
  test(`unified media header keeps folder controls reachable on desktop and mobile ${base}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base);
    await page
      .getByRole('button', { name: 'New project', exact: true })
      .click();
    await page.getByLabel('Project name', { exact: true }).fill('Media header');
    await page.getByRole('button', { name: 'Create project' }).click();
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    const media = page.getByRole('region', { name: 'Project media' });
    const heading = media.locator('.section-heading');
    const path = media.getByRole('navigation', {
      name: 'Media folder path',
      exact: true,
    });
    await expect(path).toHaveCount(0);
    const names = [
      'New folder',
      'Upload folder',
      'Open media Trash',
      'Record screen',
    ];
    for (const name of names) {
      await expect(
        heading.getByRole('button', { name, exact: true }),
      ).toBeVisible();
    }
    await expect(
      heading.getByRole('button', { name: 'New folder', exact: true }),
    ).toBeEnabled();
    const title = (await heading
      .getByRole('heading', { name: 'Media', exact: true })
      .boundingBox())!;
    for (const name of names) {
      const box = (await heading
        .getByRole('button', { name, exact: true })
        .boundingBox())!;
      expect(
        Math.abs(box.y + box.height / 2 - title.y - title.height / 2),
      ).toBeLessThan(2);
    }
    const header = (await heading.boundingBox())!;
    const grid = (await media.locator('.media-grid').boundingBox())!;
    expect(grid.y - header.y - header.height).toBeGreaterThanOrEqual(0);
    expect(grid.y - header.y - header.height).toBeLessThanOrEqual(13);
    await page.screenshot({
      path: info.outputPath('unified-media-header-desktop.png'),
    });
    await heading
      .getByRole('button', { name: 'New folder', exact: true })
      .click();
    const creation = page.getByRole('dialog', {
      name: 'New folder',
      exact: true,
    });
    const folderName = 'A long folder name for captured footage';
    await creation.getByLabel('Name', { exact: true }).fill(folderName);
    await creation
      .getByRole('button', { name: 'New folder', exact: true })
      .click();
    await expect(creation).toBeHidden();
    await media
      .getByRole('button', { name: `Open folder ${folderName}`, exact: true })
      .click();
    const breadcrumb = path.getByRole('button', {
      name: folderName,
      exact: true,
    });
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb).toHaveAttribute('aria-current', 'page');
    await expect(
      heading.getByRole('button', { name: folderName, exact: true }),
    ).toHaveCount(0);
    const pathBounds = (await path.boundingBox())!;
    const toolbarBounds = (await heading.boundingBox())!;
    expect(pathBounds.y).toBeGreaterThanOrEqual(
      toolbarBounds.y + toolbarBounds.height,
    );
    await breadcrumb.click();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page
        .getByRole('navigation', { name: 'Workspace sections' })
        .getByRole('button', { name: 'Expand media', exact: true })
        .click();
      await expect(breadcrumb).toBeVisible();
      await expect(
        heading.getByRole('button', {
          name: 'Workspace settings',
          exact: true,
        }),
      ).toBeVisible();
      for (const name of [...names, 'Workspace settings']) {
        const button = heading.getByRole('button', { name, exact: true });
        await button.focus();
        await expect(button).toBeInViewport();
        const bounds = (await button.boundingBox())!;
        const title = (await heading
          .getByRole('heading', { name: 'Media', exact: true })
          .boundingBox())!;
        expect(
          Math.abs(bounds.y + bounds.height / 2 - title.y - title.height / 2),
        ).toBeLessThan(2);
      }
      await expect(
        heading.getByRole('button', { name: 'Scroll Media actions left' }),
      ).toBeVisible();
      await expect(
        heading.getByRole('button', { name: 'Scroll Media actions right' }),
      ).toHaveCount(0);
      expect(
        await media.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`unified-media-header-mobile-${width}.png`),
      });
    }
    await heading
      .getByRole('button', { name: 'Open media Trash', exact: true })
      .click();
    await expect(path.getByText('Trash', { exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(
      heading.getByRole('button', { name: 'New folder', exact: true }),
    ).toHaveCount(0);
    await path.getByRole('button', { name: 'Media root', exact: true }).click();
    await expect(breadcrumb).toHaveCount(0);
    await expect(path).toHaveCount(0);
    await expect(
      heading.getByRole('button', { name: 'New folder', exact: true }),
    ).toBeEnabled();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page
      .getByRole('button', { name: 'Collapse media', exact: true })
      .click();
    await expect(media).toBeHidden();
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    await expect(path).toHaveCount(0);
  });
}
