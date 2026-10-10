import {
  availableParallelism,
  cpus as cpuInfo,
  freemem,
  loadavg,
  totalmem,
} from 'node:os';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const GiB = 1024 ** 3;
const slotBytes = 0.75 * GiB;
const read = (path: string) => {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return '';
  }
};
// Normal acceptance favors reusing one browser. Explicit overrides still use
// the shared live CPU/memory policy; heavyweight projects keep their own gate.
export function normalBrowserEnv(env: NodeJS.ProcessEnv = process.env) {
  return {
    ...env,
    LOCALCUT_BROWSER_WORKERS: env.LOCALCUT_BROWSER_WORKERS ?? '1',
  };
}
export function availableBytes(
  platform: string,
  statistics: string,
  fallback: number,
) {
  if (platform === 'linux') {
    const available = /MemAvailable:\s+(\d+) kB/.exec(statistics);
    return available ? Number(available[1]) * 1024 : fallback;
  }
  if (platform === 'darwin') {
    const pageSize = Number(/page size of (\d+) bytes/.exec(statistics)?.[1]);
    const pages = (name: string) =>
      Number(new RegExp(name + ':\\s+(\\d+)').exec(statistics)?.[1] ?? 0);
    if (pageSize > 0)
      return (
        (pages('Pages free') +
          Math.min(
            pages('Pages inactive') + pages('Pages speculative'),
            pages('File-backed pages'),
          )) *
        pageSize
      );
  }
  return fallback;
}
function availableMemory() {
  let stats = read('/proc/meminfo');
  if (process.platform === 'darwin') {
    try {
      stats = execFileSync('/usr/bin/vm_stat', {
        encoding: 'utf8',
        timeout: 1000,
      });
    } catch {
      /* fall back to free memory */
    }
  }
  return availableBytes(process.platform, stats, freemem());
}
export function quotaCpus(value: string) {
  const [quota, period] = value.split(/\s+/).map(Number);
  return quota! > 0 && period! > 0
    ? Math.max(1, Math.floor(quota! / period!))
    : Infinity;
}
export function memoryLimit(value: string) {
  const bytes = Number(value);
  return bytes > 0 ? bytes : Infinity;
}
export function override(
  value: string | undefined,
  name: string,
  max = Number.MAX_SAFE_INTEGER,
) {
  if (value === undefined) return undefined;
  if (
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > max
  )
    throw new Error(`${name} must be an integer from 1 to ${max}.`);
  return Number(value);
}
export function poolMaxCost(env: NodeJS.ProcessEnv = {}, browser = false) {
  const name = browser ? 'LOCALCUT_BROWSER_WORKERS' : 'LOCALCUT_UNIT_WORKERS';
  const workers = override(env[name], name);
  // The scheduler's refreshed budget limits automatic pools at launch. A
  // startup CPU count would prevent growth after quota or affinity recovery.
  return workers === undefined
    ? Number.MAX_SAFE_INTEGER
    : Math.min(Number.MAX_SAFE_INTEGER, workers * (browser ? 2 : 1));
}
export interface Capacity {
  cpus: number;
  freeBytes: number;
  totalBytes: number;
  load: number;
  cpuLimit?: number;
  memoryLimit?: number;
  memoryUsed?: number;
}
export function allocation(
  capacity: Capacity,
  env: NodeJS.ProcessEnv = {},
  reservedSlots = 0,
) {
  const cpus = Math.max(
    1,
    Math.floor(Math.min(capacity.cpus, capacity.cpuLimit ?? Infinity)),
  );
  const memory = Math.min(
    capacity.freeBytes,
    (capacity.memoryLimit ?? capacity.totalBytes) - (capacity.memoryUsed ?? 0),
  );
  // Profiled slots reserve 0.75 GiB; Chrome reserves two (1.5 GiB). Keep one GiB for the OS.
  // Running tasks are already reflected in load/free RAM: add their reservation back once.
  const memorySlots = Math.max(
    1,
    reservedSlots + Math.floor((memory - GiB) / slotBytes),
  );
  const idleCpus = Math.max(
    1,
    cpus - Math.ceil(Math.max(0, capacity.load - reservedSlots)),
  );
  // A child runner consumes a freshly measured scheduler grant. Do not subtract
  // the parent's stale load a second time; CPU/quota/RAM limits still apply.
  const granted = override(
    env.LOCALCUT_TEST_GRANTED_SLOTS,
    'LOCALCUT_TEST_GRANTED_SLOTS',
  );
  const automatic = Math.max(
    1,
    Math.min(granted ?? idleCpus, cpus, memorySlots),
  );
  const requested = override(env.LOCALCUT_TEST_SLOTS, 'LOCALCUT_TEST_SLOTS');
  const slots = Math.min(requested ?? automatic, automatic);
  return {
    slots,
    unitWorkers: Math.min(
      override(env.LOCALCUT_UNIT_WORKERS, 'LOCALCUT_UNIT_WORKERS') ?? slots,
      slots,
    ),
    browserWorkers: Math.min(
      override(env.LOCALCUT_BROWSER_WORKERS, 'LOCALCUT_BROWSER_WORKERS') ??
        slots,
      Math.max(1, Math.floor(slots / 2)),
    ),
    cpus,
    freeGiB: Math.round((memory / GiB) * 10) / 10,
  };
}
export function cgroupPaths(membership: string, controller: string) {
  const paths = new Set<string>();
  const v2 = membership
    .split('\n')
    .find((line) => line.startsWith('0::'))
    ?.slice(3);
  const v1 = membership
    .split('\n')
    .map((line) => line.split(':'))
    .find((parts) => parts[1]?.split(',').includes(controller))?.[2];
  const bases =
    v2 !== undefined
      ? ['/sys/fs/cgroup']
      : controller === 'cpu'
        ? ['/sys/fs/cgroup/cpu', '/sys/fs/cgroup/cpu,cpuacct']
        : ['/sys/fs/cgroup/memory'];
  for (const base of bases) {
    let directory = join(base, v2 ?? v1 ?? '/');
    // A cgroup namespace can expose only the mount root. Probe it and visible ancestors as well.
    while (directory.startsWith(base)) {
      paths.add(directory);
      if (directory === base) break;
      directory = dirname(directory);
    }
    paths.add(base);
  }
  return [...paths];
}
export interface CpuSnapshot {
  at: number;
  total: number;
  idle: number;
}
export function cpuLoad(
  previous: CpuSnapshot,
  current: CpuSnapshot,
  cpus: number,
) {
  const total = current.total - previous.total;
  return total > 0
    ? cpus *
        Math.max(0, Math.min(1, 1 - (current.idle - previous.idle) / total))
    : undefined;
}
let previousCpu: CpuSnapshot | undefined;
let measuredLoad: number | undefined;
function currentLoad() {
  const times = cpuInfo().map((cpu) => cpu.times);
  const snapshot = {
    at: performance.now(),
    total: times.reduce(
      (sum, time) => sum + Object.values(time).reduce((a, b) => a + b, 0),
      0,
    ),
    idle: times.reduce((sum, time) => sum + time.idle, 0),
  };
  if (!previousCpu) previousCpu = snapshot;
  else if (snapshot.at - previousCpu.at >= 100) {
    measuredLoad = cpuLoad(previousCpu, snapshot, availableParallelism());
    previousCpu = snapshot;
  }
  return measuredLoad ?? loadavg()[0] ?? 0;
}
export function resources(
  env: NodeJS.ProcessEnv = process.env,
  reservedSlots = 0,
) {
  const membership = read('/proc/self/cgroup');
  const cpus = cgroupPaths(membership, 'cpu').flatMap((directory) => [
    quotaCpus(read(directory + '/cpu.max')),
    quotaCpus(
      `${read(directory + '/cpu.cfs_quota_us')} ${read(directory + '/cpu.cfs_period_us')}`,
    ),
  ]);
  const memory = cgroupPaths(membership, 'memory').map((directory) => {
    const limit = memoryLimit(
      read(directory + '/memory.max') ||
        read(directory + '/memory.limit_in_bytes'),
    );
    const used =
      Number(
        read(directory + '/memory.current') ||
          read(directory + '/memory.usage_in_bytes'),
      ) || 0;
    return limit - used;
  });
  return allocation(
    {
      cpus: availableParallelism(),
      freeBytes: Math.min(availableMemory(), ...memory),
      totalBytes: totalmem(),
      load: currentLoad(),
      cpuLimit: Math.min(...cpus),
    },
    env,
    reservedSlots,
  );
}
