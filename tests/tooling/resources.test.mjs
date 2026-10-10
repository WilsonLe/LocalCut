import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cgroupPaths,
  availableBytes,
  allocation,
  cpuLoad,
  quotaCpus,
  memoryLimit,
  poolMaxCost,
} from '../../scripts/test-resources.ts';
import { schedule } from '../../scripts/test-scheduler.mjs';
const GiB = 1024 ** 3;
const host = { cpus: 16, freeBytes: 20 * GiB, totalBytes: 32 * GiB, load: 0 };
test('limits workers by idle CPU, free memory, affinity and cgroup quotas', () => {
  assert.equal(allocation(host).slots, 16);
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
    ['LOCALCUT_TEST_SLOTS', '9007199254740992'],
    ['LOCALCUT_UNIT_WORKERS', '1.5'],
    ['LOCALCUT_BROWSER_WORKERS', '-1'],
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

test('large hosts scale past old ceilings, narrowing overrides never exceed live headroom', () => {
  const large = {
    ...host,
    cpus: 64,
    freeBytes: 80 * GiB,
    totalBytes: 128 * GiB,
  };
  assert.equal(allocation(large).slots, 64);
  assert.equal(allocation(large).browserWorkers, 32);
  assert.equal(
    allocation(large, { LOCALCUT_UNIT_WORKERS: '40' }).unitWorkers,
    40,
  );
  assert.equal(
    allocation({ ...large, load: 60 }, { LOCALCUT_TEST_SLOTS: '64' }).slots,
    4,
  );
  assert.equal(
    allocation(host, { LOCALCUT_TEST_SLOTS: '1' }).browserWorkers,
    1,
  );
});

test('running reservations are accounted once while external pressure narrows new launches', () => {
  assert.equal(
    allocation({ ...host, load: 8, freeBytes: 12 * GiB }, {}, 8).slots,
    16,
  );
  assert.equal(
    allocation({ ...host, load: 15, freeBytes: 2 * GiB }, {}, 4).slots,
    5,
  );
});

test('scheduler refreshes capacity while tasks run and grows an elastic pool after recovery', async () => {
  let slots = 1;
  const events = [];
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const run = schedule(
    [
      {
        id: 'peer',
        cost: 1,
        run: async () => {
          events.push('peer');
          await barrier;
        },
      },
      {
        id: 'pool',
        cost: 1,
        maxCost: 8,
        run: ({ cost }) => {
          events.push(cost);
          release();
        },
      },
    ],
    () => slots,
    { pollMs: 5 },
  );
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(events, ['peer']);
  slots = 8;
  await run;
  assert.deepEqual(events, ['peer', 7]);
});

test('pool launches follow recovered CPU quotas while explicit worker limits narrow capacity', async () => {
  for (const browser of [false, true]) {
    for (const narrowed of [false, true]) {
      let cpuLimit = 2;
      const env = narrowed
        ? {
            [browser ? 'LOCALCUT_BROWSER_WORKERS' : 'LOCALCUT_UNIT_WORKERS']:
              '3',
          }
        : {};
      const maxCost = poolMaxCost(env, browser);
      let workers;
      await schedule(
        [
          {
            id: 'static',
            cost: 1,
            run: () => {
              cpuLimit = 18;
            },
          },
          {
            id: 'pool',
            after: ['static'],
            cost: browser ? 2 : 1,
            maxCost,
            run: ({ cost }) => {
              workers = browser ? Math.floor(cost / 2) : cost;
            },
          },
        ],
        () => allocation({ ...host, cpus: 18, cpuLimit }, env).slots,
      );
      assert.equal(workers, narrowed ? 3 : browser ? 9 : 18);
    }
  }
});

test('shrinking budgets drain running tasks before admitting another pool', async () => {
  let slots = 4;
  const events = [];
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  setTimeout(() => release(), 20);
  await schedule(
    [
      {
        id: 'first',
        cost: 4,
        run: async () => {
          slots = 1;
          await barrier;
          events.push('first');
        },
      },
      {
        id: 'next',
        cost: 2,
        maxCost: 8,
        run: ({ cost }) => {
          events.push(cost);
        },
      },
    ],
    () => slots,
    { pollMs: 5 },
  ).then(() => assert.deepEqual(events, ['first', 1]));
  // Release via a timer so the scheduler also observes pressure while the first task runs.
});

test('recent CPU deltas reflect pressure recovery without waiting for one-minute load averages', () => {
  const previous = { at: 0, total: 1000, idle: 500 };
  assert.equal(cpuLoad(previous, { at: 1000, total: 2000, idle: 1000 }, 18), 9);
  assert.equal(cpuLoad(previous, { at: 1000, total: 2000, idle: 1500 }, 18), 0);
  assert.equal(cpuLoad(previous, previous, 18), undefined);
});

test('nested runner grants avoid subtracting parent load twice but retain RAM/quota and narrowing bounds', () => {
  const env = { LOCALCUT_TEST_GRANTED_SLOTS: '10', LOCALCUT_TEST_SLOTS: '10' };
  assert.equal(allocation({ ...host, load: 14 }, env).unitWorkers, 10);
  assert.equal(
    allocation({ ...host, load: 14, freeBytes: 3 * GiB }, env).slots,
    2,
  );
  assert.equal(allocation({ ...host, load: 14, cpuLimit: 4 }, env).slots, 4);
  assert.equal(
    allocation(host, { ...env, LOCALCUT_UNIT_WORKERS: '1' }).unitWorkers,
    1,
  );
  assert.throws(() => allocation(host, { LOCALCUT_TEST_GRANTED_SLOTS: '0' }));
});
