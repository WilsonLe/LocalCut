import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  copyFile,
  readFile,
  writeFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkSkills,
  skillIndex,
  skillsDirectory,
} from '../../scripts/skills-index.mjs';

test('published index covers every skill with current metadata and exact content hashes', async () => {
  await checkSkills();
});

test('new/changed/misnamed skills cannot silently drift from discovery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'localcut-skills-'));
  try {
    const name = 'localcut-start';
    await mkdir(join(directory, name));
    for (const file of ['SKILL.md', 'LICENSE.txt'])
      await copyFile(
        join(skillsDirectory, name, file),
        join(directory, name, file),
      );
    await writeFile(
      join(directory, 'index.json'),
      JSON.stringify(await skillIndex(directory)),
    );
    await checkSkills(directory);
    const path = join(directory, name, 'SKILL.md');
    const original = await readFile(path, 'utf8');
    await writeFile(path, original + '\nAdditional guidance.\n');
    await assert.rejects(checkSkills(directory), /stale or incomplete/);
    await writeFile(
      path,
      original.replace('name: localcut-start', 'name: localcut-other'),
    );
    await assert.rejects(skillIndex(directory), /match its folder/);
    await writeFile(path, original);
    await mkdir(join(directory, 'localcut-added'));
    await assert.rejects(checkSkills(directory), /ENOENT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
