import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { fontSnapshot } from './font-snapshot.ts';

export async function checkFonts(root) {
  const snapshots = await readdir(join(root, 'fonts'));
  assert.equal(snapshots.length, 1, 'Exactly one immutable font snapshot');
  const directory = join(root, 'fonts', snapshots[0]);
  assert.equal(snapshots[0], fontSnapshot(directory));
  assert.equal(snapshots[0], fontSnapshot());
  const catalog = JSON.parse(
    await readFile('src/core/bundled-fonts.json', 'utf8'),
  );
  const lock = JSON.parse(
    await readFile(join(directory, 'catalog-lock.json'), 'utf8'),
  );
  assert.deepEqual(
    catalog.map((font) => font.id.slice(5)).sort(),
    lock.families.map((font) => font.id).sort(),
  );
  const allowed = new Set();
  let total = 0;
  for (const family of lock.families) {
    const path = join(directory, family.id);
    const manifest = JSON.parse(
      await readFile(join(path, 'manifest.json'), 'utf8'),
    );
    assert.equal(manifest.family, `LocalCut ${family.id}`);
    assert((await stat(join(path, 'LICENSE.txt'))).size > 1000);
    for (const file of manifest.files) {
      assert(/^[a-z0-9-]+\.woff2$/.test(file.file));
      assert(
        file.unicodeRange &&
          file.source.startsWith('https://fonts.gstatic.com/'),
      );
      const full = join(path, file.file);
      const bytes = await readFile(full);
      assert.equal(bytes.subarray(0, 4).toString(), 'wOF2');
      assert.equal(bytes.length, file.bytes);
      assert.equal(
        createHash('sha256').update(bytes).digest('hex'),
        file.sha256,
        full,
      );
      allowed.add(full);
      total += bytes.length;
    }
    const names = await readdir(path);
    assert.equal(
      names.length,
      manifest.files.length + 2,
      `Unexpected asset: ${path}`,
    );
  }
  assert.equal((await readdir(directory)).length, lock.families.length + 1);
  assert(total <= 512 * 1024 * 1024, `Font asset budget exceeded: ${total}`);
  console.log(
    JSON.stringify({ root, bundledFonts: catalog.length, fontBytes: total }),
  );
  return allowed;
}
