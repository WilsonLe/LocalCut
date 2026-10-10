import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cgroupPaths,
  availableBytes,
  allocation,
  quotaCpus,
  memoryLimit,
} from '../../scripts/test-resources.ts';
import { schedule } from '../../scripts/test-scheduler.mjs';
const GiB = 1024 ** 3;
const host = { cpus: 16, freeBytes: 20 * GiB, totalBytes: 32 * GiB, load: 0 };
test('limits workers by idle CPU, free memory, affinity and cgroup quotas', () => {
  assert.equal(allocation(host).slots, 8);
  assert.equal(allocation({ ...host, cpus: 2 }).browserWorkers, 1);
  assert.equal(allocation({ ...host, load: 14 }).slots, 2);
  assert.equal(allocation({ ...host, freeBytes: 3 * GiB }).slots, 2);
  assert.equal(
    allocation({ ...host, memoryLimit: 4 * GiB, memoryUsed: 2 * GiB }).slots,
    1,
  );
  assert.equal(allocation({ ...host, cpuLimit: 1 }).unitWorkers, 1);
  assert.equal(allocation({ ...host, freeBytes: GiB / 2 }).slots, 1);
  assert.equal(quotaCpus('150000 100000'), 1);
  assert.equal(quotaCpus('max 100000'), Infinity);
  assert.equal(quotaCpus('-1 100000'), Infinity);
  assert.equal(memoryLimit('max'), Infinity);
});
test('explicit bounds remain capped by capacity and invalid values fail early', () => {
  assert.equal(allocation(host, { LOCALCUT_TEST_SLOTS: '3' }).slots, 3);
  assert.equal(
    allocation(host, { LOCALCUT_BROWSER_WORKERS: '1' }).browserWorkers,
    1,
  );
  assert.equal(
    allocation({ ...host, cpus: 2 }, { LOCALCUT_UNIT_WORKERS: '8' })
      .unitWorkers,
    2,
  );
  for (const [key, value] of [
    ['LOCALCUT_TEST_SLOTS', '0'],
    ['LOCALCUT_TEST_SLOTS', '9'],
    ['LOCALCUT_UNIT_WORKERS', '1.5'],
    ['LOCALCUT_BROWSER_WORKERS', '5'],
    ['LOCALCUT_BROWSER_WORKERS', ''],
  ]) {
    assert.throws(
      () => allocation(host, { [key]: value }),
      /must be an integer/,
    );
  }
});
test('independent tasks overlap, shared dependencies wait, and the budget holds', async () => {
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const events = [];
  await schedule(
    [
      {
        id: 'unit',
        cost: 1,
        run: async () => {
          events.push('unit-start');
          await barrier;
          events.push('unit-end');
        },
      },
      {
        id: 'build',
        cost: 1,
        run: async () => {
          events.push('build');
          release();
        },
      },
      {
        id: 'browser',
        cost: 2,
        after: ['build'],
        run: async () => {
          events.push('browser');
        },
      },
    ],
    2,
  );
  assert.deepEqual(events, ['unit-start', 'build', 'unit-end', 'browser']);
});
test('failure drains started tasks and never starts dependent expensive work', async () => {
  const events = [];
  await assert.rejects(
    schedule(
      [
        {
          id: 'bad',
          cost: 1,
          run: async () => {
            throw new Error('lint failed');
          },
        },
        {
          id: 'peer',
          cost: 1,
          run: async () => {
            events.push('peer');
          },
        },
        {
          id: 'build',
          cost: 1,
          after: ['bad', 'peer'],
          run: async () => {
            events.push('build');
          },
        },
      ],
      2,
    ),
    /lint failed/,
  );
  assert.deepEqual(events, ['peer']);
});

test('available RAM counts reclaimable OS cache without counting active anonymous memory', () => {
  assert.equal(
    availableBytes('linux', 'MemAvailable: 4096 kB', 10),
    4096 * 1024,
  );
  assert.equal(
    availableBytes(
      'darwin',
      'page size of 16384 bytes\nPages free: 10.\nPages inactive: 50.\nPages speculative: 10.\nFile-backed pages: 40.',
      10,
    ),
    50 * 16384,
  );
  assert.equal(availableBytes('darwin', 'unavailable', 10), 10);
});

test('nested cgroups probe the process group and every enforcing ancestor', () => {
  assert.deepEqual(cgroupPaths('0::/parent/child', 'cpu'), [
    '/sys/fs/cgroup/parent/child',
    '/sys/fs/cgroup/parent',
    '/sys/fs/cgroup',
  ]);
  assert.deepEqual(cgroupPaths('5:memory:/job', 'memory'), [
    '/sys/fs/cgroup/memory/job',
    '/sys/fs/cgroup/memory',
  ]);
  assert.ok(
    cgroupPaths('4:cpu,cpuacct:/job', 'cpu').includes(
      '/sys/fs/cgroup/cpu,cpuacct/job',
    ),
  );
});
