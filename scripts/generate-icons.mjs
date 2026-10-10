// Regenerate PNG install icons from the tracked vector favicon using stable Chrome.
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const svg = await readFile(
  new URL('../public/icons/favicon.svg', import.meta.url),
  'utf8',
);
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const [name, size, maskable] of [
    ['favicon-32', 32, false],
    ['apple-touch-icon', 180, false],
    ['icon-192', 192, false],
    ['icon-512', 512, false],
    ['maskable-512', 512, true],
  ]) {
    // A fresh, final-sized surface avoids stale compositor pixels after resizing.
    const page = await browser.newPage({
      viewport: { width: size, height: size },
    });
    const image = maskable
      ? svg
          .replace('rx="14"', 'rx="0"')
          .replace(
            '<g fill=',
            '<g transform="translate(10 10) scale(0.6875)" fill=',
          )
      : svg;
    await page.setContent(
      `<style>html,body{margin:0;width:100%;height:100%}svg{display:block;width:100%;height:100%}</style>${image}`,
    );
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          globalThis.requestAnimationFrame(() =>
            globalThis.requestAnimationFrame(resolve),
          ),
        ),
    );
    await writeFile(
      new URL(`../public/icons/${name}.png`, import.meta.url),
      await page.screenshot({ omitBackground: true }),
    );
    await page.close();
  }
} finally {
  await browser.close();
}
