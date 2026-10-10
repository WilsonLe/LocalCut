import { ensureBuilds, runPnpm } from './build-state.mjs';

const env = { ...process.env, LOCALCUT_BASE_PATH: '/LocalCut/' };
await ensureBuilds(env);
await runPnpm(
  ['test:browser', 'tests/browser/workspace', ...process.argv.slice(2)],
  env,
);
