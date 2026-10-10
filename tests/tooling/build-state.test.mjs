import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('verified build cache reuses test/docs edits and rejects source/output/environment drift', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localcut-build-state-'));
  try {
    for (const dir of ['scripts', 'src', 'public', 'dist', 'tests', 'docs'])
      await mkdir(join(root, dir));
    for (const name of ['build-state.mjs', 'build.mjs'])
      await copyFile(
        new URL('../../scripts/' + name, import.meta.url),
        join(root, 'scripts', name),
      );
    await writeFile(join(root, 'src', 'index.ts'), 'production');
    await writeFile(join(root, 'package.json'), '{}');
    await writeFile(join(root, 'dist', 'index.html'), 'output');
    const { target, inputHash, recordBuild, buildStatus } = await import(
      pathToFileURL(join(root, 'scripts', 'build-state.mjs')).href
    );
    const build = target();
    assert.equal((await buildStatus(build)).current, false);
    await recordBuild(build, await inputHash(build));
    assert.equal((await buildStatus(build)).current, true);
    await writeFile(join(root, 'tests', 'test.ts'), 'new test');
    await writeFile(join(root, 'docs', 'readme.md'), 'new docs');
    await writeFile(join(root, 'src', 'AGENTS.md'), 'instructions');
    assert.equal((await buildStatus(build)).current, true);
    await writeFile(join(root, 'dist', 'index.html'), 'tampered');
    assert.equal((await buildStatus(build)).current, false);
    await writeFile(join(root, 'dist', 'index.html'), 'output');
    await writeFile(join(root, 'src', 'index.ts'), 'changed');
    assert.equal((await buildStatus(build)).current, false);
    await writeFile(join(root, 'src', 'index.ts'), 'production');
    const saved = process.env.VITE_LOCALCUT_CACHE_PROBE;
    try {
      process.env.VITE_LOCALCUT_CACHE_PROBE = 'changed';
      assert.equal((await buildStatus(build)).current, false);
    } finally {
      if (saved === undefined) delete process.env.VITE_LOCALCUT_CACHE_PROBE;
      else process.env.VITE_LOCALCUT_CACHE_PROBE = saved;
    }
    await rm(join(root, 'dist', 'index.html'));
    assert.equal((await buildStatus(build)).current, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
