import { expect, test } from '@playwright/test';
for (const base of ['/', '/LocalCut/']) {
  test(`text effects share real worker preview and native MP4/WebM export ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const result = await page.evaluate(async (base) => {
      const { createEditor } = await import(base + 'editor.js');
      const editor = await createEditor({
        namespace: 'test-' + crypto.randomUUID(),
      });
      const styles = [
        { text: 'Hello world', fontSize: 52, fontFamily: 'sans' },
        {
          text: 'Hello world',
          fontSize: 52,
          fontFamily: 'sans',
          fontWeight: 'bold',
        },
        { text: 'Hello world', fontSize: 52, fontFamily: 'sans', curve: 100 },
        {
          text: 'Hello world',
          fontSize: 52,
          fontFamily: 'sans',
          shadow: { color: '#0000ff', blur: 0, offsetX: 10, offsetY: 10 },
        },
        {
          text: 'Hello world',
          fontSize: 52,
          fontFamily: 'sans',
          outlineColor: '#ff0000',
          outlineWidth: 4,
        },
        {
          text: 'Hello world',
          fontSize: 52,
          fontFamily: 'mono',
          letterSpacing: 10,
          italic: true,
        },
        {
          text: 'Hello world',
          fontSize: 52,
          fontFamily: 'sans',
          background: '#ffff00',
          color: '#000000',
        },
        { text: 'Xin chào Việt Nam', fontSize: 52, fontFamily: 'font-inter' },
        {
          text: 'Hello world',
          fontSize: 88,
          fontFamily: 'font-special-elite',
          animation: { kind: 'typewriter', stepMs: 40, loop: false },
        },
        ...[3, 4, 5].map((frames) => ({
          text: 'Happy little things',
          fontSize: 52,
          fontFamily: 'font-patrick-hand',
          animation: { kind: 'handmade', stepMs: 50, loop: true, frames },
        })),
        {
          text: 'one',
          fontSize: 52,
          fontFamily: 'font-patrick-hand',
          animation: {
            kind: 'handmade',
            stepMs: 50,
            loop: true,
            variations: ['one', 'two', 'three'],
          },
        },
      ];
      const canvas = new OffscreenCanvas(640, 360),
        ctx = canvas.getContext('2d')!;
      const pixels = async (id: string, timeUs: number) => {
        const frame = await editor.preview.frame(id, timeUs).completion;
        try {
          ctx.drawImage(frame.image, 0, 0);
          return ctx.getImageData(0, 0, 640, 360).data;
        } finally {
          frame.image.close();
        }
      };
      try {
        const project = await editor.projects.create('Text pixels', {
          width: 640,
          height: 360,
        });
        await editor.commands.apply({
          projectId: project.id,
          expectedRevision: 0,
          requestId: 'styles',
          operations: [
            { type: 'addTrack', track: { id: 'overlay', kind: 'overlay' } },
            ...styles.map((text, index) => ({
              type: 'insertClip',
              trackId: 'overlay',
              clip: {
                id: 'text-' + index,
                kind: 'text',
                startUs: index * 200000,
                durationUs: 200000,
                x: 40,
                y: 70,
                width: 560,
                height: 260,
                text,
              },
            })),
          ],
        });
        const frames = await Promise.all(
          styles.map((_, index) => pixels(project.id, index * 200000 + 100000)),
        );
        const stats = frames.map((frame) => {
          let lit = 0,
            blue = 0,
            red = 0,
            yellow = 0,
            hash = 0;
          for (let i = 0; i < frame.length; i += 4) {
            const r = frame[i]!,
              g = frame[i + 1]!,
              b = frame[i + 2]!;
            if (r + g + b > 60) lit++;
            if (b > 150 && r < 50 && g < 50) blue++;
            if (r > 150 && g < 50 && b < 50) red++;
            if (r > 200 && g > 200 && b < 50) yellow++;
            hash = Math.imul(hash ^ (r + g * 256 + b * 65536), 16777619);
          }
          return { lit, blue, red, yellow, hash };
        });
        const differences: number[][] = [];
        for (const format of ['mp4', 'webm']) {
          const artifact = await editor.exports.start(project.id, { format })
            .completion;
          try {
            const asset = await editor.assets.import(
              new File([artifact.file], 'text.' + format, {
                type: format === 'mp4' ? 'video/mp4' : 'video/webm',
              }),
            ).completion;
            const decoded = await editor.projects.create('Decode', {
              width: 640,
              height: 360,
            });
            await editor.commands.apply({
              projectId: decoded.id,
              expectedRevision: 0,
              requestId: 'decode',
              operations: [
                { type: 'addTrack', track: { id: 'video', kind: 'video' } },
                {
                  type: 'insertClip',
                  trackId: 'video',
                  clip: {
                    id: 'decoded',
                    kind: 'video',
                    assetId: asset.id,
                    startUs: 0,
                    durationUs: asset.durationUs,
                    sourceOutUs: asset.durationUs,
                    width: 640,
                    height: 360,
                  },
                },
              ],
            });
            const errors: number[] = [];
            for (let index = 0; index < styles.length; index++) {
              const actual = await pixels(decoded.id, index * 200000 + 100000);
              const expected = frames[index]!;
              let error = 0;
              for (let i = 0; i < actual.length; i++)
                if (i % 4 !== 3) error += Math.abs(actual[i]! - expected[i]!);
              errors.push(error / (640 * 360 * 3));
            }
            differences.push(errors);
          } finally {
            await artifact.dispose();
          }
        }
        const saved = await editor.projects.importJSON(
          await editor.projects.exportJSON(project.id),
        );
        return {
          stats,
          differences,
          restored: saved.tracks[0].clips.map(
            (clip: { text: unknown }) => clip.text,
          ),
        };
      } finally {
        await editor.dispose();
      }
    }, base);
    expect(result.stats.every((frame) => frame.lit > 1000)).toBe(true);
    // Same-time poses for 3/4/5 variants can match; every effect and new font differs.
    expect(
      new Set(result.stats.map((frame) => frame.hash)).size,
    ).toBeGreaterThanOrEqual(10);
    expect(result.stats[3]!.blue).toBeGreaterThan(500);
    expect(result.stats[4]!.red).toBeGreaterThan(500);
    expect(result.stats[6]!.yellow).toBeGreaterThan(10000);
    expect(result.differences).toHaveLength(2);
    for (const errors of result.differences)
      for (const error of errors) expect(error).toBeLessThan(8);
    expect(result.restored[2]).toMatchObject({ curve: 100 });
    expect(result.restored[3]).toMatchObject({ shadow: { offsetX: 10 } });
    expect(result.restored[7]).toMatchObject({ fontFamily: 'font-inter' });
    expect(result.restored[8]).toMatchObject({
      animation: { kind: 'typewriter', stepMs: 40 },
    });
    expect(result.restored[12]).toMatchObject({
      animation: { variations: ['one', 'two', 'three'] },
    });
  });
}
