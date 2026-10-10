import { runPnpm, ensureBuilds } from './build-state.mjs';
import { resources } from './test-resources.ts';
import { schedule } from './test-scheduler.mjs';

const budget = resources();
console.log('LocalCut test resources:', JSON.stringify(budget));
const unitWorkers = Math.max(1, Math.min(4, Math.floor(budget.slots / 2)));
const env = {
  ...process.env,
  LOCALCUT_UNIT_WORKERS: String(Math.min(unitWorkers, budget.unitWorkers)),
  LOCALCUT_BROWSER_WORKERS: String(budget.browserWorkers),
};
const tasks = [
  { id: 'format', cost: 1, run: () => runPnpm(['format:check'], env) },
  { id: 'lint', cost: 1, run: () => runPnpm(['lint'], env) },
  { id: 'types', cost: 2, run: () => runPnpm(['typecheck'], env) },
  { id: 'tooling', cost: 1, run: () => runPnpm(['test:tooling'], env) },
  {
    id: 'units',
    after: ['format', 'lint', 'types', 'tooling'],
    cost: unitWorkers,
    run: () => runPnpm(['test'], env),
  },
  {
    id: 'builds',
    after: ['format', 'lint', 'types', 'tooling'],
    cost: 2,
    run: () => ensureBuilds(env),
  },
  {
    id: 'bundle',
    after: ['builds'],
    cost: 1,
    run: () => runPnpm(['check:bundle'], env),
  },
  {
    id: 'chrome',
    after: ['bundle'],
    cost: budget.browserWorkers * 2,
    run: () => runPnpm(['test:browser'], env),
  },
];
await schedule(tasks, budget.slots);
