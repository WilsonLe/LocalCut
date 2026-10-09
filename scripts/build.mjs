import { inputHash, recordBuild, runPnpm, target } from './build-state.mjs';

const rootBuild = process.argv.includes('--root');
const build = target(rootBuild);
const input = await inputHash(build);
await runPnpm([
  'exec',
  'vite',
  'build',
  ...(rootBuild ? ['--base=/', '--outDir', 'dist-root'] : []),
]);
await runPnpm([
  'exec',
  'tsc',
  '-p',
  'tsconfig.types.json',
  ...(rootBuild ? ['--outDir', 'dist-root/types'] : []),
]);
await recordBuild(build, input);
