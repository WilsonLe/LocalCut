import { buildStatus, runPnpm, target } from './build-state.mjs';

// UI tests exercise both static base paths. Their cache is separate from dist.
const env = { ...process.env, LOCALCUT_BASE_PATH: '/LocalCut/' };
for (const rootBuild of [false, true]) {
  const build = target(rootBuild, env.LOCALCUT_BASE_PATH);
  const status = await buildStatus(build);
  if (status.current)
    console.log(`Reusing ${build.directory}: ${status.reason}.`);
  else {
    console.log(`Building ${build.directory}: ${status.reason}.`);
    await runPnpm(['run', rootBuild ? 'build:root' : 'build'], env);
  }
}
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
