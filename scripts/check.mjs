import { runPnpm, ensureBuilds } from './build-state.mjs';
import {
  resources,
  poolMaxCost,
  normalBrowserEnv,
  browserWorkerCost,
} from './test-resources.ts';
import { schedule } from './test-scheduler.mjs';

const initial = resources();
console.log('LocalCut initial test resources:', JSON.stringify(initial));
const env = process.env;
const chromeEnv = normalBrowserEnv(env);
const poolEnv = (cost, browser = false) => ({
  ...env,
  LOCALCUT_TEST_SLOTS: String(cost),
  LOCALCUT_TEST_GRANTED_SLOTS: String(cost),
  [browser ? 'LOCALCUT_BROWSER_WORKERS' : 'LOCALCUT_UNIT_WORKERS']: String(
    browser
      ? Math.max(1, Math.floor(cost / browserWorkerCost(chromeEnv)))
      : cost,
  ),
});
const tasks = [
  { id: 'format', cost: 1, run: () => runPnpm(['format:check'], env) },
  { id: 'lint', cost: 1, run: () => runPnpm(['lint'], env) },
  { id: 'types', cost: 2, run: () => runPnpm(['typecheck'], env) },
  { id: 'tooling', cost: 1, run: () => runPnpm(['test:tooling'], env) },
  {
    id: 'builds',
    after: ['format', 'lint', 'types', 'tooling'],
    cost: 2,
    run: () => ensureBuilds(env),
  },
  {
    id: 'units',
    after: ['format', 'lint', 'types', 'tooling'],
    cost: 1,
    maxCost: poolMaxCost(env),
    run: ({ cost }) => runPnpm(['test'], poolEnv(cost)),
  },
  {
    id: 'bundle',
    after: ['builds'],
    cost: 1,
    run: () => runPnpm(['check:bundle'], env),
  },
  {
    id: 'chrome',
    after: ['bundle', 'units'],
    cost: browserWorkerCost(chromeEnv),
    maxCost: poolMaxCost(chromeEnv, true),
    run: ({ cost }) => runPnpm(['test:browser'], poolEnv(cost, true)),
  },
];
await schedule(tasks, (used) => resources(env, used).slots);
