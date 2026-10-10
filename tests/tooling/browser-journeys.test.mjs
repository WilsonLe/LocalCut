import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocation,
  normalBrowserEnv,
  poolMaxCost,
} from '../../scripts/test-resources.ts';

const capacity = {
  cpus: 18,
  freeBytes: 40 * 1024 ** 3,
  totalBytes: 48 * 1024 ** 3,
  load: 0,
};

test('normal Chrome reuses one browser by default, including the check scheduler', () => {
  const env = normalBrowserEnv({});
  assert.equal(allocation(capacity, env).browserWorkers, 1);
  assert.equal(poolMaxCost(env, true), 2);
  assert.equal(allocation(capacity, env).unitWorkers, 18);
});

test('explicit browser parallelism preserves live resource caps and does not mutate caller env', () => {
  const original = { LOCALCUT_BROWSER_WORKERS: '6' };
  const env = normalBrowserEnv(original);
  assert.equal(allocation(capacity, env).browserWorkers, 6);
  assert.equal(allocation({ ...capacity, cpus: 4 }, env).browserWorkers, 2);
  assert.equal(poolMaxCost(env, true), 12);
  assert.deepEqual(original, { LOCALCUT_BROWSER_WORKERS: '6' });
  assert.throws(() =>
    allocation(capacity, normalBrowserEnv({ LOCALCUT_BROWSER_WORKERS: '0' })),
  );
});
