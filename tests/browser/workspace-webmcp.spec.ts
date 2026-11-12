import { navigateWorkspace } from './workspace-project-helper';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import type {
  Project,
  EditReceipt,
  Asset,
  ProjectVersionInfo,
} from '../../src/editor';
import { behaviorBases } from './coverage-bases';
import { openVersions } from './workspace-settings-helper';

import {
  installHarness,
  call,
  ready,
  workspaceReady,
  projectReady,
  type ToolContext,
} from './webmcp-helper';

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
  return { id, fixture, assetId: imported.assets[0]!.id };
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
  test(`workspace WebMCP skills publish identical portable guidance without editor startup @journey ${base}`, async ({
    page,
  }) => {
    await installHarness(page);
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.goto(base);
    await workspaceReady(page);
    expect(requests.filter((url) => url.includes('/skills/'))).toEqual([]);
    type Catalog = {
      version: number;
      skills: {
        name: string;
        description: string;
        sha256: string;
        url: string;
        licenseUrl: string;
      }[];
    };
    const catalog = await call<Catalog>(page, 'skills', { action: 'list' });
    expect(catalog.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'localcut-indexing',
          description: expect.stringMatching(/index.*source-timed Transcript/),
        }),
      ]),
    );
    expect(requests.filter((url) => url.endsWith('/SKILL.md'))).toEqual([]);
    const sourceDirectory = new URL('../../public/skills/', import.meta.url);
    const publishedIndex = JSON.parse(
      await readFile(new URL('index.json', sourceDirectory), 'utf8'),
    );
    expect(
      catalog.skills.map(({ name, description, sha256 }) => ({
        name,
        description,
        sha256,
      })),
    ).toEqual(publishedIndex.skills);
    for (const skill of catalog.skills) {
      const result = await call<{ content: string; url: string }>(
        page,
        'skills',
        { action: 'get', name: skill.name },
      );
      expect(result.content).toBe(
        await readFile(
          new URL(`${skill.name}/SKILL.md`, sourceDirectory),
          'utf8',
        ),
      );
      expect(result.url).toBe(
        new URL(`${base}skills/${skill.name}/SKILL.md`, page.url()).href,
      );
      expect((await page.request.get(skill.licenseUrl)).ok()).toBe(true);
    }
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
    expect(
      requests.some((url) =>
        /\/assets\/(editor|worker)-|huggingface|onnxruntime|openrouter/.test(
          url,
        ),
      ),
    ).toBe(false);
    // Check the second hosting path's static publication without repeating a UI journey.
    const rootIndex = await page.request.get(
      new URL('/skills/index.json', page.url()).href,
    );
    expect(await rootIndex.json()).toEqual(publishedIndex);
    const rootSkill = await page.request.get(
      new URL('/skills/localcut-start/SKILL.md', page.url()).href,
    );
    expect(await rootSkill.text()).toBe(
      await readFile(
        new URL('localcut-start/SKILL.md', sourceDirectory),
        'utf8',
      ),
    );
    await page.goto(`${base}#/projects`);
    await workspaceReady(page);
    await expect(
      page.getByRole('heading', { name: 'No saved projects yet', exact: true }),
    ).toBeVisible();
    const catalogDatabases = await page.evaluate(() => indexedDB.databases());
    expect(
      await call(page, 'skills', { action: 'get', name: 'localcut-start' }),
    ).toHaveProperty('content');
    await page.reload();
    await workspaceReady(page);
    expect(await call(page, 'skills', { action: 'list' })).toMatchObject({
      skills: catalog.skills,
    });
    expect(await page.evaluate(() => indexedDB.databases())).toEqual(
      catalogDatabases,
    );
  });

  test(`workspace WebMCP creates, imports files, edits source clips and edits from an empty workspace @journey ${base}`, async ({
    page,
  }) => {
    await installHarness(page);
    page.setDefaultTimeout(15000);
    await page.goto(base);
    const { id, fixture, assetId } = await projectSetupJourney(page, base);
    const text = {
      context: 'Opening shot\nKeep the original crop.',
      transcript: 'Hello LocalCut.\nThis is the opening scene.',
    };
    const openClips = async () => {
      if (
        (await page
          .locator('#workspace-media-content')
          .getAttribute('aria-hidden')) === 'true'
      )
        await page
          .getByRole('button', { name: 'Expand media', exact: true })
          .click();
      await page
        .getByRole('button', {
          name: `Asset details for ${fixture.name}`,
          exact: true,
        })
        .hover();
      await page
        .getByRole('button', {
          name: `Actions for ${fixture.name}`,
          exact: true,
        })
        .click();
      await page.getByRole('menuitem', { name: 'Clips', exact: true }).click();
    };
    const inspectAsset = () =>
      call<Asset>(page, 'asset', { action: 'inspect', projectId: id, assetId });
    await openClips();
    const dialog = page.getByRole('dialog', {
      name: fixture.name,
      exact: true,
    });
    await dialog
      .getByRole('textbox', { name: 'Clip name', exact: true })
      .fill('Opening');
    await dialog.getByRole('tab', { name: 'Context', exact: true }).click();
    await dialog
      .getByRole('textbox', { name: 'Context', exact: true })
      .fill(text.context);
    await dialog.getByRole('tab', { name: 'Transcript', exact: true }).click();
    await dialog
      .getByRole('textbox', { name: 'Transcript', exact: true })
      .fill(text.transcript);
    await expect(dialog.getByRole('img', { name: fixture.name })).toBeVisible();
    await dialog.getByRole('button', { name: 'Add clip', exact: true }).click();
    await dialog
      .getByRole('textbox', { name: 'Clip name', exact: true })
      .fill('Detail');
    await dialog.getByRole('tab', { name: 'Context', exact: true }).click();
    await dialog
      .getByRole('textbox', { name: 'Context', exact: true })
      .fill('Closer view');
    await dialog.getByRole('tab', { name: 'Transcript', exact: true }).click();
    await dialog
      .getByRole('textbox', { name: 'Transcript', exact: true })
      .fill('Second section');
    await dialog.getByRole('option', { name: 'Opening', exact: true }).click();
    await dialog.getByRole('tab', { name: 'Context', exact: true }).click();
    await expect(
      dialog.getByRole('textbox', { name: 'Context', exact: true }),
    ).toHaveValue(text.context);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: 'Save', exact: true }),
    ).toHaveCount(0);
    const saved = await inspectAsset();
    expect(saved).toMatchObject({
      clipsRevision: 1,
      clips: [
        { ...text, name: 'Opening' },
        {
          name: 'Detail',
          context: 'Closer view',
          transcript: 'Second section',
        },
      ],
    });
    const preview = await call<{ jobId: string }>(page, 'asset', {
      action: 'preview_clip',
      projectId: id,
      assetId,
      clipId: saved.clips![0]!.id,
    });
    expect(
      await call(page, 'job', {
        action: 'wait',
        projectId: id,
        jobId: preview.jobId,
      }),
    ).toMatchObject({
      result: {
        assetId,
        kind: 'image',
        startUs: 0,
        endUs: 0,
        previewUrl: expect.stringContaining('#t=0,0'),
      },
    });
    await call(page, 'job', {
      action: 'release',
      projectId: id,
      jobId: preview.jobId,
    });
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page.reload();
    await projectReady(page, id);
    await openClips();
    await dialog.getByRole('tab', { name: 'Context', exact: true }).click();
    await expect(
      dialog.getByRole('textbox', { name: 'Context', exact: true }),
    ).toHaveValue(text.context);
    await expect(dialog.getByRole('option')).toHaveCount(2);
    await dialog.getByRole('tab', { name: 'Context', exact: true }).click();
    await dialog
      .getByRole('textbox', { name: 'Context', exact: true })
      .fill('Unsaved draft');
    const updated = saved.clips!.map((clip, index) =>
      index ? clip : { ...clip, context: 'Agent attached this context.' },
    );
    expect(
      await call(page, 'asset', {
        action: 'update_clips',
        projectId: id,
        assetId,
        clips: updated,
        expectedClipsRevision: 1,
      }),
    ).toMatchObject({ clipsRevision: 2 });
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('changed');
    await dialog.getByRole('tab', { name: 'Context', exact: true }).click();
    await expect(
      dialog.getByRole('textbox', { name: 'Context', exact: true }),
    ).toHaveValue('Unsaved draft');
    await dialog
      .getByRole('button', { name: 'Discard draft and reload', exact: true })
      .click();
    await dialog.getByRole('tab', { name: 'Context', exact: true }).click();
    await expect(
      dialog.getByRole('textbox', { name: 'Context', exact: true }),
    ).toHaveValue(updated[0]!.context);
    await page.screenshot({ path: '.artifacts/asset-clips-desktop.png' });
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#mobile-media-trigger').click();
    await openClips();
    await dialog.getByRole('option', { name: 'Detail', exact: true }).click();
    await dialog.getByRole('tab', { name: 'Transcript', exact: true }).click();
    await expect(
      dialog.getByText('Second section', { exact: true }),
    ).toBeVisible();
    await expect(
      dialog
        .getByRole('region', { name: 'Transcript timeline', exact: true })
        .getByRole('textbox'),
    ).toHaveCount(0);
    await dialog
      .getByRole('button', { name: 'Edit transcript text 1', exact: true })
      .click();
    await expect(
      dialog.getByRole('textbox', { name: 'Transcript', exact: true }),
    ).toHaveValue('Second section');
    await dialog
      .getByRole('button', { name: 'Edit transcript timing 1', exact: true })
      .click();
    await expect(
      page.getByRole('spinbutton', {
        name: 'Transcript start 1 (s)',
        exact: true,
      }),
    ).toHaveValue('');
    expect(
      await page
        .getByRole('spinbutton', { name: 'Transcript end 1 (s)', exact: true })
        .evaluate(
          (element) => element.getBoundingClientRect().right <= innerWidth,
        ),
    ).toBe(true);
    await page
      .getByRole('spinbutton', { name: 'Transcript start 1 (s)', exact: true })
      .press('Escape');
    await dialog
      .getByRole('button', {
        name: 'Finish editing transcript text 1',
        exact: true,
      })
      .click();
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: '.artifacts/asset-clips-mobile.png' });
    await dialog
      .getByRole('button', { name: 'Remove clip', exact: true })
      .click();
    await expect(dialog.getByRole('option')).toHaveCount(1);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: 'Save', exact: true }),
    ).toHaveCount(0);
    expect((await inspectAsset()).clips).toHaveLength(1);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 800 });
    const versions = await call<ProjectVersionInfo[]>(page, 'versions', {
      projectId: id,
      action: 'save',
    });
    await openVersions(page);
    await page
      .getByRole('button', {
        name: new RegExp(
          `^Version ${versions.find((version) => version.revision === 1)!.number} ·`,
        ),
      })
      .click();
    await expect(async () => {
      expect((await call<Inspection>(page, 'inspect_project')).readOnly).toBe(
        true,
      );
    }).toPass();
    await openClips();
    await dialog.getByRole('tab', { name: 'Context', exact: true }).click();
    await expect(
      dialog.getByRole('textbox', { name: 'Context', exact: true }),
    ).not.toBeEditable();
    await expect(
      dialog.getByRole('button', { name: 'Save', exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole('button', { name: 'Add clip', exact: true }),
    ).toHaveCount(0);
    await dialog.getByRole('tab', { name: 'Transcript', exact: true }).click();
    await expect(
      dialog.getByText(text.transcript, { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', {
        name: /Edit transcript|Add transcript|Remove transcript/,
      }),
    ).toHaveCount(0);
    expect(
      await call(page, 'asset', {
        action: 'update_clips',
        projectId: id,
        assetId,
        clips: updated,
        expectedClipsRevision: 3,
      }),
    ).toMatchObject({ isError: true });
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page
      .getByRole('button', { name: 'Return to current', exact: true })
      .click();
    await expect(async () => {
      expect((await call<Inspection>(page, 'inspect_project')).readOnly).toBe(
        false,
      );
    }).toPass();
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
    expect(
      await call(page, 'workspace', {
        action: 'import_files',
        expectedProjectId: other.project.id,
      }),
    ).toMatchObject({
      isError: true,
      error: {
        code: 'INVALID_COMMAND',
        message:
          'Finish or cancel the pending file selection before requesting another import.',
      },
    });
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
    ).toEqual(['localcut_skills', 'localcut_workspace']);
    expect(
      await page.evaluate(async () =>
        (await indexedDB.databases()).filter((db) =>
          db.name?.startsWith('localcut'),
        ),
      ),
    ).toHaveLength(0);
    const { id, otherId } = await seed(page, base);
    await navigateWorkspace(page, `${base}workspace/${id}`);
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
      await call(page, 'skills', { action: 'get', name: 'localcut-start' }),
    ).toHaveProperty('content');
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
    await navigateWorkspace(page, `${base}workspace/${id}`);
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
    await navigateWorkspace(page, `${base}workspace/${id}`);
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
    await navigateWorkspace(page, `${base}workspace/${id}`);
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
    await navigateWorkspace(page, `${base}workspace/${id}`);
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
