import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fontSnapshot } from '../../scripts/font-snapshot.ts';

test('font snapshot changes when manifest or expected binary content changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localcut-font-snapshot-'));
  try {
    await mkdir(join(root, 'inter'));
    await writeFile(
      join(root, 'catalog-lock.json'),
      JSON.stringify({
        families: [{ id: 'inter' }],
      }),
    );
    const path = join(root, 'inter', 'manifest.json');
    await writeFile(path, JSON.stringify({ sha256: 'old', family: 'Inter' }));
    const first = fontSnapshot(root);
    assert.equal(fontSnapshot(root), first);
    await writeFile(path, JSON.stringify({ sha256: 'new', family: 'Inter' }));
    const second = fontSnapshot(root);
    assert.notEqual(second, first);
    await writeFile(path, JSON.stringify({ sha256: 'new', family: 'Updated' }));
    assert.notEqual(fontSnapshot(root), second);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
