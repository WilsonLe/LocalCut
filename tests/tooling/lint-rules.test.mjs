import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';

const eslint = new ESLint();
async function rules(source, filePath = 'src/core/errors.ts') {
  const [result] = await eslint.lintText(source, { filePath });
  assert.ok(
    !result.messages.some((message) => message.fatal),
    JSON.stringify(result.messages),
  );
  return result.messages.map(({ ruleId }) => ruleId);
}

test('core boundaries reject higher-layer imports, aliases, re-exports, dynamic imports and browser globals', async () => {
  for (const source of [
    "import '../ai/errors';",
    "import '@/workspace/Workspace';",
    "export * from '../storage/store';",
  ])
    assert.ok((await rules(source)).includes('no-restricted-imports'), source);
  assert.ok(
    (await rules("void import('./model');")).includes('no-restricted-syntax'),
  );
  assert.ok(
    (await rules("void fetch('/source');")).includes('no-restricted-globals'),
  );
  assert.deepEqual(await rules("import './model';"), []);
});

test('runtime modules reject static and dynamic UI dependencies while the composition root can mount UI', async () => {
  const runtime = 'src/services/worker-client.ts';
  assert.ok(
    (await rules("export * from '@/workspace/Workspace';", runtime)).includes(
      'no-restricted-imports',
    ),
  );
  for (const source of [
    "void import('../workspace/Workspace');",
    'void import(`@/components/ui/button`);',
  ])
    assert.ok(
      (await rules(source, runtime)).includes('local/dynamic-ui-boundary'),
    );
  assert.deepEqual(
    await rules("import './workspace/Workspace';", 'src/App.tsx'),
    [],
  );
});

test('typed Promise checks reject detached work, async void callbacks and Promise conditions', async () => {
  assert.ok(
    (await rules('Promise.resolve();')).includes(
      '@typescript-eslint/no-floating-promises',
    ),
  );
  assert.ok(
    (
      await rules(
        "addEventListener('click', async () => { await Promise.resolve(); });",
        'src/workspace/Workspace.tsx',
      )
    ).includes('@typescript-eslint/no-misused-promises'),
  );
  assert.ok(
    (
      await rules('if (Promise.resolve(false)) { console.log(false); }')
    ).includes('@typescript-eslint/no-misused-promises'),
  );
  assert.deepEqual(
    await rules("void Promise.resolve().catch(() => console.log('handled'));"),
    [],
  );
});
