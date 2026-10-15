import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();

async function lintMessages(source: string, filePath = 'src/core/errors.ts') {
  // Typed linting needs a real project member even when replacing its source.
  const [result] = await eslint.lintText(source, { filePath });
  expect(result!.messages.filter((message) => message.fatal)).toEqual([]);
  return result!.messages;
}

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
    const messages = await lintMessages(
      `import * as dependency from ${JSON.stringify(source)}; export { dependency };`,
    );
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(
      true,
    );
  });

  it('also checks reexports and forbids unchecked dynamic imports', async () => {
    for (const source of [
      "export { Store } from '@/storage/store';",
      "export type { Store } from '../storage/store';",
      "export const load = () => import('@/media/composition');",
    ]) {
      const messages = await lintMessages(source);
      expect(
        messages.some((message) =>
          ['no-restricted-imports', 'no-restricted-syntax'].includes(
            message.ruleId ?? '',
          ),
        ),
      ).toBe(true);
    }
  });

  it.each(['zod', './timing', '@/core/model', '../core/errors'])(
    'permits the pure dependency %s',
    async (source) => {
      const messages = await lintMessages(
        `import * as dependency from ${JSON.stringify(source)}; export { dependency };`,
      );
      expect(messages).toEqual([]);
    },
  );

  it('does not impose core boundaries on the engine facade', async () => {
    const messages = await lintMessages(
      "export { Store } from '../storage/store';",
      'src/editor/index.ts',
    );
    expect(messages).toEqual([]);
  });
});
