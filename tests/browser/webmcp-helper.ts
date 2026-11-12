import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Project } from '../../src/editor';
import type { SiteTool } from '../../src/workspace/webmcp/types';

export interface ToolContext {
  getTools(): Promise<SiteTool[]>;
  executeTool(tool: SiteTool, input: unknown): Promise<unknown>;
}
export async function installHarness(page: Page) {
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
export async function call<T = Record<string, unknown>>(
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
export async function ready(page: Page) {
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
export async function workspaceReady(page: Page) {
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
export async function projectReady(page: Page, id: string) {
  await expect(async () => {
    expect(
      (await call<{ project: Project }>(page, 'inspect_project')).project.id,
    ).toBe(id);
  }).toPass();
}
