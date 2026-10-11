import { expect, test } from '@playwright/test';

for (const base of ['/', '/LocalCut/']) {
  test(`bundled fonts fail explicitly, retry and animate identically on seeking ${base}`, async ({
    page,
    context,
  }) => {
    const external: string[] = [];
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
        external.push(url.href);
        await route.abort();
      } else await route.continue();
    });
    await page.goto(base);
    await context.route('**/fonts/inter/latin.woff2', (route) =>
      route.fulfill({ body: 'bad font', contentType: 'font/woff2' }),
    );
    const failure = await page.evaluate(async (base) => {
      const { createEditor } = await import(base + 'editor.js');
      const editor = await createEditor({
        namespace: 'test-' + crypto.randomUUID(),
      });
      try {
        const p = await editor.projects.create('Font integrity', {
          width: 640,
          height: 360,
        });
        await editor.commands.apply({
          projectId: p.id,
          expectedRevision: 0,
          requestId: 'insert',
          operations: [
            { type: 'addTrack', track: { id: 'text', kind: 'overlay' } },
            {
              type: 'insertClip',
              trackId: 'text',
              clip: {
                id: 'font-clip',
                kind: 'text',
                startUs: 0,
                durationUs: 1000000,
                width: 640,
                height: 360,
                text: { text: 'Font integrity', fontFamily: 'font-inter' },
              },
            },
          ],
        });
        try {
          await editor.preview.frame(p.id, 0).completion;
          return 'unexpected fallback';
        } catch (error) {
          return (error as { code: string }).code;
        }
      } finally {
        await editor.dispose();
      }
    }, base);
    expect(failure).toBe('MISSING_ASSET');
    await context.unroute('**/fonts/inter/latin.woff2');
    const result = await page.evaluate(async (base) => {
      const { createEditor } = await import(base + 'editor.js');
      const editor = await createEditor({
        namespace: 'test-' + crypto.randomUUID(),
      });
      const canvas = new OffscreenCanvas(640, 360),
        ctx = canvas.getContext('2d')!;
      try {
        const p = await editor.projects.create('Animated text', {
          width: 640,
          height: 360,
        });
        await editor.commands.apply({
          projectId: p.id,
          expectedRevision: 0,
          requestId: 'insert',
          operations: [
            { type: 'addTrack', track: { id: 'text', kind: 'overlay' } },
            {
              type: 'insertClip',
              trackId: 'text',
              clip: {
                id: 'handmade',
                kind: 'text',
                startUs: 200000,
                durationUs: 1000000,
                width: 640,
                height: 360,
                text: {
                  text: 'Handmade',
                  fontFamily: 'font-inter',
                  animation: {
                    kind: 'handmade',
                    stepMs: 100,
                    loop: true,
                    variations: ['one', 'two', 'three', 'four', 'five'],
                  },
                },
              },
            },
          ],
        });
        const hash = async (time: number) => {
          const frame = await editor.preview.frame(p.id, time).completion;
          try {
            ctx.drawImage(frame.image, 0, 0);
            const bytes = ctx.getImageData(0, 0, 640, 360).data;
            return [
              ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
            ].join(',');
          } finally {
            frame.image.close();
          }
        };
        const hashes = [];
        for (const time of [
          200000, 300000, 400000, 500000, 600000, 700000, 300000,
        ])
          hashes.push(await hash(time));
        return hashes;
      } finally {
        await editor.dispose();
      }
    }, base);
    expect(new Set(result.slice(0, 5)).size).toBe(5);
    expect(result[5]).toBe(result[0]);
    expect(result[6]).toBe(result[1]);
    expect(external).toEqual([]);
  });
}
