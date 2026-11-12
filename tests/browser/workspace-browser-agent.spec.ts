import { test, expect, type Page } from '@playwright/test';
import type { SiteTool } from '../../src/workspace/webmcp/types';
import { behaviorBases } from './coverage-bases';

interface Harness {
  tools: Map<string, SiteTool>;
  fail: boolean;
  retired?: SiteTool;
}
function attachContext() {
  const harness: Harness = { tools: new Map(), fail: false };
  (window as unknown as Window & { agentTest: Harness }).agentTest = harness;
  Object.defineProperty(document, 'modelContext', {
    configurable: true,
    value: {
      async registerTool(tool: SiteTool, options: { signal: AbortSignal }) {
        if (options.signal.aborted) throw options.signal.reason;
        if (harness.fail && tool.name === 'localcut_workspace')
          throw new Error('Site tools denied by browser');
        if (harness.tools.has(tool.name)) throw new Error('Duplicate tool');
        harness.tools.set(tool.name, tool);
        options.signal.addEventListener(
          'abort',
          () => harness.tools.delete(tool.name),
          { once: true },
        );
      },
    },
  });
}
async function call<T>(page: Page, name: string, input: unknown): Promise<T> {
  return page.evaluate(
    async ({ name, input }) => {
      const tool = (
        window as unknown as Window & { agentTest: Harness }
      ).agentTest.tools.get(`localcut_${name}`);
      if (!tool) throw new Error(`Missing tool: ${name}`);
      const result = await tool.execute(input, {
        signal: new AbortController().signal,
      });
      return typeof result === 'string' ? JSON.parse(result) : result;
    },
    { name, input },
  ) as Promise<T>;
}
async function toolNames(page: Page) {
  return page.evaluate(() =>
    [
      ...(
        window as unknown as Window & { agentTest: Harness }
      ).agentTest.tools.keys(),
    ].sort(),
  );
}
async function openStatus(page: Page) {
  await page
    .getByRole('button', { name: 'Workspace settings', exact: true })
    .click();
  await page.getByRole('menuitem', { name: /^Browser agent/ }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Browser agent',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const base of behaviorBases) {
  test(`browser agent status recovers late API and denied registration without editor startup ${base}`, async ({
    page,
  }) => {
    await page.addInitScript(() =>
      Object.defineProperty(document, 'modelContext', {
        configurable: true,
        value: undefined,
      }),
    );
    await page.goto(base);
    const dialog = await openStatus(page);
    const refresh = dialog.getByRole('button', {
      name: 'Refresh browser agent tools',
      exact: true,
    });
    await expect(dialog.getByRole('status')).toHaveText(
      'Browser access unavailable',
    );
    await expect(
      dialog.getByText('No requests yet', { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText('Connect or reconnect', { exact: true }),
    ).toBeVisible();
    await refresh.click();
    await expect(dialog.getByRole('status')).toHaveText(
      'Browser access unavailable',
    );
    const inert = async () => {
      expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
      expect(
        await page.evaluate(() =>
          performance
            .getEntriesByType('resource')
            .some((entry) =>
              /\/assets\/(editor|worker)-|huggingface|onnxruntime/.test(
                entry.name,
              ),
            ),
        ),
      ).toBe(false);
    };
    await inert();
    await page.screenshot({ path: '.artifacts/browser-agent-unavailable.png' });
    await page.evaluate(attachContext);
    await refresh.click();
    await expect(dialog.getByRole('status')).toHaveText('Tools ready');
    await expect(
      dialog.getByText('2 tools available', { exact: true }),
    ).toBeVisible();
    expect(await toolNames(page)).toEqual([
      'localcut_skills',
      'localcut_workspace',
    ]);
    await inert();
    await call(page, 'skills', { action: 'list' });
    await expect(dialog.locator('time')).toHaveCount(1);
    const observed = await dialog.locator('time').getAttribute('datetime');
    await page.evaluate(() => {
      const h = (window as unknown as Window & { agentTest: Harness })
        .agentTest;
      h.retired = h.tools.get('localcut_skills');
      h.fail = true;
    });
    await refresh.click();
    await expect(dialog.getByRole('status')).toHaveText('Registration failed');
    await expect(dialog.getByRole('alert')).toHaveText(
      'Site tools denied by browser',
    );
    expect(await toolNames(page)).toEqual([]);
    expect(
      await page.evaluate(async () =>
        (
          window as unknown as Window & { agentTest: Harness }
        ).agentTest.retired!.execute(
          {},
          { signal: new AbortController().signal },
        ),
      ),
    ).toMatchObject({ error: { code: 'DISPOSED' } });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await expect(refresh).toBeVisible();
    await page.screenshot({
      path: '.artifacts/browser-agent-error-mobile.png',
    });
    await page.evaluate(() => {
      (window as unknown as Window & { agentTest: Harness }).agentTest.fail =
        false;
    });
    await refresh.click();
    await expect(dialog.getByRole('status')).toHaveText('Tools ready');
    expect(await toolNames(page)).toEqual([
      'localcut_skills',
      'localcut_workspace',
    ]);
    await expect(dialog.locator('time')).toHaveAttribute('datetime', observed!);
    await inert();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: '.artifacts/browser-agent-ready.png' });
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Workspace settings', exact: true }),
    ).toBeFocused();
  });

  test(`browser agent refresh retains job results and saved project while route retirement still releases them ${base}`, async ({
    page,
  }) => {
    await page.addInitScript(attachContext);
    await page.goto(base);
    await expect.poll(() => toolNames(page)).toContain('localcut_workspace');
    const created = await call<{ project: { id: string } }>(page, 'workspace', {
      action: 'create_project',
      name: 'Browser agent refresh',
    });
    const projectId = created.project.id;
    await expect.poll(() => toolNames(page)).toContain('localcut_asset');
    const base64 = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 32;
      c.getContext('2d')!.fillRect(0, 0, 32, 32);
      return c.toDataURL('image/png').split(',')[1]!;
    });
    const imported = await call<{ jobId: string }>(page, 'import_media', {
      projectId,
      name: 'refresh.png',
      mimeType: 'image/png',
      base64,
    });
    const completed = await call<{ result: { asset: { id: string } } }>(
      page,
      'job',
      { projectId, jobId: imported.jobId, action: 'wait' },
    );
    const assetId = completed.result.asset.id;
    const clips = [
      {
        id: 'source',
        name: 'Source',
        startUs: 0,
        endUs: 0,
        context: 'Retained context',
        transcript: 'Retained text',
      },
    ];
    await call(page, 'asset', {
      projectId,
      assetId,
      action: 'update_clips',
      expectedClipsRevision: 0,
      clips,
    });
    const preview = await call<{ jobId: string }>(page, 'asset', {
      projectId,
      assetId,
      action: 'preview_clip',
      clipId: 'source',
    });
    const result = await call<{ result: { url: string } }>(page, 'job', {
      projectId,
      action: 'wait',
      jobId: preview.jobId,
    });
    const beforeNames = await toolNames(page);
    await page.evaluate(() => {
      const h = (window as unknown as Window & { agentTest: Harness })
        .agentTest;
      h.retired = h.tools.get('localcut_inspect_project');
    });
    const dialog = await openStatus(page);
    await dialog
      .getByRole('button', { name: 'Refresh browser agent tools', exact: true })
      .click();
    await expect(dialog.getByRole('status')).toHaveText('Tools ready');
    expect(await toolNames(page)).toEqual(beforeNames);
    expect(
      await call(page, 'job', {
        projectId,
        action: 'wait',
        jobId: preview.jobId,
      }),
    ).toMatchObject(result);
    expect(
      await page.evaluate(
        async (url) => (await fetch(url)).ok,
        result.result.url,
      ),
    ).toBe(true);
    expect(
      await call(page, 'asset', { projectId, assetId, action: 'inspect' }),
    ).toMatchObject({ clipsRevision: 1, clips });
    expect(await call(page, 'inspect_project', {})).toMatchObject({
      project: { id: projectId, revision: 0 },
    });
    expect(
      await page.evaluate(async () =>
        (
          window as unknown as Window & { agentTest: Harness }
        ).agentTest.retired!.execute(
          {},
          { signal: new AbortController().signal },
        ),
      ),
    ).toMatchObject({ error: { code: 'DISPOSED' } });
    await page.screenshot({ path: '.artifacts/browser-agent-project.png' });
    const next = await call<{ project: { id: string } }>(page, 'workspace', {
      action: 'create_project',
      name: 'Next project',
    });
    await expect
      .poll(
        async () =>
          (await call<{ project: { id: string } }>(page, 'inspect_project', {}))
            .project?.id,
      )
      .toBe(next.project.id);
    await expect
      .poll(() =>
        page.evaluate(async (url) => {
          try {
            await fetch(url);
            return true;
          } catch {
            return false;
          }
        }, result.result.url),
      )
      .toBe(false);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  });
}
