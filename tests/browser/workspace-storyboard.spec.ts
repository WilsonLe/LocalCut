import { openVersions } from './workspace-settings-helper';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
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
  test(`workspace storyboard rejects drops and keeps failed fonts local ${base}`, async ({
    page,
  }) => {
    const remote: string[] = [];
    const localFonts: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.hostname !== '127.0.0.1') remote.push(url.href);
      if (
        url.pathname.includes('/storyboard/') &&
        url.pathname.endsWith('.woff2')
      )
        localFonts.push(url.href);
    });
    await page.route('**/storyboard/**/fonts/**', (route) => route.abort());
    await page.goto(base);
    const id = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const project = await editor.projects.create('Local font failure');
        await editor.commands.apply({
          projectId: project.id,
          requestId: crypto.randomUUID(),
          expectedRevision: 0,
          operations: [
            {
              type: 'upsertStoryboardElements',
              elements: [
                {
                  id: 'label',
                  type: 'text',
                  text: 'Keep this storyboard',
                  x: 100,
                  y: 100,
                },
              ],
            },
          ],
        });
        await editor.projects.versions.save(project.id);
        return project.id;
      } finally {
        await editor.dispose();
      }
    }, base);
    await page.goto(`${base}#/project/${id}`);
    await page.getByRole('tab', { name: 'Storyboard', exact: true }).click();
    const canvas = page.locator('.storyboard canvas.interactive');
    await expect(canvas).toBeVisible();
    await expect.poll(() => localFonts.length).toBeGreaterThan(0);
    await page.evaluate(() => document.fonts.ready);
    expect(remote).toEqual([]);

    const drop = async (library = false) => {
      const before = await snapshot(page, base, id);
      const pixels = await page
        .locator('.storyboard canvas.static')
        .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
      const result = await canvas.evaluate((canvas, library) => {
        const data = new DataTransfer();
        const element = {
          id: 'replacement',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
        };
        if (library) {
          data.setData(
            'application/vnd.excalidrawlib+json',
            JSON.stringify({
              type: 'excalidrawlib',
              version: 2,
              libraryItems: [
                {
                  id: 'library',
                  status: 'published',
                  created: 1,
                  elements: [element],
                },
              ],
            }),
          );
        } else {
          data.items.add(
            new File(
              [
                JSON.stringify({
                  type: 'excalidraw',
                  version: 2,
                  elements: [
                    element,
                    {
                      ...element,
                      id: 'image',
                      type: 'image',
                      fileId: 'unowned',
                    },
                  ],
                  appState: { viewBackgroundColor: '#ff0000' },
                  files: {},
                }),
              ],
              'unowned.excalidraw',
              { type: 'application/json' },
            ),
          );
        }
        let reachedCanvas = false;
        const received = () => {
          reachedCanvas = true;
        };
        canvas.addEventListener('drop', received);
        const canceled = !canvas.dispatchEvent(
          new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer: data,
          }),
        );
        canvas.removeEventListener('drop', received);
        return { canceled, reachedCanvas };
      }, library);
      expect(result).toEqual({ canceled: true, reachedCanvas: false });
      await expect(
        page.getByRole('dialog', { name: 'Import media' }),
      ).toHaveCount(0);
      expect(await snapshot(page, base, id)).toEqual(before);
      expect(
        await page
          .locator('.storyboard canvas.static')
          .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL()),
      ).toBe(pixels);
    };
    await drop();
    await drop(true);
    await canvas.click({ position: { x: 400, y: 180 } });
    await page.keyboard.press('r');
    const bounds = (await canvas.boundingBox())!;
    await page.mouse.move(bounds.x + 400, bounds.y + 180);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 550, bounds.y + 260, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await snapshot(page, base, id)).storyboard?.elements.filter(
            (e) => e.type === 'rectangle',
          ).length,
      )
      .toBe(1);
    await openVersions(page);
    await page
      .getByRole('button', { name: /^Version / })
      .first()
      .click();
    await expect(
      page.getByRole('button', { name: 'Undo', exact: true }),
    ).toHaveCount(0);
    await drop();
    await drop(true);
    expect(remote).toEqual([]);
  });
  test(`workspace storyboard drawing, history, approved agent, backups and mobile @journey ${base}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const external: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (!new URL(request.url()).hostname.includes('127.0.0.1'))
        external.push(request.url());
    });
    await page.goto(base);
    const id = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const project = await editor.projects.create('Storyboard film');
        await editor.commands.apply({
          projectId: project.id,
          requestId: crypto.randomUUID(),
          expectedRevision: 0,
          operations: [
            { type: 'addTrack', track: { id: 'titles', kind: 'overlay' } },
            {
              type: 'insertClip',
              trackId: 'titles',
              clip: {
                id: 'title',
                kind: 'text',
                startUs: 0,
                durationUs: 1e6,
                text: { text: 'Timeline title' },
              },
            },
          ],
        });
        return project.id;
      } finally {
        await editor.dispose();
      }
    }, base);
    await page.goto(`${base}#/project/${id}`);
    const editorTab = page.getByRole('tab', { name: 'Editor', exact: true });
    const storyboardTab = page.getByRole('tab', {
      name: 'Storyboard',
      exact: true,
    });
    const checkHeader = async () => {
      await storyboardTab.focus();
      await expect(editorTab).toBeVisible();
      await expect(storyboardTab).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => {
            const header = [
              ...document.querySelectorAll<HTMLElement>(
                '.workspace-header, .mobile-edit-heading',
              ),
            ].find((element) => element.checkVisibility());
            const actions = header?.querySelector('.header-actions');
            const views = header?.querySelector('[role="tablist"]');
            const tabs = views?.querySelectorAll('[role="tab"]');
            if (
              !actions?.checkVisibility() ||
              !views?.checkVisibility() ||
              !tabs?.[0]?.checkVisibility() ||
              !tabs[1]?.checkVisibility()
            )
              return null;
            const actionBox = actions.getBoundingClientRect();
            const viewBox = views.getBoundingClientRect();
            const first = tabs[0].getBoundingClientRect();
            const second = tabs[1].getBoundingClientRect();
            return {
              actionsBeforeTabs: viewBox.x >= actionBox.right,
              firstAtStart: Math.abs(first.x - viewBox.x) < 0.5,
              ordered: second.x > first.x,
              fitsViewport: viewBox.right <= innerWidth,
              projectIconCount: header!.querySelectorAll(
                'button[aria-label="Open project"] svg',
              ).length,
            };
          }),
        )
        .toEqual({
          actionsBeforeTabs: true,
          firstAtStart: true,
          ordered: true,
          fitsViewport: true,
          projectIconCount: 0,
        });
    };
    const checkHistoryToolbar = async () => {
      await expect(page.locator('.storyboard-heading')).toHaveCount(0);
      const toolbar = page.locator('.storyboard .App-toolbar').filter({
        has: page.getByRole('group', { name: 'Project history' }),
      });
      await expect(toolbar).toHaveCount(1);
      await expect(
        toolbar.getByRole('radio', { name: /Rectangle/ }),
      ).toBeVisible();
      for (const name of ['Undo', 'Redo']) {
        const button = toolbar.getByRole('button', { name, exact: true });
        await expect(button).toBeVisible();
        await expect(button).toHaveText('');
        await expect(button.locator('svg')).toHaveCount(1);
        const bar = await toolbar.boundingBox();
        const control = await button.boundingBox();
        expect(control!.x).toBeGreaterThanOrEqual(bar!.x);
        expect(control!.x + control!.width).toBeLessThanOrEqual(
          bar!.x + bar!.width,
        );
        expect(control!.y).toBeGreaterThanOrEqual(bar!.y);
        expect(control!.y + control!.height).toBeLessThanOrEqual(
          bar!.y + bar!.height,
        );
      }
      const undo = toolbar.getByRole('button', { name: 'Undo', exact: true });
      await toolbar.getByRole('button', { name: 'Redo', exact: true }).focus();
      await page.keyboard.press('Shift+Tab');
      await expect(undo).toBeFocused();
      await expect(
        page.getByRole('tooltip', { name: 'Undo', exact: true }),
      ).toBeVisible();
      await canvas.focus();
    };
    await checkHeader();
    await expect(page.locator('.brand')).toHaveText('LocalCut');
    await expect(
      page.getByRole('button', { name: 'LocalCut home' }),
    ).toHaveCount(0);
    await expect(page.locator('.brand')).toHaveJSProperty('tagName', 'SPAN');
    await expect(editorTab).toHaveAttribute('aria-selected', 'true');
    await editorTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(storyboardTab).toBeFocused();
    const canvas = page.locator('.storyboard canvas.interactive');
    await expect(canvas).toBeVisible();
    await checkHistoryToolbar();
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    const x = bounds!.x + 360,
      y = bounds!.y + 160;
    await canvas.click({ position: { x: 100, y: 130 } });
    await page.keyboard.press('r');
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 160, y + 100, { steps: 10 });
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await snapshot(page, base, id)).storyboard?.elements.filter(
            (e) => e.type === 'rectangle',
          ).length,
      )
      .toBe(1);
    await page.keyboard.press('t');
    await canvas.click({ position: { x: 360, y: 310 } });
    const text = page.locator('textarea.excalidraw-wysiwyg');
    await expect(text).toBeVisible();
    await text.fill('Private storyboard label');
    await page.keyboard.press('Escape');
    await expect
      .poll(
        async () =>
          (await snapshot(page, base, id)).storyboard?.elements.find(
            (e) => e.type === 'text',
          )?.text,
      )
      .toBe('Private storyboard label');
    await test.step('tabs retain scene; shared undo and redo leave the timeline intact', async () => {
      await editorTab.click();
      await expect(canvas).toBeHidden();
      await expect(
        page.getByRole('button', { name: 'Add text', exact: true }),
      ).toBeVisible();
      await storyboardTab.click();
      await expect(canvas).toBeVisible();
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect
        .poll(
          async () =>
            (await snapshot(page, base, id)).storyboard?.elements.filter(
              (e) => e.type === 'text',
            ).length,
        )
        .toBe(0);
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect
        .poll(
          async () =>
            (await snapshot(page, base, id)).storyboard?.elements.filter(
              (e) => e.type === 'text',
            ).length,
        )
        .toBe(1);
      await canvas.click({ position: { x: 50, y: 400 } });
      await page.keyboard.press('ControlOrMeta+z');
      await expect
        .poll(
          async () =>
            (await snapshot(page, base, id)).storyboard?.elements.filter(
              (e) => e.type === 'text',
            ).length,
        )
        .toBe(0);
      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect
        .poll(
          async () =>
            (await snapshot(page, base, id)).storyboard?.elements.filter(
              (e) => e.type === 'text',
            ).length,
        )
        .toBe(1);
      expect(
        (await snapshot(page, base, id)).tracks[0]!.clips[0]!.text!.text,
      ).toBe('Timeline title');
    });
    const result = await page.evaluate(
      async ({ base, id }) => {
        const { createEditor } = (await import(
          base + 'editor.js'
        )) as typeof import('../../src/editor');
        const { createAssistant } = (await import(
          base + 'ai.js'
        )) as typeof import('../../src/ai');
        const editor = await createEditor();
        const project = await editor.projects.snapshot(id);
        const shape = project.storyboard!.elements.find(
          (e) => e.type === 'rectangle',
        )!;
        const requests: import('../../src/ai').ChatRequest[] = [];
        let round = 0;
        const assistant = createAssistant({
          editor,
          projectId: id,
          model: 'test/storyboard',
          provider: {
            async *stream(request) {
              requests.push(structuredClone(request));
              const calls = [
                { name: 'load_skill', args: { skillId: 'storyboard' } },
                { name: 'inspect_storyboard', args: { limit: 1 } },
                {
                  name: 'propose_edits',
                  args: {
                    summary: 'Move the shot panel',
                    operations: [
                      {
                        type: 'upsertStoryboardElements',
                        elements: [{ id: shape.id, x: shape.x + 120 }],
                      },
                    ],
                  },
                },
              ];
              const call = calls[round++];
              yield {
                type: 'complete' as const,
                message: {
                  role: 'assistant' as const,
                  content: call ? null : 'Ready for review',
                  ...(call
                    ? {
                        tool_calls: [
                          {
                            id: crypto.randomUUID(),
                            type: 'function' as const,
                            function: {
                              name: call.name,
                              arguments: JSON.stringify(call.args),
                            },
                          },
                        ],
                      }
                    : {}),
                },
              };
            },
          },
        });
        try {
          await assistant.run('Move the shot panel').completion;
          const proposal = assistant.snapshot().proposals[0]!;
          const before = (await editor.projects.snapshot(id)).revision;
          await assistant.approveProposal(proposal.id);
          const after = await editor.projects.snapshot(id);
          await editor.projects.versions.save(id);
          const version = (await editor.projects.versions.list(id))[0]!;
          const historical = await editor.projects.versions.snapshot(
            id,
            version.id,
          );
          const backup = await editor.projects.exportJSON(id);
          const imported = await editor.projects.importJSON(backup);
          const workspace = await editor.workspace.snapshot([id]);
          const [workspaceCopy] = await editor.workspace.import(
            { backup: workspace, files: new Map() },
            { projectIds: [id], assetIds: [], includeVersions: true },
          ).completion;
          const other = await editor.projects.create('Other film');
          return {
            before,
            revision: after.revision,
            expectedX: shape.x + 120,
            x: after.storyboard!.elements.find((e) => e.id === shape.id)!.x,
            leaked: JSON.stringify(requests).includes(
              'Private storyboard label',
            ),
            sameVersion:
              JSON.stringify(historical.project.storyboard) ===
              JSON.stringify(after.storyboard),
            sameBackup:
              JSON.stringify(imported.storyboard) ===
              JSON.stringify(after.storyboard),
            otherId: other.id,
            otherEmpty: !other.storyboard,
            sameWorkspace:
              JSON.stringify(workspaceCopy!.storyboard) ===
              JSON.stringify(after.storyboard),
          };
        } finally {
          await assistant.dispose();
          await editor.dispose();
        }
      },
      { base, id },
    );
    expect(result.revision).toBe(result.before + 1);
    expect(result.x).toBe(result.expectedX);
    expect(result.leaked).toBe(false);
    expect(result.sameVersion).toBe(true);
    expect(result.sameBackup).toBe(true);
    expect(result.otherEmpty).toBe(true);
    expect(result.sameWorkspace).toBe(true);
    await openVersions(page);
    await page
      .getByRole('button', { name: /^Version / })
      .first()
      .click();
    await expect(
      page.getByRole('button', { name: 'Undo', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Redo', exact: true }),
    ).toHaveCount(0);
    const readOnlyRevision = (await snapshot(page, base, id)).revision;
    await canvas.click({ position: { x: 370, y: 200 } });
    await page.keyboard.press('r');
    await page.mouse.move(600, 440);
    await page.mouse.down();
    await page.mouse.move(750, 540);
    await page.mouse.up();
    expect((await snapshot(page, base, id)).revision).toBe(readOnlyRevision);
    await page
      .getByRole('button', { name: 'Close versions', exact: true })
      .click();
    await page.reload();
    await storyboardTab.click();
    await expect(canvas).toBeVisible();
    expect(
      (await snapshot(page, base, id)).storyboard!.elements.find(
        (e) => e.type === 'rectangle',
      )!.x,
    ).toBe(result.expectedX);
    await checkHistoryToolbar();
    await page.screenshot({
      path: testInfo.outputPath('storyboard-desktop.png'),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(storyboardTab).toBeVisible();
    await checkHeader();
    await expect(canvas).toBeVisible();
    await checkHistoryToolbar();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await editorTab.click();
    await expect(canvas).toBeHidden();
    await storyboardTab.click();
    await checkHistoryToolbar();
    const beforeMobileHistory = await snapshot(page, base, id);
    await page
      .getByRole('button', { name: 'Undo', exact: true })
      .press('Enter');
    await expect
      .poll(async () => (await snapshot(page, base, id)).revision)
      .toBe(beforeMobileHistory.revision + 1);
    await page
      .getByRole('button', { name: 'Redo', exact: true })
      .press('Space');
    await expect
      .poll(async () => (await snapshot(page, base, id)).storyboard)
      .toEqual(beforeMobileHistory.storyboard);
    await canvas.focus();
    await page.screenshot({
      path: testInfo.outputPath('storyboard-mobile.png'),
    });
    await page.goto(`${base}#/project/${result.otherId}`);
    await storyboardTab.click();
    await expect(canvas).toBeVisible();
    expect(
      (await snapshot(page, base, result.otherId)).storyboard?.elements ?? [],
    ).toEqual([]);
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  });
}
