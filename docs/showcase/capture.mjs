/* global File, crypto */
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const assets = new URL('./assets/', import.meta.url);
const base = new URL(process.argv[2] || 'http://127.0.0.1:4196/LocalCut/');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
  page.on('pageerror', (e) => console.error(e.message));
  await page.goto(base.href);
  const images = await Promise.all(
    [1, 2, 3].map(async (n) =>
      Array.from(await readFile(new URL(`landscape-${n}.jpg`, assets))),
    ),
  );
  const id = await page.evaluate(
    async ({ images, basePath }) => {
      const { createEditor } = await import(basePath + 'src/editor/index.ts');
      const editor = await createEditor();
      const p = await editor.projects.create('Desert daydream', {
        width: 1920,
        height: 1080,
        frameRate: { num: 30, den: 1 },
      });
      const assets = [];
      for (let i = 0; i < 3; i++)
        assets.push(
          await editor.assets.import(
            new File(
              [new Uint8Array(images[i])],
              ['Golden hour.jpg', 'Quiet coast.jpg', 'Last light.jpg'][i],
              { type: 'image/jpeg' },
            ),
          ).completion,
        );
      await editor.commands.apply({
        projectId: p.id,
        requestId: crypto.randomUUID(),
        expectedRevision: p.revision,
        operations: [
          { type: 'addTrack', track: { id: 'visuals', kind: 'video' } },
          ...assets.map((a, i) => ({
            type: 'insertClip',
            trackId: 'visuals',
            clip: {
              id: `shot-${i}`,
              kind: 'image',
              assetId: a.id,
              startUs: i * 5000000,
              durationUs: 5000000,
              width: 1600,
              height: 1000,
            },
          })),
        ],
      });
      await editor.dispose();
      return p.id;
    },
    { images, basePath: base.pathname },
  );
  await page.goto(`${base.href}#/project/${id}`);
  await page.locator('[data-clip-id="shot-0"]').waitFor();
  await page.waitForTimeout(1200);
  console.log((await page.locator('body').innerText()).slice(0, 1700));
  await page.screenshot({ path: new URL('editor.png', assets).pathname });
} finally {
  await browser.close();
}
