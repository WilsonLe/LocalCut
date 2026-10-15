import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import { pathToFileURL } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';

const parser = unified().use(remarkParse);
function visit(node, callback) {
  callback(node);
  for (const child of node.children ?? []) visit(child, callback);
}
function headingText(node) {
  if (node.type === 'html') return '';
  return (
    node.value ?? node.alt ?? (node.children ?? []).map(headingText).join('')
  );
}

/** GitHub-style heading IDs, including duplicate suffixes and explicit HTML IDs. */
export function anchors(tree) {
  const ids = new Set();
  visit(tree, (node) => {
    if (node.type === 'heading') {
      const base = headingText(node)
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}_ -]/gu, '')
        .replace(/ /g, '-');
      let id = base;
      for (let index = 1; ids.has(id); index++) id = `${base}-${index}`;
      ids.add(id);
    }
    if (node.type === 'html')
      for (const match of node.value.matchAll(
        /\b(?:id|name)=["']([^"']+)["']/g,
      ))
        ids.add(match[1]);
  });
  return ids;
}

/** Check parsed Markdown links only; code examples and external URLs are inert. */
export async function checkDocuments(root, files) {
  root = resolve(root);
  const documents = new Map();
  const load = (path) => {
    if (!documents.has(path))
      documents.set(
        path,
        readFile(path, 'utf8').then((text) => parser.parse(text)),
      );
    return documents.get(path);
  };
  const failures = [];
  for (const file of files) {
    const source = resolve(root, file);
    const tree = await load(source);
    const definitions = new Map();
    const links = [];
    visit(tree, (node) => {
      if (node.type === 'definition' && !definitions.has(node.identifier))
        definitions.set(node.identifier, node.url);
      if (
        ['link', 'image', 'linkReference', 'imageReference'].includes(node.type)
      )
        links.push(node);
    });
    for (const link of links) {
      const url = link.url ?? definitions.get(link.identifier);
      if (!url || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) continue;
      const fail = (message) =>
        failures.push({
          file,
          line: link.position.start.line,
          url,
          message,
        });
      let path, fragment;
      try {
        const hash = url.indexOf('#');
        fragment = hash < 0 ? '' : decodeURIComponent(url.slice(hash + 1));
        const raw = (hash < 0 ? url : url.slice(0, hash)).split('?')[0];
        path = raw
          ? resolve(
              raw.startsWith('/') ? root : dirname(source),
              decodeURIComponent(raw).replace(/^\//, ''),
            )
          : source;
      } catch {
        fail('Invalid URL encoding');
        continue;
      }
      const local = relative(root, path);
      if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
        fail('Local link escapes the repository');
        continue;
      }
      let target;
      try {
        target = await stat(path);
      } catch {
        fail('Local target does not exist');
        continue;
      }
      if (
        fragment &&
        target.isFile() &&
        extname(path).toLowerCase() === '.md'
      ) {
        if (!anchors(await load(path)).has(fragment))
          fail('Markdown anchor does not exist');
      }
    }
  }
  return failures;
}

export async function checkRepository(root = process.cwd()) {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' },
  )
    .split('\0')
    .filter((file) => /\.md$/i.test(file));
  const failures = await checkDocuments(root, files);
  for (const { file, line, url, message } of failures)
    console.error(`${file}:${line}: ${message}: ${url}`);
  console.log(
    `Checked local references in ${files.length} Markdown files (${failures.length} failures).`,
  );
  return failures.length === 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = (await checkRepository()) ? 0 : 1;
