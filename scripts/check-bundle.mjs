import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { checkFonts } from './check-fonts.mjs';
async function files(path) {
  const result = [];
  for (const name of await readdir(path)) {
    const full = join(path, name);
    if ((await stat(full)).isDirectory()) result.push(...(await files(full)));
    else result.push(full);
  }
  return result;
}
for (const root of ['dist', 'dist-root']) {
  const fontFiles = await checkFonts(root);
  const manifest = JSON.parse(
    await readFile(`${root}/.vite/manifest.json`, 'utf8'),
  );
  const entry = Object.values(manifest).find(
    (v) => v.isEntry && v.src === 'index.html',
  );
  assert(entry, 'App manifest entry missing');
  const optionalEntries = new Set(['editor.js', 'ai.js']);
  for (const name of ['editor', 'ai']) {
    const moduleEntry = Object.values(manifest).find(
      (v) => v.isEntry && v.src === `src/${name}/index.ts`,
    );
    assert(
      moduleEntry?.file.startsWith(`assets/${name}-`) &&
        moduleEntry.file.endsWith('.js'),
      `Hashed ${name} entry missing`,
    );
    optionalEntries.add(moduleEntry.file);
    assert.equal(
      await readFile(`${root}/${name}.js`, 'utf8'),
      `export * from './${moduleEntry.file}';\n`,
      `Stable ${name} alias does not match its manifest entry`,
    );
    await stat(`${root}/types/${name}/index.d.ts`);
  }
  const graph = new Set();
  function visit(chunk) {
    if (graph.has(chunk.file)) return;
    graph.add(chunk.file);
    for (const css of chunk.css ?? []) graph.add(css);
    for (const id of chunk.imports ?? []) visit(manifest[id]);
  }
  visit(entry);
  let js = 0,
    css = 0,
    total = 0;
  for (const path of graph) {
    const bytes = gzipSync(await readFile(`${root}/${path}`)).length;
    if (path.endsWith('.js')) js += bytes;
    if (path.endsWith('.css')) css += bytes;
  }
  for (const file of await files(root)) {
    assert(
      !/\.(onnx|wasm|woff2?)$/.test(file) || fontFiles.has(file),
      'Heavy model/runtime/font artifact shipped: ' + file,
    );
    assert(
      !file.includes('harness') && !file.includes('fixture'),
      'Test artifact shipped',
    );
    if (/\.(js|css)$/.test(file))
      total += gzipSync(await readFile(file)).length;
  }
  assert(js <= 150 * 1024, `Initial JS ${js}`);
  assert(css <= 30 * 1024, `Initial CSS ${css}`);
  assert(total <= 5 * 1024 * 1024, `Aggregate JS/CSS ${total}`);
  assert(
    ![...graph].some((p) => optionalEntries.has(p) || p.includes('worker')),
    'Engine or AI eagerly loaded',
  );
  console.log(
    JSON.stringify({
      root,
      initialJavaScriptGzip: js,
      initialCssGzip: css,
      aggregateGzip: total,
    }),
  );
}
