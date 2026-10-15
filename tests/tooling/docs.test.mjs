import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDocuments } from '../../scripts/check-docs.mjs';

test('documentation links resolve Markdown syntax, encoded paths, headings and explicit IDs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localcut-docs-'));
  try {
    await mkdir(join(root, 'docs'));
    await writeFile(
      join(root, 'docs', 'target file.md'),
      '# Hello **world**!\n## Repeated\n## Repeated\n## Repeated-1\n## Repeated\n<a id="custom"></a>\n',
    );
    await writeFile(join(root, 'image.png'), 'synthetic image');
    await writeFile(
      join(root, 'README.md'),
      `# Intro
[inline](docs/target%20file.md#hello-world)
[space](<docs/target file.md#repeated-1>)
[collision](docs/target%20file.md#repeated-1-1)
[later](docs/target%20file.md#repeated-2)
[custom](docs/target%20file.md#custom)
[reference][target]
[target]: docs/target%20file.md#repeated
![image](image.png)
[root](/docs/target%20file.md)
[self](#intro)
[external](https://example.invalid/no-request)
[mail](mailto:test@example.invalid)
\`[example](missing.md)\`
\`\`\`md
[example](missing.md)
\`\`\`
`,
    );
    assert.deepEqual(await checkDocuments(root, ['README.md']), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('documentation failures identify the source line and broken file, anchor, image or encoding', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localcut-docs-'));
  try {
    await writeFile(
      join(root, 'README.md'),
      '# Intro\n[file](gone.md)\n[anchor](#gone)\n![image](gone.png)\n[encoded](%xx.md)\n[outside](../README.md)\n[reference][target]\n\n[target]: #missing\n',
    );
    const failures = await checkDocuments(root, ['README.md']);
    assert.deepEqual(
      failures.map(({ line }) => line),
      [2, 3, 4, 5, 6, 7],
    );
    assert.match(failures[0].message, /target does not exist/);
    assert.match(failures[1].message, /anchor does not exist/);
    assert.match(failures[3].message, /encoding/);
    assert.match(failures[4].message, /escapes/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
