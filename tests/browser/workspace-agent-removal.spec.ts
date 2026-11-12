import { createWorkspace } from './workspace-project-helper';
import { test, expect } from '@playwright/test';
import { behaviorBases } from './coverage-bases';
import { openWorkspaceGroup } from './workspace-settings-helper';

for (const base of behaviorBases) {
  test(`agent removal leaves an inert project list and no provider UI ${base}`, async ({
    page,
  }, info) => {
    const remote: string[] = [];
    page.on('request', (request) => {
      if (!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))
        remote.push(request.url());
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base);
    await expect(
      page.getByRole('main', { name: 'Projects', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(async () => (await indexedDB.databases()).length),
    ).toBe(0);
    await expect(page.locator('#chat-panel, .conversation-panel')).toHaveCount(
      0,
    );
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    const settings = page.getByRole('menu', {
      name: 'Workspace settings',
      exact: true,
    });
    await expect(settings).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: 'AI settings', exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    const discovery = await (
      await page.request.get(base + 'modules.json')
    ).json();
    expect(Object.keys(discovery.modules)).toEqual(['editor']);
    expect((await page.request.get(base + 'ai.js')).status()).toBe(404);
    await page
      .getByRole('button', { name: 'New project', exact: true })
      .click();
    await page
      .getByLabel('Project name', { exact: true })
      .fill('Manual editor');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Open project', exact: true }),
    ).toContainText('Manual editor');
    await page.getByRole('button', { name: 'Add text', exact: true }).click();
    await page
      .getByRole('button', { name: 'Insert Plain text', exact: true })
      .click();
    await expect(
      page.getByRole('dialog', { name: 'Clip properties' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.timeline-clip')).toHaveCount(1);
    await page.getByRole('button', { name: 'Commands', exact: true }).click();
    const palette = page.getByRole('dialog', { name: 'Commands', exact: true });
    await palette.getByRole('combobox').fill('chat');
    await expect(
      palette.getByRole('option', {
        name: /chat|OpenRouter|AI settings|speech/i,
      }),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    const media = await openWorkspaceGroup(page, 'View');
    await media
      .getByRole('menuitemcheckbox', { name: 'Media library', exact: true })
      .click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('button', { name: 'Text to speech', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Project media' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Record screen', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath('manual-editor-desktop.png'),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const navigation = page.getByRole('navigation', {
      name: 'Workspace sections',
    });
    await expect(navigation.getByRole('button')).toHaveCount(2);
    await navigation
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    await expect(
      page.getByRole('region', { name: 'Project media' }),
    ).toBeVisible();
    await navigation.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(
      page.getByRole('main', { name: 'Video editor' }),
    ).toBeFocused();
    await expect(page.locator('.timeline-clip')).toHaveCount(1);
    await page.screenshot({
      path: info.outputPath('manual-editor-mobile.png'),
    });
    await page.reload();
    await expect(page.locator('.timeline-clip')).toHaveCount(1);
    expect(remote).toEqual([]);
  });

  test(`agent upgrade drops credentials and old layout while retaining local choices ${base}`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      if (localStorage.getItem('test-upgrade-seeded')) return;
      localStorage.setItem('test-upgrade-seeded', 'keep');
      localStorage.setItem('localcut.openrouter-credential.v1', 'retired');
      localStorage.setItem(
        'localcut.openrouter-credential.v1:account',
        'retired',
      );
      localStorage.setItem('localcut.chatgpt-credentials.v1', 'retired');
      localStorage.setItem('localcut.voice-presets.v1', 'retired');
      sessionStorage.setItem('localcut-openrouter-oauth-v1:account', 'retired');
      localStorage.setItem(
        'localcut.workspace-preferences.v1',
        JSON.stringify({
          version: 1,
          preferences: {
            mediaOpen: true,
            mediaWidth: 410,
            timelineHeight: 315,
            exportFormat: 'webm',
            timelineSnapping: false,
            chatWidth: 500,
            chatCollapsed: true,
            aiModel: 'old',
            aiProviders: 'retired',
          },
        }),
      );
    });
    await page.goto(base);
    await expect(
      page.getByRole('main', { name: 'Projects', exact: true }),
    ).toBeVisible();
    const state = await page.evaluate(async () => ({
      keys: Object.keys(localStorage),
      temporary: Object.keys(sessionStorage),
      settings: JSON.parse(
        localStorage.getItem('localcut.workspace-preferences.v1')!,
      ).preferences,
      databases: await indexedDB.databases(),
    }));
    expect(state.keys).toEqual(
      expect.arrayContaining([
        'test-upgrade-seeded',
        'localcut.workspace-preferences.v1',
      ]),
    );
    expect(state.keys.join(' ')).not.toMatch(
      /openrouter|chatgpt|voice-presets/,
    );
    expect(state.temporary.join(' ')).not.toContain('oauth');
    expect(state.settings).toEqual({
      mediaOpen: true,
      mediaWidth: 410,
      timelineHeight: 315,
      exportFormat: 'webm',
      timelineSnapping: false,
    });
    expect(state.databases).toEqual([]);
    await createWorkspace(page);
    await expect(
      page.getByRole('button', { name: 'Collapse media', exact: true }),
    ).toBeVisible();
  });
}
