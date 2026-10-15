import { pathToFileURL } from 'node:url';
import { runPnpm, ensureBuilds } from './build-state.mjs';
import {
  resources,
  poolMaxCost,
  normalBrowserEnv,
  browserWorkerCost,
  sampleResources,
} from './test-resources.ts';
import { schedule } from './test-scheduler.mjs';

export async function runChecks(
  env = process.env,
  {
    run = runPnpm,
    build = ensureBuilds,
    getResources = resources,
    sample = sampleResources,
  } = {},
) {
  const chromeEnv = normalBrowserEnv(env);
  const initial = await sample(env);
  console.log(
    'LocalCut initial static test resources:',
    JSON.stringify(initial),
  );
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
  await schedule(
    [
      { id: 'format', cost: 1, run: () => run(['format:check'], env) },
      { id: 'lint', cost: 1, run: () => run(['lint'], env) },
      { id: 'docs', cost: 1, run: () => run(['check:docs'], env) },
      { id: 'types', cost: 2, run: () => run(['typecheck'], env) },
      { id: 'tooling', cost: 1, run: () => run(['test:tooling'], env) },
      {
        id: 'builds',
        after: ['format', 'docs', 'lint', 'types', 'tooling'],
        cost: 2,
        run: () => build(env),
      },
      {
        id: 'units',
        after: ['format', 'docs', 'lint', 'types', 'tooling'],
        cost: 1,
        maxCost: poolMaxCost(env),
        run: ({ cost }) => run(['test'], poolEnv(cost)),
      },
      {
        id: 'bundle',
        after: ['builds'],
        cost: 1,
        run: () => run(['check:bundle'], env),
      },
    ],
    (used) => getResources(env, used).slots,
  );
  // Only Chrome gets the smaller shared-context reservation. Earlier failures
  // drain the ordinary phase and prevent this admission entirely.
  // Refresh CPU deltas after builds drain before the scheduler grants the pool.
  // The child cannot grow a grant narrowed by already-finished static work.
  await sample(chromeEnv);
  await schedule(
    [
      {
        id: 'chrome',
        cost: browserWorkerCost(chromeEnv),
        maxCost: poolMaxCost(chromeEnv, true),
        run: ({ cost }) => run(['test:browser'], poolEnv(cost, true)),
      },
    ],
    (used) => getResources(chromeEnv, used).slots,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runChecks();
