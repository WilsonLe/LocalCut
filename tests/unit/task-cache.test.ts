import { describe, expect, it } from 'vitest';
import { taskCacheKey } from '../../src/services/task-cache';
import { readdir, readFile } from 'node:fs/promises';

describe('task cache identities and producer contract', () => {
  it('keys sorted fields and binary contents/types with no object alias or parameter collisions', async () => {
    const shared = { value: 1 };
    expect(
      await taskCacheKey({ b: new Float32Array([1]), a: [shared, shared] }),
    ).toBe(
      await taskCacheKey({
        a: [{ value: 1 }, { value: 1 }],
        b: new Float32Array([1]),
      }),
    );
    const variants = [
      new Uint8Array([1]),
      new Uint8Array([2]),
      new Int8Array([1]),
      { a: undefined },
      {},
      [1, 2],
      [2, 1],
      0,
      -0,
    ];
    const hashes = await Promise.all(variants.map(taskCacheKey));
    expect(new Set(hashes).size).toBe(variants.length);
    expect(await taskCacheKey(new Blob(['a']))).not.toBe(
      await taskCacheKey(new Blob(['b'])),
    );
  });
  it('rejects nonfinite, cyclic, functional and native inputs', async () => {
    const cycle: unknown[] = [];
    cycle.push(cycle);
    for (const value of [NaN, Infinity, cycle, () => {}, new Date()])
      await expect(taskCacheKey(value)).rejects.toMatchObject({
        code: 'INVALID_COMMAND',
      });
  });
  it('requires every production task registration and facade wrapper call to declare a cache policy', async () => {
    const files = await readdir('src', { recursive: true });
    let registrations = 0;
    for (const file of files.filter((file) => /\.[tj]sx?$/.test(file))) {
      const source = await readFile('src/' + file, 'utf8');
      for (const match of source.matchAll(/\.register\s*\(/g)) {
        const registration = source.slice(match.index, match.index! + 350);
        expect(
          registration,
          `${file}: every new task needs an explicit cache policy`,
        ).toMatch(/^\.register\s*\([^,]+,\s*\{\s*cache\b/);
        registrations++;
      }
    }
    expect(registrations).toBeGreaterThanOrEqual(9);
  });
});
