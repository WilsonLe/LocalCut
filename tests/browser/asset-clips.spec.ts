import { test, expect } from '@playwright/test';
import { behaviorBases } from './coverage-bases';

for (const base of behaviorBases) {
  test(`asset source clips survive concurrent edits, reload, backup and relink ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const result = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const namespace = 'test-' + crypto.randomUUID();
      let editor = await createEditor({ namespace });
      const peer = await createEditor({ namespace });
      const notes = {
        context: 'Useful opening\nKeep this frame.',
        transcript: 'Xin chào.\n<script>reference text</script>',
      };
      try {
        const canvas = new OffscreenCanvas(32, 32);
        canvas.getContext('2d')!.fillRect(0, 0, 32, 32);
        const file = new File([await canvas.convertToBlob()], 'original.png', {
          type: 'image/png',
        });
        const asset = await editor.assets.import(file).completion;
        const project = await editor.projects.create('Asset notes');
        await editor.library.forProject(project.id).place(asset.id, []);
        const clips = [
          {
            id: 'full-source',
            name: 'Opening',
            startUs: 0,
            endUs: 0,
            ...notes,
          },
        ];
        const races = await Promise.allSettled([
          editor.assets.updateClips(asset.id, clips, 0),
          peer.assets.updateClips(asset.id, clips, 0),
        ]);
        const raceResults = races
          .map((result) =>
            result.status === 'fulfilled'
              ? 'saved'
              : (result.reason as { code: string }).code,
          )
          .sort();
        // Ensure a peer event even when the peer happened to win the race.
        const received = new Promise<string>((resolve) => {
          const stop = peer.events.assets((id) => {
            stop();
            resolve(id);
          });
        });
        const saved = await editor.assets.updateClips(asset.id, clips, 1);
        const eventAssetId = await received;
        const untouchedProjectRevision = (
          await editor.projects.snapshot(project.id)
        ).revision;
        const namespaceRoot = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle(namespace);
        const original = await (
          await namespaceRoot.getFileHandle(asset.id)
        ).getFile();
        const originalUnchanged =
          new Uint8Array(await original.arrayBuffer()).join(',') ===
          new Uint8Array(await file.arrayBuffer()).join(',');
        await editor.dispose();
        editor = await createEditor({ namespace });
        const afterReopen = await editor.assets.inspect(asset.id);
        await editor.commands.apply({
          projectId: project.id,
          expectedRevision: 0,
          requestId: 'place',
          operations: [
            {
              type: 'addTrack',
              track: {
                id: 'v',
                kind: 'video',
                clips: [
                  {
                    id: 'image',
                    kind: 'image',
                    assetId: asset.id,
                    startUs: 0,
                    durationUs: 1_000_000,
                  },
                ],
              },
            },
          ],
        });
        const json = await editor.projects.exportJSON(project.id);
        const restored = await editor.projects.importJSON(json);
        const restoredId = restored.tracks[0]!.clips[0]!.assetId!;
        const beforeRelink = await editor.assets.inspect(restoredId);
        const relinked = await editor.assets.relink(restoredId, file)
          .completion;
        const legacy = JSON.parse(
          json,
        ) as import('../../src/core/model').ProjectBackup;
        delete legacy.assets[0]!.clips;
        delete legacy.assets[0]!.clipsRevision;
        legacy.assets[0]!.notes = { revision: 7, ...notes };
        const legacyProject = await editor.projects.importJSON(
          JSON.stringify(legacy),
        );
        const legacyId = legacyProject.tracks[0]!.clips[0]!.assetId!;
        const legacyRead = await editor.assets.inspect(legacyId);
        const legacySaved = await editor.assets.updateClips(
          legacyId,
          legacyRead.clips!,
          7,
        );
        const cleared = await editor.assets.updateClips(
          asset.id,
          [{ ...clips[0]!, context: '', transcript: '' }],
          2,
        );
        let stale = '';
        try {
          await peer.assets.updateClips(asset.id, clips, 2);
        } catch (error) {
          stale = (error as { code: string }).code;
        }
        return {
          raceResults,
          notified: eventAssetId === asset.id,
          originalUnchanged,
          untouchedProjectRevision,
          saved: { clips: saved.clips, revision: saved.clipsRevision },
          afterReopen: {
            clips: afterReopen.clips,
            revision: afterReopen.clipsRevision,
          },
          restored: {
            clips: beforeRelink.clips,
            revision: beforeRelink.clipsRevision,
          },
          relinked: { clips: relinked.clips, revision: relinked.clipsRevision },
          legacy: {
            clips: legacyRead.clips,
            revision: legacyRead.clipsRevision,
            savedRevision: legacySaved.clipsRevision,
            retainedLegacyNotes: legacySaved.notes !== undefined,
          },
          restoredMissing: beforeRelink.status,
          cleared: { clips: cleared.clips, revision: cleared.clipsRevision },
          stale,
          finalProjectRevision: (await editor.projects.snapshot(project.id))
            .revision,
        };
      } finally {
        await peer.dispose();
        await editor.dispose();
      }
    }, base);
    const expected = {
      revision: 2,
      clips: [
        {
          id: 'full-source',
          name: 'Opening',
          startUs: 0,
          endUs: 0,
          context: 'Useful opening\nKeep this frame.',
          transcript: 'Xin chào.\n<script>reference text</script>',
        },
      ],
    };
    expect(result).toEqual({
      raceResults: ['REVISION_CONFLICT', 'saved'],
      notified: true,
      originalUnchanged: true,
      untouchedProjectRevision: 0,
      saved: expected,
      afterReopen: expected,
      restored: expected,
      relinked: expected,
      legacy: {
        clips: [{ ...expected.clips[0]!, name: 'Clip 1' }],
        revision: 7,
        savedRevision: 8,
        retainedLegacyNotes: false,
      },
      restoredMissing: 'missing',
      cleared: {
        revision: 3,
        clips: [
          {
            id: 'full-source',
            name: 'Opening',
            startUs: 0,
            endUs: 0,
            context: '',
            transcript: '',
          },
        ],
      },
      stale: 'REVISION_CONFLICT',
      finalProjectRevision: 1,
    });
  });
}

for (const base of behaviorBases) {
  for (const kind of ['video', 'audio'] as const) {
    test(`source clip ${kind} preview seeks, stops at its range and releases media ${base}`, async ({
      page,
    }) => {
      await page.goto(base);
      const seeded = await page.evaluate(
        async ({ base, kind }) => {
          const { createEditor } = (await import(
            base + 'editor.js'
          )) as typeof import('../../src/editor');
          const editor = await createEditor();
          try {
            const project = await editor.projects.create('Source preview', {
              width: 128,
              height: 72,
              frameRate: { num: 25, den: 1 },
            });
            let source: File;
            if (kind === 'video') {
              await editor.commands.apply({
                projectId: project.id,
                expectedRevision: 0,
                requestId: 'preview-seed',
                operations: [
                  {
                    type: 'addTrack',
                    track: {
                      id: 'v',
                      kind: 'video',
                      clips: [
                        {
                          id: 'title',
                          kind: 'text',
                          startUs: 0,
                          durationUs: 2_000_000,
                          width: 128,
                          height: 72,
                          text: {
                            text: 'Preview',
                            color: '#ffffff',
                            background: '#334466',
                            fontSize: 18,
                          },
                        },
                      ],
                    },
                  },
                ],
              });
              const artifact = await editor.exports.start(project.id, {
                format: 'mp4',
              }).completion;
              source = new File([artifact.file], 'source.mp4', {
                type: 'video/mp4',
              });
              const asset = await editor.assets.import(source).completion;
              await artifact.dispose();
              await editor.library.forProject(project.id).place(asset.id, []);
              await editor.assets.updateClips(
                asset.id,
                [
                  {
                    id: 'opening',
                    name: 'Opening',
                    startUs: 300_000,
                    endUs: 800_000,
                    context: 'First section',
                    transcript: 'Opening words',
                  },
                  {
                    id: 'detail',
                    name: 'Detail',
                    startUs: 1_100_000,
                    endUs: 1_700_000,
                    context: 'Second section',
                    transcript: 'Detail words',
                    transcriptCues: [
                      {
                        id: 'detail-speech',
                        timeUs: 1_250_000,
                        endUs: 1_500_000,
                        text: 'Detail words',
                      },
                    ],
                  },
                ],
                0,
              );
              return { projectId: project.id, name: source.name };
            }
            const rate = 16000,
              samples = rate * 2;
            const buffer = new ArrayBuffer(44 + samples * 2),
              view = new DataView(buffer);
            const chars = (offset: number, text: string) => {
              for (let i = 0; i < text.length; i++)
                view.setUint8(offset + i, text.charCodeAt(i));
            };
            chars(0, 'RIFF');
            view.setUint32(4, 36 + samples * 2, true);
            chars(8, 'WAVEfmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);
            view.setUint16(22, 1, true);
            view.setUint32(24, rate, true);
            view.setUint32(28, rate * 2, true);
            view.setUint16(32, 2, true);
            view.setUint16(34, 16, true);
            chars(36, 'data');
            view.setUint32(40, samples * 2, true);
            for (let i = 0; i < samples; i++)
              view.setInt16(
                44 + i * 2,
                Math.sin((i / rate) * Math.PI * 440 * 2) * 2000,
                true,
              );
            source = new File([buffer], 'source.wav', { type: 'audio/wav' });
            const asset = await editor.assets.import(source).completion;
            await editor.library.forProject(project.id).place(asset.id, []);
            await editor.assets.updateClips(
              asset.id,
              [
                {
                  id: 'opening',
                  name: 'Opening',
                  startUs: 300_000,
                  endUs: 800_000,
                  context: 'First section',
                  transcript: 'Opening words',
                },
                {
                  id: 'detail',
                  name: 'Detail',
                  startUs: 1_100_000,
                  endUs: 1_700_000,
                  context: 'Second section',
                  transcript: 'Detail words',
                  transcriptCues: [
                    {
                      id: 'detail-speech',
                      timeUs: 1_250_000,
                      endUs: 1_500_000,
                      text: 'Detail words',
                    },
                  ],
                },
              ],
              0,
            );
            return { projectId: project.id, name: source.name };
          } finally {
            await editor.dispose();
          }
        },
        { base, kind },
      );
      await page.goto(`${base}#/project/${seeded.projectId}`);
      await page
        .getByRole('button', { name: 'Expand media', exact: true })
        .click();
      await page
        .getByRole('button', {
          name: `Asset details for ${seeded.name}`,
          exact: true,
        })
        .hover();
      await page
        .getByRole('button', {
          name: `Actions for ${seeded.name}`,
          exact: true,
        })
        .click();
      await page.getByRole('menuitem', { name: 'Clips', exact: true }).click();
      const dialog = page.getByRole('dialog', {
        name: seeded.name,
        exact: true,
      });
      const media = dialog.locator(kind);
      await expect
        .poll(() =>
          media.evaluate((element: HTMLMediaElement) => element.readyState),
        )
        .toBeGreaterThanOrEqual(2);
      await expect
        .poll(() =>
          media.evaluate((element: HTMLMediaElement) => element.currentTime),
        )
        .toBeCloseTo(0.3, 1);
      const url = await media.getAttribute('src');
      await dialog
        .getByRole('button', { name: 'Play clip', exact: true })
        .click();
      await expect
        .poll(() =>
          media.evaluate((element: HTMLMediaElement) => element.currentTime),
        )
        .toBeGreaterThan(0.4);
      await expect
        .poll(() =>
          media.evaluate((element: HTMLMediaElement) => element.paused),
        )
        .toBe(true);
      expect(
        await media.evaluate(
          (element: HTMLMediaElement) => element.currentTime,
        ),
      ).toBeCloseTo(0.8, 2);
      await dialog.getByRole('option', { name: /Detail/ }).click();
      await dialog
        .getByRole('tab', { name: 'Transcript', exact: true })
        .click();
      await expect(
        dialog.getByRole('textbox', { name: 'Transcript', exact: true }),
      ).toHaveValue('Detail words');
      await expect
        .poll(() =>
          media.evaluate((element: HTMLMediaElement) => element.currentTime),
        )
        .toBeCloseTo(1.1, 1);
      await dialog
        .getByRole('button', {
          name: 'Preview transcript at 00:01.25',
          exact: true,
        })
        .click();
      await expect
        .poll(() =>
          media.evaluate((element: HTMLMediaElement) => element.currentTime),
        )
        .toBeCloseTo(1.25, 2);
      await page.screenshot({
        path: `.artifacts/timestamped-transcript-${kind}.png`,
      });
      const fullText =
        'A complete transcript paragraph. '.repeat(100) +
        'Visible final sentence.';
      await dialog
        .getByRole('textbox', { name: 'Transcript', exact: true })
        .fill(fullText);
      expect(
        await dialog
          .getByRole('textbox', { name: 'Transcript', exact: true })
          .evaluate(
            (element) => element.scrollHeight <= element.clientHeight + 2,
          ),
      ).toBe(true);
      await dialog
        .getByRole('spinbutton', {
          name: 'Transcript start 1 (s)',
          exact: true,
        })
        .fill('1.3');
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(
        dialog.getByRole('button', { name: 'Save', exact: true }),
      ).toHaveCount(0);
      await dialog
        .getByRole('slider', { name: 'Preview position', exact: true })
        .fill('300000');
      await expect
        .poll(() =>
          media.evaluate((element: HTMLMediaElement) => element.currentTime),
        )
        .toBeCloseTo(1.4, 1);
      await dialog
        .getByRole('button', { name: 'Play clip', exact: true })
        .click();
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(dialog).toBeHidden();
      expect(
        await page.evaluate(async (url) => {
          try {
            await fetch(url!);
            return true;
          } catch {
            return false;
          }
        }, url),
      ).toBe(false);
    });
  }
}
