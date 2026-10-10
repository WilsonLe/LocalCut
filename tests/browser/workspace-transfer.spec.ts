import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
async function transfer(
  page: Page,
  scope: 'Workspace' | 'Project',
  action: string,
) {
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
  test(`workspace archive roundtrips real originals, shared sources, historical versions and selective copies ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const result = await page.evaluate(async (base) => {
      const { createEditor, readWorkspaceArchive } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const source = await createEditor({
        namespace: 'test-' + crypto.randomUUID(),
      });
      const destination = await createEditor({
        namespace: 'test-' + crypto.randomUUID(),
      });
      try {
        const canvas = new OffscreenCanvas(64, 64);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(0, 0, 64, 64);
        const png = await canvas.convertToBlob({ type: 'image/png' });
        const a = await source.assets.import(png, 'red.png').completion;
        const first = await source.projects.create('First', {
          width: 64,
          height: 64,
        });
        const second = await source.projects.create('Second', {
          width: 64,
          height: 64,
        });
        for (const p of [first, second]) {
          await source.commands.apply({
            projectId: p.id,
            expectedRevision: 0,
            requestId: crypto.randomUUID(),
            operations: [
              { type: 'addTrack', track: { id: 'track', kind: 'video' } },
              {
                type: 'insertClip',
                trackId: 'track',
                clip: {
                  id: 'clip',
                  kind: 'image',
                  assetId: a.id,
                  startUs: 0,
                  durationUs: 1000000,
                  width: 64,
                  height: 64,
                },
              },
            ],
          });
          await source.projects.versions.save(p.id);
        }
        await source.commands.apply({
          projectId: first.id,
          expectedRevision: 1,
          requestId: 'remove-source',
          operations: [{ type: 'removeClip', clipId: 'clip' }],
        });
        await source.projects.versions.save(first.id);
        const history = await source.workspace.snapshot([first.id], true);
        const without = await source.workspace.snapshot([first.id], false);
        const zip = await source.workspace.export({
          projectIds: [first.id, second.id],
          includeVersions: true,
          assetIds: [a.id],
        }).completion;
        const archive = await readWorkspaceArchive(zip);
        const copies = await destination.workspace.import(archive, {
          projectIds: [first.id],
          includeVersions: true,
          assetIds: [a.id],
        }).completion;
        const metadata = await destination.projects.exportJSON(copies[0]!.id);
        const versionList = await destination.projects.versions.list(
          copies[0]!.id,
        );
        const sourceVersion = versionList.find((v) => v.number === 2)!;
        const historical = await destination.projects.versions.snapshot(
          copies[0]!.id,
          sourceVersion.id,
        );
        const mappedId = historical.project.tracks[0]!.clips[0]!.assetId!;
        const ready = await destination.assets.inspect(mappedId);
        const frame = await destination.preview.frame(
          copies[0]!.id,
          500000,
          undefined,
          sourceVersion.id,
        ).completion;
        const output = new OffscreenCanvas(64, 64);
        const out = output.getContext('2d')!;
        out.drawImage(frame.image, 0, 0);
        frame.image.close();
        const pixel = [...out.getImageData(32, 32, 1, 1).data];
        const omitted = await destination.workspace.import(archive, {
          projectIds: [second.id],
          includeVersions: false,
          assetIds: [],
        }).completion;
        const omittedBackup = JSON.parse(
          await destination.projects.exportJSON(omitted[0]!.id),
        );
        const cancelled = destination.workspace.import(archive, {
          projectIds: [second.id],
          includeVersions: true,
          assetIds: [a.id],
        });
        cancelled.cancel();
        const cancelledCode = await cancelled.completion.then(
          () => '',
          (e) => (e as { code: string }).code,
        );
        const cancelledStaging = destination.workspace.import(archive, {
          projectIds: [second.id],
          includeVersions: true,
          assetIds: [a.id],
        });
        const stopCancel = cancelledStaging.subscribe((event) => {
          if (event.stage === 'Restoring originals') cancelledStaging.cancel();
        });
        const stagedCode = await cancelledStaging.completion.then(
          () => '',
          (e) => (e as { code: string }).code,
        );
        stopCancel();
        const add = IDBObjectStore.prototype.add;
        IDBObjectStore.prototype.add = function (value, key) {
          if (this.name === 'assets')
            throw new DOMException(
              'Synthetic transaction quota failure',
              'QuotaExceededError',
            );
          return add.call(this, value, key);
        };
        let failedCommitCode = '';
        try {
          failedCommitCode = await destination.workspace
            .import(archive, {
              projectIds: [second.id],
              includeVersions: true,
              assetIds: [a.id],
            })
            .completion.then(
              () => '',
              (e) => (e as { code: string }).code,
            );
        } finally {
          IDBObjectStore.prototype.add = add;
        }
        const before = (await destination.projects.list()).length;
        const malformed = structuredClone(archive);
        malformed.backup.projects[1]!.project.width = -1;
        const invalidCode = await destination.workspace
          .import(malformed, {
            projectIds: [first.id],
            includeVersions: true,
            assetIds: [a.id],
          })
          .completion.then(
            () => '',
            (e) => (e as { code: string }).code,
          );
        const corrupt = structuredClone(archive);
        corrupt.files.set(a.id, new Blob(['bad']));
        const corruptCode = await destination.workspace
          .import(corrupt, {
            projectIds: [first.id],
            includeVersions: true,
            assetIds: [a.id],
          })
          .completion.then(
            () => '',
            (e) => (e as { code: string }).code,
          );
        return {
          historicalAssets: history.assets.length,
          currentAssets: without.assets.length,
          zipFiles: archive.backup.files.length,
          copies: copies.length,
          newId: copies[0]!.id !== first.id,
          revision: copies[0]!.revision,
          ready: ready.status,
          pixel,
          versionCount: versionList.length,
          metadataAssets: JSON.parse(metadata).assets.length,
          omittedStatus: omittedBackup.assets[0].status,
          omittedVersions: (
            await destination.projects.versions.list(omitted[0]!.id)
          ).length,
          cancelledCode,
          stagedCode,
          failedCommitCode,
          invalidCode,
          corruptCode,
          before,
          after: (await destination.projects.list()).length,
          sourceUnchanged: (await source.projects.snapshot(first.id)).revision,
        };
      } finally {
        await source.dispose();
        await destination.dispose();
      }
    }, base);
    expect(result).toMatchObject({
      historicalAssets: 1,
      currentAssets: 0,
      zipFiles: 1,
      copies: 1,
      newId: true,
      revision: 0,
      ready: 'ready',
      pixel: [255, 0, 0, 255],
      metadataAssets: 0,
      omittedStatus: 'missing',
      omittedVersions: 1,
      cancelledCode: 'CANCELLED',
      stagedCode: 'CANCELLED',
      failedCommitCode: 'QUOTA_EXCEEDED',
      invalidCode: 'INVALID_DOCUMENT',
      corruptCode: 'INVALID_DOCUMENT',
      before: 2,
      after: 2,
      sourceUnchanged: 2,
    });
    expect(result.versionCount).toBeGreaterThan(2);
  });
  test(`workspace transfer settings-only import stays inert and project export is scoped ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    await page.evaluate(() => localStorage.setItem('unrelated', 'keep'));
    await transfer(page, 'Workspace', 'Export workspace');
    const dialog = page.getByRole('dialog', {
      name: 'Export workspace',
      exact: true,
    });
    await expect(
      dialog.getByRole('checkbox', {
        name: 'Workspace preferences',
        exact: true,
      }),
    ).toBeChecked();
    await expect(
      dialog.getByRole('button', { name: 'Download backup' }),
    ).toBeEnabled();
    const downloadEvent = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download backup' }).click();
    const download = await downloadEvent;
    const bytes = await readFile((await download.path())!);
    const backup = JSON.parse(bytes.toString());
    expect(backup.settings.workspace.chatWidth).toBe(320);
    expect(backup.projects).toEqual([]);
    expect(bytes.toString()).not.toContain('unrelated');
    backup.settings.appearance.theme = 'blue';
    backup.settings.workspace.chatWidth = 450;
    await page.reload();
    const beforeImport = await page.evaluate(
      async () => (await indexedDB.databases()).length,
    );
    const importRequests: string[] = [];
    page.on('request', (r) => importRequests.push(r.url()));
    await transfer(page, 'Workspace', 'Import workspace');
    await page.getByLabel('Workspace backup file').setInputFiles({
      name: 'settings.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    const importing = page.getByRole('dialog', {
      name: 'Import workspace',
      exact: true,
    });
    await expect(
      importing.getByRole('checkbox', { name: 'Appearance', exact: true }),
    ).toBeChecked();
    await importing
      .getByRole('checkbox', { name: 'Appearance', exact: true })
      .uncheck();
    await importing.getByRole('button', { name: 'Import selected' }).click();
    await expect(importing).not.toBeVisible();
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('localcut.workspace-preferences.v1')!)
            .preferences.chatWidth,
      ),
    ).toBe(450);
    expect(
      await page.evaluate(() => localStorage.getItem('localcut.appearance.v1')),
    ).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('unrelated'))).toBe(
      'keep',
    );
    expect(
      await page.evaluate(async () => (await indexedDB.databases()).length),
    ).toBe(beforeImport);
    expect(importRequests.some((url) => /editor\.js|worker/.test(url))).toBe(
      false,
    );
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
    await page
      .getByRole('menuitem', { name: 'New project', exact: true })
      .click();
    await page.getByLabel('Project name').fill('Only this');
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const e = await createEditor();
      try {
        await e.projects.create('Closed project');
      } finally {
        await e.dispose();
      }
    }, base);
    await transfer(page, 'Project', 'Export project');
    const projectDialog = page.getByRole('dialog', {
      name: 'Export project',
      exact: true,
    });
    await expect(
      projectDialog.getByRole('checkbox', { name: 'Only this', exact: true }),
    ).toBeChecked();
    await expect(
      projectDialog.getByRole('checkbox', {
        name: 'Closed project',
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      projectDialog.getByRole('checkbox', { name: 'Appearance', exact: true }),
    ).toHaveCount(0);
    const projectDownloadEvent = page.waitForEvent('download');
    await projectDialog
      .getByRole('button', { name: 'Download backup' })
      .click();
    const projectDownload = await projectDownloadEvent;
    const projectBytes = await readFile((await projectDownload.path())!);
    const single = JSON.parse(projectBytes.toString());
    expect(single.projects).toHaveLength(1);
    expect(single.settings).toEqual({});
    await transfer(page, 'Project', 'Import project');
    await page.getByLabel('Workspace backup file').setInputFiles({
      name: 'project.json',
      mimeType: 'application/json',
      buffer: projectBytes,
    });
    await page
      .getByRole('dialog', { name: 'Import project' })
      .getByRole('button', { name: 'Import selected' })
      .click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    const names = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const e = await createEditor();
      try {
        return (await e.projects.list()).map((p) => p.name);
      } finally {
        await e.dispose();
      }
    }, base);
    expect(names.filter((n) => n === 'Only this')).toHaveLength(2);
    expect(names.filter((n) => n === 'Closed project')).toHaveLength(1);
  });
  test(`app manifest and all install icons resolve without eager storage ${base}`, async ({
    page,
    request,
  }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto(base);
    const href = await page
      .locator('link[rel="manifest"]')
      .getAttribute('href');
    expect(href).toBe(base + 'manifest.webmanifest');
    const response = await request.get(href!);
    expect(response.headers()['content-type']).toContain('manifest');
    const manifest = await response.json();
    expect(manifest).toMatchObject({
      id: './',
      start_url: './',
      scope: './',
      display: 'standalone',
      name: 'LocalCut',
    });
    for (const icon of manifest.icons) {
      const r = await request.get(base + icon.src);
      expect(r.ok()).toBe(true);
      expect(r.headers()['content-type']).toBe('image/png');
      const buffer = await r.body();
      const size = Number(icon.sizes.split('x')[0]);
      expect(buffer.readUInt32BE(16)).toBe(size);
      expect(buffer.readUInt32BE(20)).toBe(size);
    }
    for (const rel of ['icon', 'apple-touch-icon'])
      for (const path of await page
        .locator(`link[rel="${rel}"]`)
        .evaluateAll((links) =>
          links.map((l) => (l as HTMLLinkElement).getAttribute('href')!),
        )) {
        expect((await request.get(path)).ok()).toBe(true);
      }
    expect(requests.some((r) => /editor\.js|ai\.js|worker|onnx/.test(r))).toBe(
      false,
    );
    expect(
      await page.evaluate(async () => (await indexedDB.databases()).length),
    ).toBe(0);
  });
}
