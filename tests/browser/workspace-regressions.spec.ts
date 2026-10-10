import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Project } from '../../src/editor';

async function createProject(page: Page, name: string) {
  await page
    .getByRole('button', { name: 'Workspace settings', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
  await page
    .getByRole('menuitem', { name: 'New project', exact: true })
    .click();
  await page.getByLabel('Project name', { exact: true }).fill(name);
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Add text', exact: true }),
  ).toBeEnabled();
}
async function snapshot(page: Page, name: string): Promise<Project> {
  return page.evaluate(async (name) => {
    const { createEditor } = (await import(
      String('/LocalCut/editor.js')
    )) as typeof import('../../src/editor');
    const engine = await createEditor();
    try {
      const project = (await engine.projects.list()).find(
        (project) => project.name === name,
      );
      if (!project) throw new Error('Expected persisted UI project');
      return project;
    } finally {
      await engine.dispose();
    }
  }, name);
}

test('long assistant replies scroll inside the conversation and keep the composer reachable', async ({
  page,
  context,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const model = 'test/long-reply';
  const reply =
    'A deliberate edit keeps the story clear. Review the framing, pacing, sound, and captions before you apply a change.\n\n'.repeat(
      190,
    );
  expect(new TextEncoder().encode(reply).length).toBeGreaterThan(22000);
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  };
  await context.route('https://openrouter.ai/api/v1/models', (route) =>
    route.fulfill({
      headers: cors,
      json: {
        data: [
          {
            id: model,
            name: 'Long reply model',
            context_length: 32000,
            supported_parameters: ['tools', 'tool_choice'],
          },
        ],
      },
    }),
  );
  await context.route(
    'https://openrouter.ai/api/v1/chat/completions',
    (route) =>
      route.fulfill(
        route.request().method() === 'OPTIONS'
          ? { headers: cors, body: '' }
          : {
              headers: cors,
              contentType: 'text/event-stream',
              body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: reply }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
            },
      ),
  );
  await page.goto('/LocalCut/');
  await createProject(page, 'Long conversation');
  await page
    .getByRole('button', { name: 'Connect AI', exact: true })
    .first()
    .click();
  const settings = page.getByRole('dialog', {
    name: 'AI connection',
    exact: true,
  });
  await settings
    .getByLabel('OpenRouter API key', { exact: true })
    .fill('synthetic-long-reply-key');
  await settings
    .getByRole('button', { name: 'Use API key', exact: true })
    .click();
  const select = settings.getByRole('combobox', {
    name: 'AI model',
    exact: true,
  });
  await expect(select).toBeEnabled();
  await select.click();
  await page
    .getByRole('option', { name: `Long reply model · ${model}`, exact: true })
    .click();
  await settings.getByRole('button', { name: 'Done', exact: true }).click();
  await page
    .getByLabel('Describe your edit', { exact: true })
    .fill('Explain how to plan this edit.');
  await page
    .getByRole('button', { name: 'Send edit request', exact: true })
    .click();
  const log = page.getByRole('log', {
    name: 'Conversation messages',
    exact: true,
  });
  await expect
    .poll(() =>
      log.evaluate(
        (element, reply) =>
          element.textContent
            ?.replace(/\s/g, '')
            .includes(reply.replace(/\s/g, '')),
        reply,
      ),
    )
    .toBe(true);
  await expect(page.getByText(/Response in progress/)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Send edit request', exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel('Describe your edit', { exact: true })
    .fill('Next edit');
  const desktop = await page.evaluate(() => {
    const log = document.querySelector('[role="log"]')!;
    const composer = document.querySelector(
      'textarea[aria-label="Describe your edit"]',
    )!;
    const box = composer.getBoundingClientRect();
    return {
      viewportHeight: innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      logHeight: log.clientHeight,
      logScrollHeight: log.scrollHeight,
      overflow: getComputedStyle(log).overflowY,
      composerTop: box.top,
      composerBottom: box.bottom,
    };
  });
  await testInfo.attach('desktop long reply layout', {
    contentType: 'application/json',
    body: JSON.stringify(desktop),
  });
  expect(desktop.logHeight).toBeGreaterThan(0);
  expect(desktop.logScrollHeight).toBeGreaterThan(desktop.logHeight + 1000);
  expect(['auto', 'scroll']).toContain(desktop.overflow);
  expect(desktop.documentHeight).toBeLessThanOrEqual(
    desktop.viewportHeight + 2,
  );
  expect(desktop.composerTop).toBeGreaterThanOrEqual(0);
  expect(desktop.composerBottom).toBeLessThanOrEqual(desktop.viewportHeight);
  await log.evaluate((element) => {
    element.scrollTop = 0;
  });
  expect(await log.evaluate((element) => element.scrollTop)).toBe(0);
  await log.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(await log.evaluate((element) => element.scrollTop)).toBeGreaterThan(
    1000,
  );
  await expect(
    page.getByRole('button', { name: 'Send edit request', exact: true }),
  ).toBeInViewport();
  const editorWidth = await page
    .locator('.editing-area')
    .evaluate((element) => element.getBoundingClientRect().width);
  await page
    .getByRole('button', { name: 'Collapse chat', exact: true })
    .click();
  await expect(log).toBeHidden();
  await expect
    .poll(() =>
      page
        .locator('.editing-area')
        .evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeGreaterThan(editorWidth + 200);
  await expect(
    page.getByRole('button', { name: 'Expand chat', exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('chat-collapsed.png') });
  await page.getByRole('button', { name: 'Expand chat', exact: true }).click();
  await expect
    .poll(() =>
      log.evaluate(
        (element, value) =>
          element.textContent
            ?.replace(/\s/g, '')
            .includes(value.replace(/\s/g, '')),
        reply,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page
        .locator('.editing-area')
        .evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeCloseTo(editorWidth, 0);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const narrow = await page.evaluate(() => {
      const log = document.querySelector('[role="log"]')!;
      return {
        width: innerWidth,
        viewportHeight: innerHeight,
        documentWidth: document.documentElement.scrollWidth,
        documentHeight: document.documentElement.scrollHeight,
        logHeight: log.clientHeight,
        logScrollHeight: log.scrollHeight,
        editingTop: document
          .querySelector('.editing-area')!
          .getBoundingClientRect().top,
        conversationTop: document
          .querySelector('aside[aria-label="Editing conversation"]')!
          .getBoundingClientRect().top,
      };
    });
    await testInfo.attach(`narrow long reply layout ${width}`, {
      contentType: 'application/json',
      body: JSON.stringify(narrow),
    });
    expect(narrow.documentWidth).toBeLessThanOrEqual(narrow.width);
    expect(narrow.editingTop).toBeLessThan(narrow.conversationTop);
    expect(narrow.logHeight).toBeGreaterThan(0);
    expect(narrow.logScrollHeight).toBeGreaterThan(narrow.logHeight);
    expect(narrow.logHeight).toBeLessThan(640);
    await page
      .getByRole('navigation', { name: 'Workspace sections' })
      .getByRole('button', { name: 'Chat', exact: true })
      .click();
    await page
      .getByLabel('Describe your edit', { exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole('button', { name: 'Send edit request', exact: true }),
    ).toBeInViewport();
  }
  await page
    .getByLabel('Describe your edit', { exact: true })
    .fill('Keep this mobile draft');
  await page.screenshot({
    path: testInfo.outputPath('mobile-long-conversation.png'),
  });
  await page.setViewportSize({ width: 320, height: 420 });
  const mobileDraft = Array.from(
    { length: 8 },
    (_, index) => `Draft line ${index + 1}`,
  ).join('\n');
  await page
    .getByLabel('Describe your edit', { exact: true })
    .fill(mobileDraft);
  await page
    .getByRole('navigation', { name: 'Workspace sections' })
    .getByRole('button', { name: 'Chat', exact: true })
    .click();
  await page.getByLabel('Describe your edit', { exact: true }).focus();
  await expect(
    page.getByRole('button', { name: 'Send edit request', exact: true }),
  ).toBeInViewport();
  const send = page.getByRole('button', {
    name: 'Send edit request',
    exact: true,
  });
  // Do not click/scroll Send: Playwright can otherwise rescue a clipped button
  // by scrolling an overflow:hidden ancestor that a touch user cannot scroll.
  await expect
    .poll(() =>
      send.evaluate((button) => {
        const rect = button.getBoundingClientRect();
        return button.contains(
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ),
        );
      }),
    )
    .toBe(true);
  const sendBounds = (await send.boundingBox())!;
  const navBounds = (await page
    .getByRole('navigation', { name: 'Workspace sections' })
    .boundingBox())!;
  expect(sendBounds.y + sendBounds.height).toBeLessThanOrEqual(navBounds.y);
  const draftSizing = await page
    .getByLabel('Describe your edit', { exact: true })
    .evaluate((input) => ({
      client: input.clientHeight,
      scroll: input.scrollHeight,
      overflow: getComputedStyle(input).overflowY,
    }));
  expect(draftSizing.scroll).toBeGreaterThan(draftSizing.client);
  expect(draftSizing.overflow).toBe('auto');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page
    .getByRole('button', { name: 'Collapse chat', exact: true })
    .click();
  await expect(log).toBeHidden();
  await page.getByRole('button', { name: 'Expand chat', exact: true }).click();
  await expect(
    page.getByLabel('Describe your edit', { exact: true }),
  ).toHaveValue(mobileDraft);
  await expect
    .poll(() =>
      log.evaluate(
        (element, value) =>
          element.textContent
            ?.replace(/\s/g, '')
            .includes(value.replace(/\s/g, '')),
        reply,
      ),
    )
    .toBe(true);
});

test('stale property forms reject before overwriting a concurrent engine edit and can retry fresh', async ({
  page,
}) => {
  // Keep only the external instance's notification from reaching the workspace.
  // The writes below still use the production engine and real IndexedDB commits.
  await page.addInitScript(() => {
    const control = { hold: false, suppressed: 0 };
    Object.defineProperty(window, '__propertyBroadcastControl', {
      value: control,
    });
    const original = BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage = function (message: unknown) {
      if (this.name === 'localcut-projects' && control.hold) {
        control.suppressed++;
        return;
      }
      original.call(this, message);
    };
  });
  await page.goto('/LocalCut/');
  const name = 'Property revision conflict';
  await createProject(page, name);
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await page
    .getByRole('button', { name: 'Insert Plain text', exact: true })
    .click();
  const form = page.getByRole('dialog', {
    name: 'Clip properties',
    exact: true,
  });
  await expect(form).toBeVisible();
  await expect(form.getByLabel('Gain', { exact: true })).toHaveValue('1');
  const initial = await snapshot(page, name);
  expect(initial.revision).toBe(1);
  const clipId = initial.tracks[0]!.clips[0]!.id;
  const external = await page.evaluate(
    async ({ name, clipId }) => {
      const control = (
        window as unknown as {
          __propertyBroadcastControl: { hold: boolean; suppressed: number };
        }
      ).__propertyBroadcastControl;
      control.hold = true;
      const { createEditor } = (await import(
        String('/LocalCut/editor.js')
      )) as typeof import('../../src/editor');
      const other = await createEditor();
      try {
        const project = (await other.projects.list()).find(
          (project) => project.name === name,
        )!;
        await other.commands.apply({
          projectId: project.id,
          expectedRevision: project.revision,
          requestId: crypto.randomUUID(),
          operations: [{ type: 'updateClip', clipId, patch: { gain: 0.25 } }],
        });
        return {
          snapshot: await other.projects.snapshot(project.id),
          suppressed: control.suppressed,
        };
      } finally {
        await other.dispose();
      }
    },
    { name, clipId },
  );
  expect(external.snapshot.revision).toBe(2);
  expect(external.snapshot.tracks[0]!.clips[0]!.gain).toBe(0.25);
  expect(external.suppressed).toBeGreaterThan(0);
  // Verify the old rendered form is truly stale before submitting it.
  await expect(form.getByLabel('Gain', { exact: true })).toHaveValue('1');
  await form.getByLabel('Start (seconds)', { exact: true }).fill('0.1');
  await form
    .getByRole('button', { name: 'Apply properties', exact: true })
    .click();
  const conflict = page.getByText(
    'Project changed. Review the latest values and try again.',
    { exact: true },
  );
  await expect
    .poll(
      async () =>
        (await conflict.isVisible()) ||
        (await snapshot(page, name)).revision !== 2,
    )
    .toBe(true);
  const rejected = await snapshot(page, name);
  expect(rejected.revision).toBe(2);
  expect(rejected.tracks[0]!.clips[0]!).toMatchObject({
    gain: 0.25,
    startUs: 0,
  });
  await expect(conflict).toBeVisible();
  await expect(form).toBeVisible();
  await expect(form.getByLabel('Gain', { exact: true })).toHaveValue('0.25');
  await expect(form.getByLabel('Start (seconds)', { exact: true })).toHaveValue(
    '0',
  );
  await page.evaluate(() => {
    (
      window as unknown as { __propertyBroadcastControl: { hold: boolean } }
    ).__propertyBroadcastControl.hold = false;
  });
  await form.getByLabel('Start (seconds)', { exact: true }).fill('0.1');
  await form
    .getByRole('button', { name: 'Apply properties', exact: true })
    .click();
  await expect.poll(async () => (await snapshot(page, name)).revision).toBe(3);
  const retried = await snapshot(page, name);
  expect(retried.tracks[0]!.clips[0]!).toMatchObject({
    gain: 0.25,
    startUs: 100000,
  });
});
