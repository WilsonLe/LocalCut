import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const skillsDirectory = fileURLToPath(
  new URL('../public/skills/', import.meta.url),
);

/** Derive discovery metadata from the same bytes served as portable skills. */
export async function skillIndex(directory) {
  const skills = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    assert(
      /^localcut-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name) &&
        entry.name.length <= 64,
      `Invalid skill folder: ${entry.name}`,
    );
    const bytes = await readFile(join(directory, entry.name, 'SKILL.md'));
    const content = bytes.toString('utf8');
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(content)?.[1];
    assert(frontmatter, `Missing skill frontmatter: ${entry.name}`);
    const field = (key) =>
      new RegExp(`^${key}: (.+)$`, 'm').exec(frontmatter)?.[1];
    assert.equal(field('name'), entry.name, 'Skill name must match its folder');
    const description = field('description');
    assert(
      description && description.length <= 1024,
      `Invalid description: ${entry.name}`,
    );
    assert.equal(field('license'), 'MIT');
    assert(
      (
        await readFile(join(directory, entry.name, 'LICENSE.txt'), 'utf8')
      ).includes('Copyright (c) 2026 Wilson Le'),
      `Missing skill attribution: ${entry.name}`,
    );
    skills.push({
      name: entry.name,
      description,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  assert(skills.length, 'Missing LocalCut skills');
  return { version: 1, skills };
}

export async function checkSkills(directory = skillsDirectory) {
  const actual = JSON.parse(
    await readFile(join(directory, 'index.json'), 'utf8'),
  );
  assert.deepEqual(
    actual,
    await skillIndex(directory),
    'Skill index is stale or incomplete. Run node scripts/skills-index.mjs --write after editing skill files.',
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.includes('--write')) {
    await writeFile(
      join(skillsDirectory, 'index.json'),
      JSON.stringify(await skillIndex(skillsDirectory), null, 2) + '\n',
    );
  } else {
    await checkSkills();
    console.log('LocalCut skill metadata, licenses and content hashes match.');
  }
}
