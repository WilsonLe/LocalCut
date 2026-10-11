import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openVersions } from './workspace-settings-helper';
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
  test(`track menu operations, locked edits, stale forms and saved history @journey ${base}`, async ({
    page,
  }, testInfo) => {
    await page.goto(base);
    const id = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const p = await editor.projects.create('Track menu', {
          width: 128,
          height: 72,
        });
        await editor.commands.apply({
          projectId: p.id,
          expectedRevision: 0,
          requestId: 'setup',
          operations: [
            {
              type: 'addTrack',
              track: {
                id: 'v',
                kind: 'video',
                name: 'Footage',
                clips: [
                  {
                    id: 'clip',
                    kind: 'text',
                    startUs: 0,
                    durationUs: 1000000,
                    text: { text: 'Title' },
                    width: 128,
                    height: 72,
                  },
                ],
              },
            },
            {
              type: 'addTrack',
              track: { id: 'a', kind: 'audio', name: 'Music' },
            },
            {
              type: 'addTrack',
              track: { id: 'o', kind: 'overlay', name: 'Titles' },
            },
          ],
        });
        return p.id;
      } finally {
        await editor.dispose();
      }
    }, base);
    await page.goto(`${base}#/project/${id}`);
    const p = () => snapshot(page, base, id);
    const menuButton = (name: string) =>
      page.getByRole('button', { name: `Track menu: ${name}`, exact: true });
    const choose = async (name: string, action: string) => {
      await menuButton(name).click();
      await page.getByRole('menuitem', { name: action, exact: true }).click();
    };
    await test.step('keyboard rename and compact desktop menu', async () => {
      await menuButton('Footage').focus();
      await page.keyboard.press('Enter');
      await expect(
        page.getByRole('menu', { name: 'Track menu: Footage' }),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath('track-menu-desktop.png'),
      });
      await page
        .getByRole('menuitem', { name: 'Rename track', exact: true })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Rename track' });
      await dialog
        .getByLabel('Track name', { exact: true })
        .fill('Main footage');
      await dialog.getByRole('button', { name: 'Save name' }).click();
      await expect(menuButton('Main footage')).toBeVisible();
      await expect(menuButton('Main footage')).toBeFocused();
      expect((await p()).tracks[0]!.name).toBe('Main footage');
    });
    await test.step('toggle output states and lock, retaining readable clips', async () => {
      for (const [action, field, value] of [
        ['Disable track', 'disabled', true],
        ['Enable track', 'disabled', false],
        ['Mute track', 'muted', true],
        ['Unmute track', 'muted', false],
        ['Solo track', 'solo', true],
        ['Unsolo track', 'solo', false],
        ['Lock track', 'locked', true],
      ] as const) {
        await choose('Main footage', action);
        await expect
          .poll(async () => (await p()).tracks[0]![field])
          .toBe(value);
        await expect(menuButton('Main footage')).toBeFocused();
      }
      await page.locator('[data-clip-id="clip"]').click();
      await expect(
        page.getByRole('button', { name: 'Delete clip', exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole('main', { name: 'Video editor', exact: true })
        .focus();
      await page.keyboard.press('Delete');
      expect((await p()).tracks[0]!.clips).toHaveLength(1);
      await page
        .getByRole('button', { name: 'Clip properties', exact: true })
        .click();
      await expect(
        page.getByRole('dialog', { name: 'Clip properties' }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Apply properties', exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole('dialog', { name: 'Clip properties' })
        .getByRole('button', { name: 'Close', exact: true })
        .click();

      await menuButton('Main footage').click();
      await expect(
        page.getByRole('menuitem', { name: 'Delete track', exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('menuitem', { name: 'Clear track clips', exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('menuitem', { name: 'Move track down', exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole('menuitem', { name: 'Unlock track', exact: true })
        .click();
      await expect.poll(async () => (await p()).tracks[0]!.locked).toBe(false);
    });
    await test.step('duplicate, reorder, confirm clearing/deletion and undo', async () => {
      await choose('Main footage', 'Duplicate track');
      await expect(menuButton('Main footage copy')).toBeVisible();
      const copied = (await p()).tracks[1]!;
      expect(copied.clips[0]!.id).not.toBe('clip');
      await choose('Main footage copy', 'Move track down');
      await expect.poll(async () => (await p()).tracks[2]!.id).toBe(copied.id);
      await choose('Main footage copy', 'Move track up');
      await expect.poll(async () => (await p()).tracks[1]!.id).toBe(copied.id);
      await choose('Main footage copy', 'Clear track clips');
      await page
        .getByRole('dialog', { name: 'Clear track clips' })
        .getByRole('button', { name: 'Cancel', exact: true })
        .click();
      expect((await p()).tracks[1]!.clips).toHaveLength(1);
      await choose('Main footage copy', 'Clear track clips');
      await page
        .getByRole('dialog', { name: 'Clear track clips' })
        .getByRole('button', { name: 'Clear clips', exact: true })
        .click();
      await expect
        .poll(async () => (await p()).tracks[1]!.clips.length)
        .toBe(0);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect
        .poll(async () => (await p()).tracks[1]!.clips.length)
        .toBe(1);
      await choose('Main footage copy', 'Delete track');
      await page
        .getByRole('dialog', { name: 'Delete track' })
        .getByRole('button', { name: 'Delete track', exact: true })
        .click();
      await expect(menuButton('Main footage copy')).toHaveCount(0);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(menuButton('Main footage copy')).toBeVisible();
    });
    await test.step('stale rename cannot overwrite an external edit', async () => {
      await choose('Main footage', 'Rename track');
      await page.getByLabel('Track name', { exact: true }).fill('Stale name');
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
              requestId: 'external',
              operations: [
                {
                  type: 'updateTrack',
                  trackId: 'v',
                  patch: { name: 'External name' },
                },
              ],
            });
          } finally {
            await editor.dispose();
          }
        },
        { base, id },
      );
      await expect(page.getByRole('alert')).toContainText(
        'The project changed',
      );
      await expect(page.getByRole('button', { name: 'Save name' })).toHaveCount(
        0,
      );
      await page
        .getByRole('dialog', { name: 'Rename track' })
        .getByRole('button', { name: 'Cancel', exact: true })
        .click();
      await expect(menuButton('External name')).toBeVisible();
    });
    await test.step('reload, read-only versions and mobile menu', async () => {
      const before = await p();
      await page.reload();
      await expect(menuButton('External name')).toBeVisible();
      expect((await p()).tracks).toEqual(before.tracks);
      await openVersions(page);
      await page
        .getByRole('group', { name: 'Saved versions' })
        .getByRole('button')
        .last()
        .click();
      await expect(page.getByText(/Version \d+ · Read-only/)).toBeVisible();
      await expect(
        page.getByRole('button', { name: /^Track menu:/ }),
      ).toHaveCount(0);
      await page
        .getByRole('button', { name: 'Return to current', exact: true })
        .click();
      await expect(menuButton('External name')).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await menuButton('Titles').click();
      await expect(
        page.getByRole('menuitem', { name: 'Mute track', exact: true }),
      ).toHaveCount(0);
      const menu = page.getByRole('menu', { name: 'Track menu: Titles' });
      const box = (await menu.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      await page.screenshot({
        path: testInfo.outputPath('track-menu-mobile.png'),
      });
      await page.keyboard.press('Escape');
    });
  });
}
for (const base of ['/', '/LocalCut/']) {
  test(`track disable mute solo share native preview/export and AI-approved commands ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const result = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const { createAssistant } = (await import(
        base + 'ai.js'
      )) as typeof import('../../src/ai');
      const editor = await createEditor({
        namespace: 'test-tracks-' + crypto.randomUUID(),
      });
      const ctx = new OffscreenCanvas(128, 72).getContext('2d')!;
      const audioContext = new AudioContext({ sampleRate: 48000 });
      const artifacts: Awaited<
        ReturnType<typeof editor.exports.start>['completion']
      >[] = [];
      let assistant: ReturnType<typeof createAssistant> | undefined;
      try {
        const colors: string[] = [];
        for (const color of ['red', 'blue']) {
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 128, 72);
          colors.push(
            (
              await editor.assets.import(
                new File([await ctx.canvas.convertToBlob()], `${color}.png`, {
                  type: 'image/png',
                }),
              ).completion
            ).id,
          );
        }
        const tones: string[] = [];
        for (const hz of [440, 880]) {
          const buffer = new ArrayBuffer(44 + 48000 * 2),
            view = new DataView(buffer);
          const str = (offset: number, value: string) => {
            for (let i = 0; i < value.length; i++)
              view.setUint8(offset + i, value.charCodeAt(i));
          };
          str(0, 'RIFF');
          view.setUint32(4, buffer.byteLength - 8, true);
          str(8, 'WAVE');
          str(12, 'fmt ');
          view.setUint32(16, 16, true);
          view.setUint16(20, 1, true);
          view.setUint16(22, 1, true);
          view.setUint32(24, 48000, true);
          view.setUint32(28, 96000, true);
          view.setUint16(32, 2, true);
          view.setUint16(34, 16, true);
          str(36, 'data');
          view.setUint32(40, 96000, true);
          for (let i = 0; i < 48000; i++)
            view.setInt16(
              44 + i * 2,
              Math.sin((2 * Math.PI * hz * i) / 48000) * 6000,
              true,
            );
          tones.push(
            (
              await editor.assets.import(
                new File([buffer], `tone-${hz}.wav`, { type: 'audio/wav' }),
              ).completion
            ).id,
          );
        }
        const source = await editor.projects.create('Blue with sound', {
          width: 128,
          height: 72,
        });
        await editor.commands.apply({
          projectId: source.id,
          expectedRevision: 0,
          requestId: 'source',
          operations: [
            {
              type: 'addTrack',
              track: {
                id: 'image',
                kind: 'video',
                clips: [
                  {
                    id: 'blue',
                    kind: 'image',
                    assetId: colors[1],
                    startUs: 0,
                    durationUs: 1000000,
                    width: 128,
                    height: 72,
                  },
                ],
              },
            },
            {
              type: 'addTrack',
              track: {
                id: 'tone',
                kind: 'audio',
                clips: [
                  {
                    id: 'audio',
                    kind: 'audio',
                    assetId: tones[1],
                    startUs: 0,
                    durationUs: 1000000,
                    sourceOutUs: 1000000,
                  },
                ],
              },
            },
          ],
        });
        const sourceArtifact = await editor.exports.start(source.id, {
          format: 'webm',
        }).completion;
        artifacts.push(sourceArtifact);
        const blue = await editor.assets.import(
          new File([sourceArtifact.file], 'blue.webm', { type: 'video/webm' }),
        ).completion;
        const p = await editor.projects.create('Track outputs', {
          width: 128,
          height: 72,
        });
        await editor.commands.apply({
          projectId: p.id,
          expectedRevision: 0,
          requestId: 'setup',
          operations: [
            {
              type: 'addTrack',
              track: {
                id: 'lower',
                kind: 'video',
                clips: [
                  {
                    id: 'red',
                    kind: 'image',
                    assetId: colors[0],
                    startUs: 0,
                    durationUs: 1000000,
                    width: 128,
                    height: 72,
                  },
                ],
              },
            },
            {
              type: 'addTrack',
              track: {
                id: 'upper',
                kind: 'video',
                clips: [
                  {
                    id: 'blue-video',
                    kind: 'video',
                    assetId: blue.id,
                    startUs: 0,
                    durationUs: 1000000,
                    sourceOutUs: 1000000,
                    width: 128,
                    height: 72,
                  },
                ],
              },
            },
            {
              type: 'addTrack',
              track: {
                id: 'music',
                kind: 'audio',
                clips: [
                  {
                    id: 'music-clip',
                    kind: 'audio',
                    assetId: tones[0],
                    startUs: 0,
                    durationUs: 1000000,
                    sourceOutUs: 1000000,
                  },
                ],
              },
            },
          ],
        });
        const pixel = async (id: string) => {
          const frame = await editor.preview.frame(id, 300000, {
            width: 128,
            height: 72,
          }).completion;
          try {
            ctx.drawImage(frame.image, 0, 0);
            return [...ctx.getImageData(40, 40, 1, 1).data];
          } finally {
            frame.image.close();
          }
        };
        const initial = await pixel(p.id);
        const operations: import('../../src/editor').EditOperation[] = [
          {
            type: 'updateTrack',
            trackId: 'upper',
            patch: { name: 'Assistant footage', disabled: true },
          },
          { type: 'duplicateTrack', trackId: 'upper', newTrackId: 'copy' },
          { type: 'clearTrack', trackId: 'copy' },
          { type: 'reorderTrack', trackId: 'copy', index: 0 },
          { type: 'removeTrack', trackId: 'copy' },
        ];
        let round = 0;
        let exposed = '';
        assistant = createAssistant({
          editor,
          projectId: p.id,
          model: 'test/tracks',
          provider: {
            async *stream(request) {
              exposed += JSON.stringify(request.tools);
              const names =
                round === 0
                  ? ['load_skill']
                  : round === 1
                    ? ['validate_edits', 'propose_edits']
                    : [];
              round++;
              yield {
                type: 'complete' as const,
                message: {
                  role: 'assistant' as const,
                  content: names.length ? null : 'Review track changes',
                  ...(names.length
                    ? {
                        tool_calls: names.map((name) => ({
                          id: crypto.randomUUID(),
                          type: 'function' as const,
                          function: {
                            name,
                            arguments: JSON.stringify(
                              name === 'load_skill'
                                ? { skillId: 'editing' }
                                : name === 'propose_edits'
                                  ? {
                                      summary:
                                        'Disable footage and test a duplicate',
                                      operations,
                                    }
                                  : { operations },
                            ),
                          },
                        })),
                      }
                    : {}),
                },
              };
            },
          },
        });
        const turn = await assistant.run(
          'Disable footage and test track operations',
        ).completion;
        const beforeApproval = await editor.projects.snapshot(p.id);
        await assistant.applyProposal(turn.proposalIds[0]!);
        const afterApproval = await editor.projects.snapshot(p.id);
        const outputs: {
          state: string;
          format: string;
          preview: number[];
          encoded: number[];
          hz: number;
          rms: number;
        }[] = [];
        for (const state of ['disabled', 'solo', 'muted-solo']) {
          if (state !== 'disabled') {
            const current = await editor.projects.snapshot(p.id);
            await editor.commands.apply({
              projectId: p.id,
              expectedRevision: current.revision,
              requestId: state,
              operations: [
                {
                  type: 'updateTrack',
                  trackId: 'upper',
                  patch: {
                    disabled: false,
                    solo: true,
                    muted: state === 'muted-solo',
                  },
                },
              ],
            });
          }
          const preview = await pixel(p.id);
          for (const format of ['mp4', 'webm'] as const) {
            const artifact = await editor.exports.start(p.id, { format })
              .completion;
            artifacts.push(artifact);
            const asset = await editor.assets.import(
              new File([artifact.file], `${state}.${format}`, {
                type: format === 'mp4' ? 'video/mp4' : 'video/webm',
              }),
            ).completion;
            const decoded = await audioContext.decodeAudioData(
              await (
                await editor.assets.derivative(asset.id, 'pcm').completion
              ).arrayBuffer(),
            );
            const samples = decoded.getChannelData(0);
            const start = Math.round(decoded.sampleRate * 0.2),
              end = Math.round(decoded.sampleRate * 0.8);
            let crossings = 0,
              energy = 0;
            for (let i = start; i < end; i++) {
              energy += samples[i]! ** 2;
              if (samples[i - 1]! <= 0 && samples[i]! > 0) crossings++;
            }
            const reopened = await editor.projects.create('Reopened', {
              width: 128,
              height: 72,
            });
            await editor.commands.apply({
              projectId: reopened.id,
              expectedRevision: 0,
              requestId: 'reopen',
              operations: [
                {
                  type: 'addTrack',
                  track: {
                    id: 'v',
                    kind: 'video',
                    clips: [
                      {
                        id: 'encoded',
                        kind: 'video',
                        assetId: asset.id,
                        startUs: 0,
                        durationUs: asset.durationUs,
                        sourceOutUs: asset.durationUs,
                        width: 128,
                        height: 72,
                      },
                    ],
                  },
                },
              ],
            });
            outputs.push({
              state,
              format,
              preview,
              encoded: await pixel(reopened.id),
              hz: crossings / 0.6,
              rms: Math.sqrt(energy / (end - start)),
            });
          }
        }
        const final = await editor.projects.snapshot(p.id);
        await editor.commands.undo(p.id, 'undo', final.revision);
        const undone = await editor.projects.snapshot(p.id);
        return {
          initial,
          beforeApproval,
          afterApproval,
          outputs,
          exposed,
          undone,
        };
      } finally {
        await assistant?.dispose();
        for (const artifact of artifacts) await artifact.dispose();
        await audioContext.close();
        await editor.dispose();
      }
    }, base);
    expect(result.initial[2]).toBeGreaterThan(200);
    expect(result.beforeApproval.tracks[1]!.disabled).toBeUndefined();
    expect(result.afterApproval.tracks[1]).toMatchObject({
      name: 'Assistant footage',
      disabled: true,
    });
    expect(result.afterApproval.tracks).toHaveLength(3);
    for (const type of [
      'updateTrack',
      'duplicateTrack',
      'clearTrack',
      'removeTrack',
      'reorderTrack',
    ])
      expect(result.exposed).toContain(type);
    for (const output of result.outputs) {
      const color = output.state === 'disabled' ? 0 : 2;
      expect(output.preview[color]).toBeGreaterThan(200);
      expect(output.encoded[color]).toBeGreaterThan(180);
      if (output.state === 'muted-solo') expect(output.rms).toBeLessThan(0.002);
      else {
        expect(output.rms).toBeGreaterThan(0.05);
        expect(output.hz).toBeCloseTo(
          output.state === 'disabled' ? 440 : 880,
          -1,
        );
      }
    }
    expect(result.undone.tracks[1]!.muted).toBe(false);
  });
}
