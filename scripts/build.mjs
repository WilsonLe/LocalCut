import { inputHash, recordBuild, runPnpm, target } from './build-state.mjs';
import { mkdir, rename } from 'node:fs/promises';
import { fontSnapshot } from './font-snapshot.ts';

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
// Move rather than duplicate the catalog. Its URL identifies the snapshot,
// so old HTTP cache entries cannot be combined with a new family manifest.
const revision = fontSnapshot();
await rename(`${build.directory}/fonts`, `${build.directory}/.fonts-snapshot`);
await mkdir(`${build.directory}/fonts`);
await rename(
  `${build.directory}/.fonts-snapshot`,
  `${build.directory}/fonts/${revision}`,
);
await recordBuild(build, input);
