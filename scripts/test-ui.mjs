import { ensureBuilds, runPnpm } from './build-state.mjs';

const env = { ...process.env, LOCALCUT_BASE_PATH: '/LocalCut/' };
await ensureBuilds(env);
await runPnpm(
  [
    'exec',
    'playwright',
    'test',
    '--project=chrome',
    'tests/browser/workspace',
    ...process.argv.slice(2),
  ],
  env,
);
