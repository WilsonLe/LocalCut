import { setInterval, clearInterval } from 'node:timers';
import { spawn, execFileSync } from 'node:child_process';
import { cpus, availableParallelism } from 'node:os';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { root } from './build-state.mjs';
import { join } from 'node:path';
import { resources, normalBrowserEnv } from './test-resources.ts';
const [label, ...args] = process.argv.slice(2);
if (!label || !/^[a-zA-Z0-9_-]+$/.test(label) || !args.length)
  throw new Error(
    'Usage: pnpm test:profile <label> <pnpm test command and arguments>',
  );
if (
  ![
    'check',
    'test',
    'test:browser',
    'test:ui',
    'test:tooling',
    'test:safari',
    'test:transcription',
    'test:performance',
  ].includes(args[0])
)
  throw new Error(
    'Choose a local validation command (live providers are excluded).',
  );
const allocation = resources(
  ['check', 'test:browser', 'test:ui'].includes(args[0])
    ? normalBrowserEnv()
    : process.env,
);
const directory = join(root, '.artifacts', 'test-profiles');
const name = `${label}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
mkdirSync(directory, { recursive: true });
const log = createWriteStream(`${directory}/${name}.log`);
const initialCpu = cpus().map((cpu) => cpu.times);
const started = performance.now();
const executable = process.env.npm_execpath;
// Fail before launching work if the platform cannot provide process statistics.
execFileSync('ps', ['-axo', 'pid=,ppid=,time=,rss='], { timeout: 2000 });
const child = spawn(
  executable ? process.execPath : 'pnpm',
  executable ? [executable, ...args] : args,
  { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
);
let output = '';
for (const stream of [child.stdout, child.stderr])
  stream.on('data', (data) => {
    output += data.toString();
    log.write(data);
  });
const tracked = new Set([child.pid]);
const cpuTimes = new Map();
const samples = [];
function sample() {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,time=,rss='], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .map((line) => {
      const [pid, ppid, time, rss] = line.trim().split(/\s+/);
      const day = /^(\d+)-/.exec(time);
      const parts = time
        .replace(/^(\d+)-/, '')
        .split(':')
        .map(Number);
      return {
        pid: Number(pid),
        ppid: Number(ppid),
        seconds:
          Number(day?.[1] ?? 0) * 86400 +
          parts.reduce((sum, part) => sum * 60 + part, 0),
        rss: Number(rss) * 1024,
      };
    });
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows)
      if (tracked.has(row.ppid) && !tracked.has(row.pid)) {
        tracked.add(row.pid);
        changed = true;
      }
  }
  const live = rows.filter((row) => tracked.has(row.pid));
  for (const row of live)
    cpuTimes.set(row.pid, Math.max(cpuTimes.get(row.pid) ?? 0, row.seconds));
  samples.push({
    atMs: performance.now() - started,
    rssBytes: live.reduce((sum, row) => sum + row.rss, 0),
    processes: live.length,
  });
}
sample();
const timer = setInterval(sample, 500);
const result = await new Promise((resolve) => {
  child.once('error', (error) =>
    resolve({ code: 1, signal: null, error: error.message }),
  );
  child.once('close', (code, signal) => resolve({ code, signal }));
});
clearInterval(timer);
sample();
log.end();
const wallMs = performance.now() - started;
const totals = cpus().map((cpu, i) =>
  Object.fromEntries(
    Object.entries(cpu.times).map(([key, value]) => [
      key,
      value - initialCpu[i][key],
    ]),
  ),
);
const total = totals.reduce(
  (sum, cpu) => sum + Object.values(cpu).reduce((a, b) => a + b, 0),
  0,
);
const idle = totals.reduce((sum, cpu) => sum + cpu.idle, 0);
const scenarios = [...output.matchAll(/✓\s+\d+ .*? › (.+) \(([\d.]+)(ms|s)\)/g)]
  .map((match) => ({
    name: match[1],
    seconds: Number(match[2]) / (match[3] === 'ms' ? 1000 : 1),
  }))
  .sort((a, b) => a.seconds - b.seconds);
const gates =
  args[0] === 'check'
    ? [...output.matchAll(/\[check\] (\w+) (passed|failed) in ([\d.]+)s/g)]
        .map((match) => ({
          name: match[1],
          status: match[2],
          seconds: Number(match[3]),
        }))
        .filter((gate) =>
          [
            'format',
            'lint',
            'types',
            'tooling',
            'units',
            'builds',
            'bundle',
            'chrome',
          ].includes(gate.name),
        )
    : [];
const cpuSeconds = [...cpuTimes.values()].reduce((a, b) => a + b, 0);
const report = {
  label,
  args,
  allocation,
  samplingIntervalMs: 500,
  cpuMeasurement:
    'Lower bound from sampled cumulative descendant CPU times; short-lived processes may be missed. RSS sums include shared pages. Host busy includes unrelated work.',
  node: process.version,
  cpus: availableParallelism(),
  wallSeconds: wallMs / 1000,
  sampledCpuSeconds: cpuSeconds,
  averageCpuCores: cpuSeconds / (wallMs / 1000),
  hostBusyPercent: (100 * (total - idle)) / total,
  peakRssGiB: Math.max(...samples.map((s) => s.rssBytes)) / 1024 ** 3,
  result,
  gates,
  browserScenarios: scenarios.length
    ? {
        count: scenarios.length,
        p50Seconds: scenarios[Math.floor(scenarios.length * 0.5)].seconds,
        p95Seconds: scenarios[Math.floor(scenarios.length * 0.95)].seconds,
        slowest: scenarios.slice(-10).reverse(),
      }
    : undefined,
  samples,
};
writeFileSync(
  `${directory}/${name}.json`,
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    {
      ...report,
      samples: samples.length,
      reportPath: `${directory}/${name}.json`,
      logPath: `${directory}/${name}.log`,
    },
    null,
    2,
  ),
);
process.exitCode = result.code ?? 1;
