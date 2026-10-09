import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();

describe('pure editing core dependency boundary', () => {
  it.each([
    'react',
    'react-dom/client',
    'idb',
    'mediabunny',
    '@huggingface/transformers',
    '../storage/store',
    '@/storage/store',
    '../../storage/store',
    '../media/composition',
    '@/media/composition',
    '../services/jobs',
    '@/services/jobs',
    '../workers/media.worker',
    '@/workers/media.worker',
    '../editor/index',
    '@/editor/index',
  ])('rejects %s from the core', async (source) => {
    const [result] = await eslint.lintText(
      `import * as dependency from ${JSON.stringify(source)}; export { dependency };`,
      { filePath: 'src/core/boundary-probe.ts' },
    );
    expect(
      result!.messages.some((m) => m.ruleId === 'no-restricted-imports'),
    ).toBe(true);
  });

  it('also checks reexports and forbids unchecked dynamic imports', async () => {
    for (const source of [
      "export { Store } from '@/storage/store';",
      "export type { Store } from '../storage/store';",
      "export const load = () => import('@/media/composition');",
    ]) {
      const [result] = await eslint.lintText(source, {
        filePath: 'src/core/boundary-probe.ts',
      });
      expect(result!.errorCount).toBeGreaterThan(0);
    }
  });

  it.each(['zod', './timing', '@/core/model', '../core/errors'])(
    'permits the pure dependency %s',
    async (source) => {
      const [result] = await eslint.lintText(
        `import * as dependency from ${JSON.stringify(source)}; export { dependency };`,
        { filePath: 'src/core/boundary-probe.ts' },
      );
      expect(result!.messages).toEqual([]);
    },
  );

  it('does not impose core boundaries on the engine facade', async () => {
    const [result] = await eslint.lintText(
      "export { Store } from '../storage/store';",
      { filePath: 'src/editor/boundary-probe.ts' },
    );
    expect(result!.messages).toEqual([]);
  });
});
