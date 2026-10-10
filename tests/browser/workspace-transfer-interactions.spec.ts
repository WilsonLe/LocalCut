import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { newProject } from '../../src/core/model';
import { defaultWorkspacePreferences } from '../../src/workspace/preferences';
import { defaultAppearance } from '../../src/workspace/appearance';
async function openTransfer(page: Page, scope: string, action: string) {
  await page
    .getByRole('button', { name: 'Workspace settings', exact: true })
    .click();
  await page.getByRole('menuitem', { name: scope, exact: true }).click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: action, exact: true }),
  ).toBeVisible();
}
for (const base of ['/', '/LocalCut/']) {
  test(`project asset checkboxes control ZIP export and import and preserve the active project ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const e = await createEditor();
      try {
        const p = await e.projects.create('Asset project', {
          width: 64,
          height: 64,
        });
        const ids: string[] = [];
        for (const color of ['red', 'blue']) {
          const canvas = new OffscreenCanvas(64, 64);
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 64, 64);
          const a = await e.assets.import(
            await canvas.convertToBlob({ type: 'image/png' }),
            color + '.png',
          ).completion;
          ids.push(a.id);
        }
        await e.commands.apply({
          projectId: p.id,
          expectedRevision: 0,
          requestId: 'assets',
          operations: [
            { type: 'addTrack', track: { id: 'track', kind: 'video' } },
            ...ids.map((id, i) => ({
              type: 'insertClip' as const,
              trackId: 'track',
              clip: {
                id: 'clip' + i,
                kind: 'image' as const,
                assetId: id,
                startUs: i * 1000000,
                durationUs: 1000000,
                width: 64,
                height: 64,
              },
            })),
          ],
        });
        await e.projects.create('Unselected project');
      } finally {
        await e.dispose();
      }
    }, base);
    await page
      .getByRole('button', { name: 'Open project', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: 'Open project' })
      .getByRole('button', { name: /^Asset project/ })
      .click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await openTransfer(page, 'Project', 'Export project');
    const dialog = page.getByRole('dialog', { name: 'Export project' });
    await dialog
      .getByRole('checkbox', { name: /Bundle original assets/ })
      .check();
    await dialog.getByRole('checkbox', { name: /blue.png/ }).uncheck();
    await mkdir('.artifacts', { recursive: true });
    await dialog.screenshot({ path: '.artifacts/project-export-dialog.png' });
    const pending = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download backup' }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe('localcut-project.zip');
    const bytes = await readFile((await download.path())!);
    const zip = unzipSync(bytes);
    const backup = JSON.parse(strFromU8(zip['workspace.json']!));
    expect(backup.files).toHaveLength(1);
    expect(backup.assets).toHaveLength(2);
    expect(
      backup.assets.find(
        (a: { id: string }) => a.id === backup.files[0].assetId,
      ).name,
    ).toBe('red.png');
    await openTransfer(page, 'Project', 'Import project');
    await page.getByLabel('Workspace backup file').setInputFiles({
      name: 'project.zip',
      mimeType: 'application/zip',
      buffer: bytes,
    });
    const imported = page.getByRole('dialog', { name: 'Import project' });
    await expect(
      imported.getByRole('checkbox', { name: /red.png/ }),
    ).toBeChecked();
    await imported.getByRole('checkbox', { name: /red.png/ }).uncheck();
    await page.setViewportSize({ width: 390, height: 844 });
    await imported.screenshot({ path: '.artifacts/project-import-narrow.png' });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await imported.getByRole('button', { name: 'Import selected' }).click();
    await expect(imported).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Open project', exact: true }),
    ).toContainText('Asset project');
    const copies = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const e = await createEditor();
      try {
        return await Promise.all(
          (await e.projects.list()).map(async (p) =>
            JSON.parse(await e.projects.exportJSON(p.id)),
          ),
        );
      } finally {
        await e.dispose();
      }
    }, base);
    const projects = copies.filter((p) => p.project.name === 'Asset project');
    expect(projects).toHaveLength(2);
    expect(
      projects
        .find((p) => p.project.revision === 0)
        .assets.every((a: { status: string }) => a.status === 'missing'),
    ).toBe(true);
    expect(
      projects
        .find((p) => p.project.revision === 1)
        .assets.every((a: { status: string }) => a.status === 'ready'),
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await openTransfer(page, 'Workspace', 'Export workspace');
    const workspace = page.getByRole('dialog', { name: 'Export workspace' });
    await expect(
      workspace.getByRole('checkbox', {
        name: 'Unselected project',
        exact: true,
      }),
    ).toBeChecked();
    await workspace.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(
      workspace.getByRole('button', { name: 'Download backup' }),
    ).toBeEnabled();
    await workspace
      .getByRole('button', { name: 'Close', exact: true })
      .first()
      .click();
  });
  test(`workspace import rejects unsafe settings then retries partial settings without duplicate projects ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    await openTransfer(page, 'Workspace', 'Import workspace');
    const backup = {
      format: 'localcut-workspace',
      workspaceVersion: 1,
      createdAt: 0,
      projects: [
        { project: newProject('Imported once'), versions: [] },
        { project: newProject('Excluded'), versions: [] },
      ],
      assets: [],
      transcripts: [],
      files: [],
      settings: {
        appearance: { ...defaultAppearance, theme: 'blue' },
        workspace: { ...defaultWorkspacePreferences, chatWidth: 480 },
      },
    };
    const unsafe = structuredClone(backup);
    Object.assign(unsafe.settings.workspace, {
      apiKey: 'synthetic-do-not-hydrate',
    });
    await page.getByLabel('Workspace backup file').setInputFiles({
      name: 'unsafe.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(unsafe)),
    });
    await expect(page.getByRole('alert')).toContainText(
      'Invalid workspace settings',
    );
    expect(
      await page.evaluate(async () => (await indexedDB.databases()).length),
    ).toBe(0);
    await page.getByLabel('Workspace backup file').setInputFiles({
      name: 'valid.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    const dialog = page.getByRole('dialog', { name: 'Import workspace' });
    await dialog
      .getByRole('checkbox', { name: 'Excluded', exact: true })
      .uncheck();
    await page.evaluate(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'localcut.workspace-preferences.v1')
          throw new DOMException('Denied', 'QuotaExceededError');
        return set.call(this, key, value);
      };
      Object.assign(window, {
        restoreStorage: () => {
          Storage.prototype.setItem = set;
        },
      });
    });
    await dialog.getByRole('button', { name: 'Import selected' }).click();
    await expect(dialog.getByRole('alert')).toContainText(
      '1 project copies saved',
    );
    await expect(
      dialog.getByRole('checkbox', { name: 'Imported once', exact: true }),
    ).not.toBeChecked();
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('localcut.appearance.v1')!)
            .preferences.theme,
      ),
    ).toBe('blue');
    await page.evaluate(() => {
      (window as unknown as { restoreStorage: () => void }).restoreStorage();
    });
    await dialog.getByRole('button', { name: 'Import selected' }).click();
    await expect(dialog).not.toBeVisible();
    const state = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const e = await createEditor();
      try {
        return {
          names: (await e.projects.list()).map((p) => p.name),
          width: JSON.parse(
            localStorage.getItem('localcut.workspace-preferences.v1')!,
          ).preferences.chatWidth,
        };
      } finally {
        await e.dispose();
      }
    }, base);
    expect(state).toEqual({ names: ['Imported once'], width: 480 });
  });
  test(`workspace source transcripts remap to their imported source ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const result = await page.evaluate(async (base) => {
      const { createEditor, readWorkspaceArchive } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const sourceNs = 'test-' + crypto.randomUUID();
      const source = await createEditor({ namespace: sourceNs });
      const target = await createEditor({
        namespace: 'test-' + crypto.randomUUID(),
      });
      try {
        const data = new ArrayBuffer(44 + 48000 * 2);
        const v = new DataView(data);
        const ascii = (at: number, t: string) =>
          [...t].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
        ascii(0, 'RIFF');
        v.setUint32(4, data.byteLength - 8, true);
        ascii(8, 'WAVEfmt ');
        v.setUint32(16, 16, true);
        v.setUint16(20, 1, true);
        v.setUint16(22, 1, true);
        v.setUint32(24, 48000, true);
        v.setUint32(28, 96000, true);
        v.setUint16(32, 2, true);
        v.setUint16(34, 16, true);
        ascii(36, 'data');
        v.setUint32(40, 96000, true);
        const asset = await source.assets.import(
          new Blob([data], { type: 'audio/wav' }),
          'silence.wav',
        ).completion;
        const p = await source.projects.create('Transcript project');
        // Seed a saved source transcript fixture; inference has its own real acceptance gate.
        await new Promise<void>((resolve, reject) => {
          const open = indexedDB.open(sourceNs + '-v1');
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction('transcripts', 'readwrite');
            tx.objectStore('transcripts').put({
              id: 'transcript',
              assetId: asset.id,
              model: 'fixture',
              revision: 'fixture',
              cues: [
                { id: 'cue', timeUs: 0, endUs: 1000000, text: 'Saved text' },
              ],
            });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
          open.onerror = () => reject(open.error);
        });
        await source.commands.apply({
          projectId: p.id,
          expectedRevision: 0,
          requestId: 'transcript-link',
          operations: [
            { type: 'addTrack', track: { id: 'audio', kind: 'audio' } },
            {
              type: 'insertClip',
              trackId: 'audio',
              clip: {
                id: 'clip',
                kind: 'audio',
                assetId: asset.id,
                transcriptId: 'transcript',
                startUs: 0,
                durationUs: 1000000,
                sourceOutUs: 1000000,
              },
            },
          ],
        });
        const file = await source.workspace.export({
          projectIds: [p.id],
          includeVersions: true,
          assetIds: [asset.id],
        }).completion;
        const archive = await readWorkspaceArchive(file);
        const copies = await target.workspace.import(archive, {
          projectIds: [p.id],
          includeVersions: true,
          assetIds: [asset.id],
        }).completion;
        const backup = JSON.parse(
          await target.projects.exportJSON(copies[0]!.id),
        );
        return {
          transcript: backup.transcripts[0],
          asset: backup.assets[0],
          clip: backup.project.tracks[0].clips[0],
        };
      } finally {
        await source.dispose();
        await target.dispose();
      }
    }, base);
    expect(result.transcript.id).not.toBe('transcript');
    expect(result.transcript.assetId).toBe(result.asset.id);
    expect(result.clip.transcriptId).toBe(result.transcript.id);
    expect(result.transcript.cues[0].text).toBe('Saved text');
    expect(result.asset.status).toBe('ready');
  });
}
