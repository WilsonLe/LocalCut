import { test, expect } from '@playwright/test';
import { behaviorBases } from './coverage-bases';
import { fulfillChatTitle } from './chat-title-fixture';
import {
  openAISettings,
  prepareOpenRouterKey,
  selectAISettingsTab,
} from './workspace-settings-helper';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};

for (const base of behaviorBases) {
  test(`chat to-dos recover from conversational tool markup on follow-up ${base}`, async ({
    page,
    context,
  }, testInfo) => {
    const contaminated =
      'I will verify my capabilities.\n<｜DSML｜ calls><｜DSML｜ invoke name="inspect_capabilities"></｜DSML｜ invoke></｜DSML｜ calls>';
    const goal = '## Goal\nAdd background music to the Sydney cut.';
    const todos =
      '## To-dos\n- [x] Explain the available audio capabilities.\n- [ ] Add background music — blocked: a music source is needed.';
    let recover = false;
    let requests = 0;
    let recoveredEvidence = false;
    await context.route('https://openrouter.ai/api/v1/models', (route) =>
      route.fulfill({
        headers: cors,
        json: {
          data: [
            {
              id: 'test/roles',
              name: 'Role test model',
              context_length: 512000,
              top_provider: { max_completion_tokens: 512000 },
              supported_parameters: ['tools', 'tool_choice'],
            },
          ],
        },
      }),
    );
    await context.route(
      'https://openrouter.ai/api/v1/chat/completions',
      async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ headers: cors, body: '' });
          return;
        }
        const request = route.request().postDataJSON();
        const instruction = request.messages[0].content;
        if (
          !instruction.startsWith('LocalCut ') &&
          (await fulfillChatTitle(route))
        )
          return;
        requests++;
        const data = JSON.parse(request.messages[1].content);
        const auxiliary = instruction.startsWith('LocalCut ');
        if (auxiliary) {
          expect(request.tool_choice).toBe('none');
          expect(request.tools).toBeUndefined();
          expect(
            request.messages.map((message: { role: string }) => message.role),
          ).toEqual(['system', 'user', 'user']);
          expect(request.messages[2].content).toContain('internal document');
          expect(request.messages[2].content).not.toContain(
            data.initialRequest,
          );
          expect(request.messages[1].content).not.toContain('<｜DSML｜');
        }
        if (
          instruction.startsWith('LocalCut session to-dos:') &&
          recover &&
          data.existingTodos === contaminated
        )
          recoveredEvidence = true;
        const content = instruction.startsWith('LocalCut request contract:')
          ? goal
          : instruction.startsWith('LocalCut session to-dos:')
            ? // Model outputs are scripted: this establishes transport and recovery,
              // not live model compliance with the new role instructions.
              recover
              ? todos
              : contaminated
            : instruction.startsWith('LocalCut completion review:')
              ? 'Background music remains blocked on a music source.'
              : 'There is no music synthesis action available. A music file is needed.';
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
        });
      },
    );
    await page.goto(base);
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
    await page
      .getByRole('menuitem', { name: 'New project', exact: true })
      .click();
    await page.getByLabel('Project name').fill('Sydney role recovery');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await openAISettings(page);
    await prepareOpenRouterKey(page);
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await dialog.getByLabel('OpenRouter API key').fill('synthetic-role-key');
    await dialog.getByRole('button', { name: 'Use API key' }).click();
    await selectAISettingsTab(page, 'LLM - Chat');
    await dialog
      .getByRole('combobox', { name: 'AI model', exact: true })
      .click();
    await page
      .getByRole('option', {
        name: 'Role test model · test/roles',
        exact: true,
      })
      .click();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    const submit = async (text: string) => {
      await page.getByLabel('Describe your edit', { exact: true }).fill(text);
      await page
        .getByRole('button', { name: 'Send edit request', exact: true })
        .click();
      await expect(
        page
          .getByRole('article', { name: 'Assistant response' })
          .last()
          .getByRole('button', { name: 'Copy response', exact: true }),
      ).toBeVisible();
    };
    await submit('Generate background music yourself, can you not?');
    await page.getByRole('button', { name: 'To-dos', exact: true }).click();
    await expect(page.locator('[data-slot="popover-content"]')).toContainText(
      '<｜DSML｜ calls>',
    );
    await page.keyboard.press('Escape');
    recover = true;
    await submit('I still need background music for the Sydney cut.');
    expect(recoveredEvidence).toBe(true);
    await page.getByRole('button', { name: 'To-dos', exact: true }).click();
    const popover = page.locator('[data-slot="popover-content"]');
    await expect(
      popover.getByRole('heading', { name: 'To-dos', exact: true, level: 4 }),
    ).toBeVisible();
    await expect(popover.getByRole('checkbox')).toHaveCount(2);
    await expect(popover.getByRole('checkbox').nth(0)).toBeChecked();
    await expect(popover.getByRole('checkbox').nth(1)).not.toBeChecked();
    await expect(popover).toContainText('blocked: a music source is needed');
    await expect(popover).not.toContainText('<｜DSML｜');
    await page.screenshot({ path: testInfo.outputPath('recovered-todos.png') });
    await page.keyboard.press('Escape');
    const beforeReload = requests;
    await page.reload();
    await page.getByRole('button', { name: 'To-dos', exact: true }).click();
    await expect(popover.getByRole('checkbox').nth(0)).toBeChecked();
    await expect(popover.getByRole('checkbox').nth(1)).not.toBeChecked();
    await expect(popover).toContainText('blocked: a music source is needed');
    expect(requests).toBe(beforeReload);
  });
}
