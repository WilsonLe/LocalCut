import { availableParallelism, freemem, loadavg, totalmem } from 'node:os';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const GiB = 1024 ** 3;
const read = (path: string) => {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return '';
  }
};
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
export function override(value: string | undefined, name: string, max: number) {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value) || Number(value) > max)
    throw new Error(`${name} must be an integer from 1 to ${max}.`);
  return Number(value);
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
export function allocation(capacity: Capacity, env: NodeJS.ProcessEnv = {}) {
  const cpus = Math.max(
    1,
    Math.floor(Math.min(capacity.cpus, capacity.cpuLimit ?? Infinity)),
  );
  const memory = Math.min(
    capacity.freeBytes,
    (capacity.memoryLimit ?? capacity.totalBytes) - (capacity.memoryUsed ?? 0),
  );
  // Leave room for the desktop/OS. Each slot reserves ~1 GiB; browser workers cost two slots.
  const memorySlots = Math.max(1, Math.floor((memory - GiB) / GiB));
  const idleCpus = Math.max(1, cpus - Math.ceil(capacity.load));
  const automatic = Math.max(1, Math.min(8, idleCpus, memorySlots));
  const requested = override(env.LOCALCUT_TEST_SLOTS, 'LOCALCUT_TEST_SLOTS', 8);
  const slots = Math.min(requested ?? automatic, cpus, memorySlots);
  return {
    slots,
    unitWorkers: Math.min(
      override(env.LOCALCUT_UNIT_WORKERS, 'LOCALCUT_UNIT_WORKERS', 8) ?? slots,
      slots,
    ),
    browserWorkers: Math.min(
      override(env.LOCALCUT_BROWSER_WORKERS, 'LOCALCUT_BROWSER_WORKERS', 4) ??
        4,
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
export function resources(env: NodeJS.ProcessEnv = process.env) {
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
      load: loadavg()[0] ?? 0,
      cpuLimit: Math.min(...cpus),
    },
    env,
  );
}
