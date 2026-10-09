import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

if (process.platform !== 'darwin')
  throw new Error('This installer targets macOS CI');
const run = promisify(execFile);
const root = await mkdtemp(
  join(process.env.RUNNER_TEMP ?? tmpdir(), 'localcut-chrome-'),
);
const image = join(root, 'chrome.dmg');
const mount = join(root, 'mount');
const app = join(root, 'Google Chrome.app');
const binary = join(app, 'Contents/MacOS/Google Chrome');
await mkdir(mount);
await run('curl', [
  '--fail',
  '--location',
  '--silent',
  '--show-error',
  '--retry',
  '3',
  '--connect-timeout',
  '30',
  '--max-time',
  '600',
  'https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg',
  '--output',
  image,
]);
await run('hdiutil', [
  'attach',
  '-nobrowse',
  '-readonly',
  '-mountpoint',
  mount,
  image,
]);
try {
  // Preserve the complete signed application bundle and its native helpers.
  await run('ditto', [join(mount, 'Google Chrome.app'), app]);
} finally {
  await run('hdiutil', ['detach', mount]);
  await rm(image);
}
await run('codesign', ['--verify', '--deep', '--strict', app]);
const { stdout } = await run(binary, ['--version']);
console.log('chrome-path=' + binary);
console.log('chrome-version=' + stdout.trim());
