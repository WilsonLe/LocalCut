import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type {
  Project,
  EditReceipt,
  Asset,
  ProjectVersionInfo,
} from '../../src/editor';
import type { SiteTool } from '../../src/workspace/webmcp/types';
import { behaviorBases } from './coverage-bases';
import { openVersions } from './workspace-settings-helper';

interface ToolContext {
  getTools(): Promise<SiteTool[]>;
  executeTool(tool: SiteTool, input: unknown): Promise<unknown>;
}
async function installHarness(page: Page) {
  await page.addInitScript(() => {
    const tools = new Map<
      string,
      {
        name: string;
        execute(
          input: unknown,
          options: { signal: AbortSignal },
        ): Promise<unknown>;
      }
    >();
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        async registerTool(
          tool: {
            name: string;
            execute(
              input: unknown,
              options: { signal: AbortSignal },
            ): Promise<unknown>;
          },
          options: { signal: AbortSignal },
        ) {
          if (options.signal.aborted) throw options.signal.reason;
          if (tools.has(tool.name)) throw new Error('Duplicate tool name');
          tools.set(tool.name, tool);
          options.signal.addEventListener(
            'abort',
            () => tools.delete(tool.name),
            { once: true },
          );
        },
        async getTools() {
          return [...tools.values()];
        },
        async executeTool(tool: { name: string }, input: unknown) {
          const registered = tools.get(tool.name);
          if (!registered) throw new Error('Tool unavailable');
          return registered.execute(input, {
            signal: new AbortController().signal,
          });
        },
      },
    });
  });
}
async function call<T = Record<string, unknown>>(
  page: Page,
  name: string,
  input: unknown = {},
): Promise<T> {
  return page.evaluate(
    async ({ name, input }) => {
      const context = (document as Document & { modelContext: ToolContext })
        .modelContext;
      const tool = (await context.getTools()).find(
        (tool) => tool.name === `localcut_${name}`,
      );
      if (!tool) throw new Error(`Missing tool: ${name}`);
      const result = await context.executeTool(tool, input);
      return typeof result === 'string' ? JSON.parse(result) : result;
    },
    { name, input },
  ) as Promise<T>;
}
async function ready(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const context = (document as Document & { modelContext?: ToolContext })
          .modelContext;
        return context
          ? (await context.getTools()).some(
              (tool) => tool.name === 'localcut_backup_project',
            )
          : false;
      }),
    )
    .toBe(true);
}
async function workspaceReady(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const context = (document as Document & { modelContext?: ToolContext })
          .modelContext;
        return context
          ? (await context.getTools()).some(
              (tool) => tool.name === 'localcut_workspace',
            )
          : false;
      }),
    )
    .toBe(true);
}
async function projectReady(page: Page, id: string) {
  await expect(async () => {
    expect((await call<Inspection>(page, 'inspect_project')).project.id).toBe(
      id,
    );
  }).toPass();
}

