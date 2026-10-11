import type { Page } from '@playwright/test';

/** Drag the marker to a fraction of the project, including outside its hit area. */
export async function dragPlayhead(page: Page, fraction: number) {
  const handle = page.getByRole('slider', {
    name: 'Playhead position',
    exact: true,
  });
  await handle.scrollIntoViewIfNeeded();
  const hit = (await handle.boundingBox())!;
  const ruler = (await page.locator('.timeline-ruler').boundingBox())!;
  const duration = Number(await handle.getAttribute('aria-valuemax')) + 1;
  const current = Number(await handle.getAttribute('aria-valuenow'));
  const x = hit.x + hit.width / 2;
  const y = hit.y + hit.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(
    x + ruler.width * (fraction - current / duration),
    y + hit.height,
    { steps: 5 },
  );
  await page.mouse.up();
}
