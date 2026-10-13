import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createTestServer } from '../../scripts/test-server.mjs';

test('cached test assets revalidate changed entries while both deployment roots stay isolated', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'localcut-http-cache-'));
  const server = createTestServer(directory);
  t.after(async () => {
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await closed;
    await rm(directory, { recursive: true, force: true });
  });
  for (const root of ['dist', 'dist-root']) {
    await mkdir(join(directory, root, 'assets'), { recursive: true });
    await writeFile(join(directory, root, 'index.html'), root);
    await writeFile(
      join(directory, root, 'build-info.json'),
      '{"revision":"old"}',
    );
    await writeFile(join(directory, root, 'editor.js'), 'old entry');
    await writeFile(
      join(directory, root, 'assets', 'editor-abcdefgh.js'),
      'hashed module',
    );
  }
  await writeFile(join(directory, 'private.txt'), 'outside served roots');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const [base, root] of [
    ['/', 'dist-root'],
    ['/LocalCut/', 'dist'],
  ]) {
    const html = await globalThis.fetch(origin + base);
    assert.equal(await html.text(), root);
    assert.equal(html.headers.get('cache-control'), 'private, no-cache');
    const asset = await globalThis.fetch(
      origin + base + 'assets/editor-abcdefgh.js',
    );
    assert.equal(
      asset.headers.get('cache-control'),
      'private, max-age=31536000, immutable',
    );
    const unchanged = await globalThis.fetch(
      origin + base + 'assets/editor-abcdefgh.js',
      {
        headers: { 'If-None-Match': asset.headers.get('etag') },
      },
    );
    assert.equal(unchanged.status, 304);
    assert.equal(await unchanged.text(), '');
    for (const name of ['editor.js', 'build-info.json']) {
      const first = await globalThis.fetch(origin + base + name);
      assert.equal(first.headers.get('cache-control'), 'private, no-cache');
      const etag = first.headers.get('etag');
      const unchanged = await globalThis.fetch(origin + base + name, {
        headers: { 'If-None-Match': etag },
      });
      assert.equal(unchanged.status, 304);
      // Content identity, rather than size/mtime, catches a same-length rewrite.
      await writeFile(
        join(directory, root, name),
        name === 'editor.js' ? 'new entry' : '{"revision":"new"}',
      );
      const changed = await globalThis.fetch(origin + base + name, {
        headers: { 'If-None-Match': etag },
      });
      assert.equal(changed.status, 200);
      assert.notEqual(changed.headers.get('etag'), etag);
      assert.match(await changed.text(), /new/);
    }
  }
  assert.equal(
    (await globalThis.fetch(origin + '/%2e%2e%2fprivate.txt')).status,
    403,
  );
  assert.equal((await globalThis.fetch(origin + '/missing.js')).status, 404);
});