async function projectSetupJourney(page: Page, base: string) {
  await workspaceReady(page);
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  expect(
    await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .some((entry) => /\/assets\/(editor|worker)-/.test(entry.name)),
    ),
  ).toBe(false);
  expect(await call(page, 'workspace', { action: 'status' })).toMatchObject({
    projectId: null,
    imports: null,
  });
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  const created = await call<{ project: Project }>(page, 'workspace', {
    action: 'create_project',
    name: 'Agent started this cut',
    settings: { width: 128, height: 72, frameRate: { num: 25, den: 1 } },
  });
  const id = created.project.id;
  await projectReady(page, id);
  expect(
    (await call<Inspection>(page, 'inspect_project')).project,
  ).toMatchObject({
    id,
    frameRate: { num: 25, den: 1 },
  });
  const bytes = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 18;
    canvas.getContext('2d')!.fillRect(0, 0, 32, 18);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  const fixture = {
    name: 'agent-file.png',
    mimeType: 'image/png',
    buffer: Buffer.from(bytes, 'base64'),
  };
  const chooserPromise = page.waitForEvent('filechooser');
  expect(
    await call(page, 'workspace', {
      action: 'import_files',
      expectedProjectId: id,
    }),
  ).toMatchObject({ status: 'awaiting_file_selection' });
  const chooser = await chooserPromise;
  await chooser.setFiles(fixture);
  await expect
    .poll(
      async () =>
        (
          await call<{ imports: { running: boolean } | null }>(
            page,
            'workspace',
            { action: 'status' },
          )
        ).imports?.running,
    )
    .toBe(false);
  const imported = await call<Inspection>(page, 'inspect_project');
  expect(imported.assets).toHaveLength(1);
  expect(imported.assets[0]).toMatchObject({
    name: fixture.name,
    status: 'ready',
  });
  expect(imported.project.tracks).toHaveLength(0);
  await page.getByRole('button', { name: 'Okay', exact: true }).click();
  expect(
    await call(page, 'apply_edits', {
      projectId: id,
      expectedRevision: 0,
      requestId: 'agent-setup-edit',
      operations: [
        {
          type: 'addTrack',
          track: {
            id: 'v',
            kind: 'video',
            clips: [
              {
                id: 'agent-clip',
                kind: 'image',
                assetId: imported.assets[0]!.id,
                startUs: 0,
                durationUs: 1000000,
              },
            ],
          },
        },
      ],
    }),
  ).toMatchObject({ appliedRevision: 1 });
  await expect(page.locator('[data-clip-id="agent-clip"]')).toBeVisible();
  const listed = await call<{ projects: { id: string; clips: number }[] }>(
    page,
    'workspace',
    { action: 'list_projects' },
  );
  expect(listed.projects).toEqual([expect.objectContaining({ id, clips: 1 })]);
  await page.goto(`${base}#/projects`);
  await workspaceReady(page);
  await expect(
    page.getByRole('button', { name: /^Agent started this cut/ }),
  ).toBeVisible();
  await call(page, 'workspace', { action: 'open_project', projectId: id });
  await projectReady(page, id);
  expect(
    (await call<Inspection>(page, 'inspect_project')).project.revision,
  ).toBe(1);
  return { id, fixture };
}
type Inspection = {
  project: Project;
  assets: Asset[];
  library: { revision: number };
  readOnly: boolean;
  selectedClipIds: string[];
  playheadUs: number;
};
async function seed(page: Page, base: string) {
  return page.evaluate(async (base) => {
    const { createEditor } = (await import(
      base + 'editor.js'
    )) as typeof import('../../src/editor');
    const editor = await createEditor();
    try {
      const p = await editor.projects.create('Viewed cut', {
        width: 128,
        height: 72,
      });
      await editor.commands.apply({
        projectId: p.id,
        expectedRevision: 0,
        requestId: 'seed',
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
                  durationUs: 1000000,
                  width: 128,
                  height: 72,
                  text: { text: 'Original title' },
                },
              ],
            },
          },
        ],
      });
      await editor.projects.versions.save(p.id);
      const other = await editor.projects.create('Other cut', {
        width: 128,
        height: 72,
      });
      return { id: p.id, otherId: other.id };
    } finally {
      await editor.dispose();
    }
  }, base);
}
async function persisted(page: Page, base: string, id: string) {
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

for (const base of behaviorBases) {
  test(`workspace WebMCP creates, imports files and edits from an empty workspace @journey ${base}`, async ({
    page,
  }) => {
    await installHarness(page);
    await page.goto(base);
    const { id, fixture } = await projectSetupJourney(page, base);
    // A file chooser is a separate browser step. Retire its captured project
    // before selection and prove the original request cannot target the new one.
    const picker = page.waitForEvent('filechooser');
    await call(page, 'workspace', {
      action: 'import_files',
      expectedProjectId: id,
    });
    const chooser = await picker;
    const other = await call<{ project: Project }>(page, 'workspace', {
      action: 'create_project',
      name: 'Another project',
    });
    await projectReady(page, other.project.id);
    await chooser.setFiles({ ...fixture, name: 'stale-selection.png' });
    await expect(
      page.getByText(
        'Project changed. Review the latest values and try again.',
        { exact: true },
      ),
    ).toBeVisible();
    expect((await call<Inspection>(page, 'inspect_project')).assets).toEqual(
      [],
    );
  });

  test(`workspace WebMCP full edits, history, version and navigation ownership @journey ${base}`, async ({
    page,
  }) => {
    await installHarness(page);
    const providerRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('openrouter.ai'))
        providerRequests.push(request.url());
    });
    await page.goto(base);
    await workspaceReady(page);
    expect(
      await page.evaluate(async () =>
        (
          await (
            document as Document & { modelContext: ToolContext }
          ).modelContext.getTools()
        ).map((tool) => tool.name),
      ),
    ).toEqual(['localcut_workspace']);
    expect(
      await page.evaluate(async () =>
        (await indexedDB.databases()).filter((db) =>
          db.name?.startsWith('localcut'),
        ),
      ),
    ).toHaveLength(0);
    const { id, otherId } = await seed(page, base);
    await page.goto(`${base}#/project/${id}`);
    await ready(page);
    const initial = await call<Inspection>(page, 'inspect_project');
    expect(initial.project.id).toBe(id);
    expect(initial.project.revision).toBe(1);
    const batch = {
      projectId: id,
      expectedRevision: 1,
      requestId: 'agent-edit',
      operations: [
        { type: 'renameProject', name: 'Agent cut' },
        {
          type: 'updateClip',
          clipId: 'title',
          patch: {
            text: { text: 'Agent title', color: '#ff0000', fontSize: 18 },
            opacity: 0.8,
          },
        },
        { type: 'setStoryboardBackground', backgroundColor: '#123456' },
      ],
    };
    expect(await call(page, 'validate_edits', batch)).not.toHaveProperty(
      'isError',
    );
    const receipt = await call<EditReceipt>(page, 'apply_edits', batch);
    expect(receipt.appliedRevision).toBe(2);
    expect(await call(page, 'apply_edits', batch)).toEqual(receipt);
    await expect(page.locator('[data-clip-id="title"]')).toContainText(
      'Agent title',
    );
    expect((await persisted(page, base, id)).storyboard?.backgroundColor).toBe(
      '#123456',
    );
    expect(
      await call(page, 'apply_edits', { ...batch, requestId: 'stale' }),
    ).toMatchObject({ isError: true, error: { code: 'REVISION_CONFLICT' } });
    expect(
      await call(page, 'apply_edits', {
        ...batch,
        expectedRevision: 2,
        operations: [{ type: 'not-a-command' }],
      }),
    ).toMatchObject({ isError: true });
    await call(page, 'history', {
      projectId: id,
      action: 'undo',
      expectedRevision: 2,
      requestId: 'undo',
    });
    expect(
      (await persisted(page, base, id)).tracks[0]!.clips[0]!.text!.text,
    ).toBe('Original title');
    await call(page, 'history', {
      projectId: id,
      action: 'redo',
      expectedRevision: 3,
      requestId: 'redo',
    });
    await call(page, 'view', {
      projectId: id,
      action: 'select',
      clipIds: ['title'],
    });
    await call(page, 'view', { projectId: id, action: 'seek', timeUs: 200000 });
    await expect
      .poll(
        async () =>
          (await call<Inspection>(page, 'inspect_project')).selectedClipIds,
      )
      .toEqual(['title']);
    expect((await call<Inspection>(page, 'inspect_project')).playheadUs).toBe(
      200000,
    );
    const versions = await call<ProjectVersionInfo[]>(page, 'versions', {
      projectId: id,
      action: 'save',
    });
    expect(versions.length).toBeGreaterThan(1);
    let historicalNumber = 0;
    for (const version of versions) {
      const snapshot = await call<{ project: Project }>(page, 'versions', {
        projectId: id,
        action: 'read',
        versionId: version.id,
      });
      if (snapshot.project.revision === 1) historicalNumber = version.number;
    }
    expect(historicalNumber).toBeGreaterThan(0);
    await openVersions(page);
    await page
      .getByRole('button', {
        name: new RegExp(`^Version ${historicalNumber} ·`),
      })
      .click();
    await expect(async () => {
      expect((await call<Inspection>(page, 'inspect_project')).readOnly).toBe(
        true,
      );
    }).toPass();
    expect(
      (await call<Inspection>(page, 'inspect_project')).project.tracks[0]!
        .clips[0]!.text!.text,
    ).toBe('Original title');
    expect(
      await call(page, 'apply_edits', {
        ...batch,
        expectedRevision: 4,
        requestId: 'historical',
      }),
    ).toMatchObject({ isError: true });
    await page
      .getByRole('button', { name: 'Return to current', exact: true })
      .click();
    await expect(async () => {
      expect((await call<Inspection>(page, 'inspect_project')).readOnly).toBe(
        false,
      );
    }).toPass();
    // Capture a retired callback, then invoke it before React handles the URL.
    const retired = await page.evaluate(
      async ({ otherId }) => {
        const context = (document as Document & { modelContext: ToolContext })
          .modelContext;
        const tool = (await context.getTools()).find(
          (tool) => tool.name === 'localcut_apply_edits',
        )!;
        location.hash = `#/project/${otherId}`;
        return tool.execute({}, { signal: new AbortController().signal });
      },
      { otherId },
    );
    expect(retired).toMatchObject({ isError: true });
    await expect
      .poll(async () => {
        try {
          return (await call<Inspection>(page, 'inspect_project')).project?.id;
        } catch {
          return null;
        }
      })
      .toBe(otherId);
    expect(
      await call(page, 'apply_edits', {
        ...batch,
        expectedRevision: 4,
        requestId: 'wrong-cut',
      }),
    ).toMatchObject({ isError: true });
    expect((await persisted(page, base, id)).revision).toBe(4);
    expect((await persisted(page, base, otherId)).revision).toBe(0);
    await page.goto(`${base}#/project/${id}`);
    await ready(page);
    await page.reload();
    await ready(page);
    expect(
      (await call<Inspection>(page, 'inspect_project')).project.revision,
    ).toBe(4);
    expect(providerRequests).toHaveLength(0);
  });

  test(`workspace WebMCP imports Media and renders native preview/export @journey ${base}`, async ({
    page,
  }) => {
    await installHarness(page);
    await page.goto(base);
    const { id } = await seed(page, base);
    await page.goto(`${base}#/project/${id}`);
    await ready(page);
    const base64 = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 72;
      const c = canvas.getContext('2d')!;
      c.fillStyle = '#ff0000';
      c.fillRect(0, 0, 128, 72);
      return canvas.toDataURL('image/png').split(',')[1]!;
    });
    const imported = await call<{ jobId: string }>(page, 'import_media', {
      projectId: id,
      name: 'red.png',
      mimeType: 'image/png',
      base64,
    });
    const completed = await call<{ state: string; result: { asset: Asset } }>(
      page,
      'job',
      { projectId: id, jobId: imported.jobId, action: 'wait' },
    );
    expect(completed.state).toBe('completed');
    const asset = completed.result.asset;
    expect(
      (await call<Inspection>(page, 'inspect_project')).assets.some(
        (item) => item.id === asset.id,
      ),
    ).toBe(true);
    await call(page, 'apply_edits', {
      projectId: id,
      expectedRevision: 1,
      requestId: 'place-image',
      operations: [
        {
          type: 'insertClip',
          trackId: 'v',
          clip: {
            id: 'red',
            kind: 'image',
            assetId: asset.id,
            startUs: 1000000,
            durationUs: 1000000,
            width: 128,
            height: 72,
          },
        },
      ],
    });
    const frame = await call<{ jobId: string }>(page, 'preview_frame', {
      projectId: id,
      timeUs: 1500000,
      width: 128,
      height: 72,
    });
    const frameResult = await call<{ state: string; result: { url: string } }>(
      page,
      'job',
      { projectId: id, jobId: frame.jobId, action: 'wait' },
    );
    expect(frameResult.state).toBe('completed');
    const color = await page.evaluate(async (url) => {
      const image = await createImageBitmap(await (await fetch(url)).blob());
      try {
        const canvas = new OffscreenCanvas(128, 72);
        const c = canvas.getContext('2d')!;
        c.drawImage(image, 0, 0);
        return [...c.getImageData(64, 36, 1, 1).data];
      } finally {
        image.close();
      }
    }, frameResult.result.url);
    expect(color).toEqual([255, 0, 0, 255]);
    const exported = await call<{ jobId: string }>(page, 'export_video', {
      projectId: id,
      expectedRevision: 2,
      format: 'mp4',
    });
    const output = await call<{
      state: string;
      result: { url: string; size: number; revision: number };
    }>(page, 'job', { projectId: id, jobId: exported.jobId, action: 'wait' });
    expect(output.state).toBe('completed');
    expect(output.result.revision).toBe(2);
    expect(output.result.size).toBeGreaterThan(100);
    const native = await page.evaluate(async (url) => {
      const video = document.createElement('video');
      video.muted = true;
      video.src = url;
      try {
        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => resolve();
          video.onerror = () => reject(new Error('Native video decode failed'));
        });
        video.currentTime = 1.5;
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve();
        });
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d')!;
        context.drawImage(video, 0, 0);
        return {
          duration: video.duration,
          width: video.videoWidth,
          pixel: [...context.getImageData(64, 36, 1, 1).data],
        };
      } finally {
        video.removeAttribute('src');
        video.load();
      }
    }, output.result.url);
    expect(native.duration).toBeCloseTo(2, 1);
    expect(native.width).toBe(128);
    expect(native.pixel[0]).toBeGreaterThan(230);
    expect(native.pixel[1]).toBeLessThan(20);
    await call(page, 'job', {
      projectId: id,
      jobId: exported.jobId,
      action: 'release',
    });
    expect(
      await page.evaluate(async (url) => {
        try {
          await fetch(url);
          return false;
        } catch {
          return true;
        }
      }, output.result.url),
    ).toBe(true);
    expect(
      await call(page, 'job', {
        projectId: id,
        jobId: 'foreign-job',
        action: 'status',
      }),
    ).toMatchObject({ isError: true });
    const relinked = await call<{ jobId: string }>(page, 'import_media', {
      projectId: id,
      name: 'red-relinked.png',
      mimeType: 'image/png',
      base64,
      relinkAssetId: asset.id,
    });
    const relinkResult = await call<{
      state: string;
      result: { asset: Asset };
    }>(page, 'job', { projectId: id, jobId: relinked.jobId, action: 'wait' });
    expect(relinkResult).toMatchObject({
      state: 'failed',
      error: {
        code: 'INVALID_COMMAND',
        message: 'Ready originals cannot be replaced',
      },
    });
    // Simulate eviction of only this isolated test context's synthetic original.
    await page.evaluate(async (assetId) => {
      const root = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle('localcut');
      await root.removeEntry(assetId);
    }, asset.id);
    const restored = await call<{ jobId: string }>(page, 'import_media', {
      projectId: id,
      name: 'red.png',
      mimeType: 'image/png',
      base64,
      relinkAssetId: asset.id,
    });
    const restoredResult = await call<{
      state: string;
      result: { asset: Asset };
    }>(page, 'job', { projectId: id, jobId: restored.jobId, action: 'wait' });
    expect(restoredResult.state).toBe('completed');
    expect(restoredResult.result.asset.id).toBe(asset.id);
    expect(
      (await persisted(page, base, id)).tracks[0]!.clips.find(
        (clip) => clip.id === 'red',
      )!.assetId,
    ).toBe(asset.id);
  });

  test(`workspace WebMCP queued export keeps its requested revision ${base}`, async ({
    page,
  }) => {
    await installHarness(page);
    await page.goto(base);
    const { id } = await seed(page, base);
    await page.goto(`${base}#/project/${id}`);
    await ready(page);
    await page.evaluate(async (base) => {
      const { createEditor, freshTask } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const running = new Promise<void>((resolve) => {
        entered = resolve;
      });
      editor.tasks.register('test.webmcp.export-gate', {
        cache: freshTask('Deterministic queued-export fixture.'),
        lane: 'export',
        recovery: 'manual',
        execute: async () => {
          entered();
          await gate;
          return null;
        },
      });
      const blocker = editor.tasks.enqueue(
        'test.webmcp.export-gate',
        {},
        { label: 'Queued export test barrier' },
      );
      (
        window as Window & {
          exportGate?: { release(): void; dispose(): Promise<void> };
        }
      ).exportGate = {
        release,
        dispose: async () => {
          release();
          await blocker.completion;
          await editor.dispose();
        },
      };
      await running;
    }, base);
    try {
      const queued = await call<{ jobId: string }>(page, 'export_video', {
        projectId: id,
        expectedRevision: 1,
        format: 'mp4',
      });
      expect(
        await call(page, 'apply_edits', {
          projectId: id,
          expectedRevision: 1,
          requestId: 'edit-before-export',
          operations: [{ type: 'renameProject', name: 'Newer revision' }],
        }),
      ).toMatchObject({ appliedRevision: 2 });
      await page.evaluate(() =>
        (
          window as Window & { exportGate?: { release(): void } }
        ).exportGate!.release(),
      );
      expect(
        await call(page, 'job', {
          projectId: id,
          jobId: queued.jobId,
          action: 'wait',
        }),
      ).toMatchObject({
        state: 'failed',
        error: { code: 'REVISION_CONFLICT' },
      });
      expect((await persisted(page, base, id)).revision).toBe(2);
    } finally {
      await page.evaluate(async () => {
        const state = window as Window & {
          exportGate?: { dispose(): Promise<void> };
        };
        await state.exportGate?.dispose();
        delete state.exportGate;
      });
    }
  });

  test(`workspace WebMCP unsupported browser keeps ordinary editing @journey ${base}`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(document, 'modelContext', {
        configurable: true,
        value: undefined,
      });
    });
    await page.goto(base);
    const { id } = await seed(page, base);
    await page.goto(`${base}#/project/${id}`);
    await expect(page.locator('[data-clip-id="title"]')).toContainText(
      'Original title',
    );
    expect(
      await page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .some((entry) => /\/register-[^/]+\.js/.test(entry.name)),
      ),
    ).toBe(false);
    expect((await persisted(page, base, id)).revision).toBe(1);
  });

  test(`workspace WebMCP native browser discovery ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const supported = await page.evaluate(
      () =>
        typeof (
          document as Document & { modelContext?: { registerTool?: unknown } }
        ).modelContext?.registerTool === 'function',
    );
    test.skip(
      !supported,
      'This Chrome invocation does not expose WebMCP. Controlled registration journeys remain separate.',
    );
    const { id } = await projectSetupJourney(page, base);
    expect((await persisted(page, base, id)).name).toBe(
      'Agent started this cut',
    );
  });
}
