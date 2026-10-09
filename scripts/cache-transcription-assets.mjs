import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  requiredUrls,
  modelHashes,
  runtimeHashes,
  MODEL_REVISION,
} from '../src/services/transcription-config.ts';
const run = promisify(execFile),
  root = '.cache/asr-' + MODEL_REVISION;
await mkdir(root, { recursive: true });
const manifest = [];
for (const url of requiredUrls()) {
  const name = new URL(url).pathname.split('/').pop(),
    file = root + '/' + name,
    expected = modelHashes[name] ?? runtimeHashes[name];
  let data;
  try {
    data = await readFile(file);
  } catch {
    const temp = file + '.partial';
    await run('curl', [
      '--fail',
      '--location',
      '--silent',
      '--show-error',
      '--retry',
      '3',
      url,
      '--output',
      temp,
    ]);
    await rename(temp, file);
    data = await readFile(file);
  }
  const digest = createHash('sha256').update(data).digest('hex');
  if (expected && digest !== expected) {
    await rm(file);
    throw new Error('Cached asset checksum mismatch: ' + name);
  }
  if (!expected) JSON.parse(data.toString('utf8'));
  manifest.push({ url, name, sha256: digest, size: data.length });
}
await writeFile(
  root + '/manifest.json',
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(
  'Verified ' + manifest.length + ' transcription test assets in ' + root,
);
