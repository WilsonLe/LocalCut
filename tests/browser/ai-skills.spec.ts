import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

for (const base of ['/', '/LocalCut/']) {
  test(`AI domain guidance loads lazily and tools reset each turn ${base}`, async ({
    page,
  }) => {
    const root = base === '/' ? 'dist-root' : 'dist';
    const manifest = JSON.parse(
      await readFile(`${root}/.vite/manifest.json`, 'utf8'),
    ) as Record<string, { file: string }>;
    const skillFiles = ['editing', 'export', 'transcription', 'history'].map(
      (id) => {
        const entry = manifest[`src/ai/skills/${id}.ts`];
        expect(entry, `Separate dynamic skill module: ${id}`).toBeDefined();
        return base + entry!.file;
      },
    );
    const requested: string[] = [];
    page.on('request', (request) =>
      requested.push(new URL(request.url()).pathname),
    );
    await page.goto(base);
    const result = await page.evaluate(async (path) => {
      const { createEditor } = (await import(
        path + 'editor.js'
      )) as typeof import('../../src/editor');
      const { createAssistant } = (await import(
        path + 'ai.js'
      )) as typeof import('../../src/ai');
      const editor = await createEditor({
        namespace: 'test-skills-' + crypto.randomUUID(),
      });
      const project = await editor.projects.create('Private project');
      const requests: import('../../src/ai').ChatRequest[] = [];
      let round = 0;
      const assistant = createAssistant({
        editor,
        projectId: project.id,
        model: 'test/skills',
        provider: {
          async *stream(request) {
            requests.push(structuredClone(request));
            const name =
              round++ === 0
                ? 'load_skill'
                : round === 2
                  ? 'inspect_capabilities'
                  : undefined;
            yield {
              type: 'complete' as const,
              message: {
                role: 'assistant' as const,
                content: name ? null : 'Done',
                ...(name
                  ? {
                      tool_calls: [
                        {
                          id: crypto.randomUUID(),
                          type: 'function' as const,
                          function: {
                            name,
                            arguments: JSON.stringify(
                              name === 'load_skill'
                                ? { skillId: 'editing' }
                                : {},
                            ),
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
        await assistant.run('Inspect the editing rules').completion;
        await assistant.run('Another request').completion;
        return requests.map((request) => ({
          tools: request.tools.map((tool) => tool.function.name),
          payload: JSON.stringify(request),
        }));
      } finally {
        await assistant.dispose();
        await editor.dispose();
      }
    }, base);
    expect(result[0]!.tools).toEqual([
      'load_skill',
      'inspect_project',
      'inspect_proposals',
    ]);
    expect(result[0]!.payload).not.toContain(
      'Transition templates are editable recipes',
    );
    expect(result[1]!.tools).toContain('propose_edits');
    expect(result[1]!.tools).not.toContain('propose_action');
    expect(result[1]!.payload).toContain(
      'Transition templates are editable recipes',
    );
    expect(result[3]!.tools).toEqual(result[0]!.tools);
    expect(result[3]!.payload).not.toContain(
      'Transition templates are editable recipes',
    );
    expect(requested).toContain(skillFiles[0]);
    for (const path of skillFiles.slice(1))
      expect(requested).not.toContain(path);
    expect(result.map((request) => request.payload).join('')).not.toContain(
      'Private project',
    );
  });
}
