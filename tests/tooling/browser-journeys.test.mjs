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

test('normal Chrome shares one browser across a resource-bounded context pool', () => {
  const env = normalBrowserEnv({});
  assert.equal(env.LOCALCUT_BROWSER_MODE, 'shared');
  assert.equal(allocation(capacity, env).browserWorkers, 18);
  assert.equal(poolMaxCost(env, true), Number.MAX_SAFE_INTEGER);
  assert.equal(allocation(capacity, env).unitWorkers, 18);
  assert.equal(
    allocation({ ...capacity, freeBytes: 4 * 1024 ** 3 }, env).browserWorkers,
    4,
  );
  // Native/separately launched browsers retain their two-slot reservation.
  assert.equal(allocation(capacity, {}).browserWorkers, 9);
});

test('explicit browser parallelism preserves live resource caps and does not mutate caller env', () => {
  const original = { LOCALCUT_BROWSER_WORKERS: '6' };
  const env = normalBrowserEnv(original);
  assert.equal(allocation(capacity, env).browserWorkers, 6);
  assert.equal(allocation({ ...capacity, cpus: 4 }, env).browserWorkers, 4);
  assert.equal(poolMaxCost(env, true), 6);
  assert.deepEqual(original, { LOCALCUT_BROWSER_WORKERS: '6' });
  assert.throws(() =>
    allocation(capacity, normalBrowserEnv({ LOCALCUT_BROWSER_WORKERS: '0' })),
  );
});
