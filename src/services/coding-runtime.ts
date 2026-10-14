import { Bash, getCommandNames } from 'just-bash/browser';
import type { IFileSystem, CommandName } from 'just-bash/browser';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-singlefile-browser-release-sync';
import { codingPath, codingText, validateCodingState } from '../core/coding';
import type {
  CodingState,
  CodingOperation,
  CodingQuery,
  CodingOutput,
  CodingFile,
  CodingExecution,
} from '../core/coding';

// Executed inside QuickJS, never eval'd in the embedding browser/worker realm.
const bootstrap = `
const encoder = s => {
  const out=[]; for(const c of s) { const n=c.codePointAt(0);
    if(n<128) out.push(n); else if(n<2048) out.push(192|(n>>6),128|(n&63));
    else if(n<65536) out.push(224|(n>>12),128|((n>>6)&63),128|(n&63));
    else out.push(240|(n>>18),128|((n>>12)&63),128|((n>>6)&63),128|(n&63)); }
  return new Uint8Array(out);
};
globalThis.fs = {
  readFile(path, encoding) { const b=__read(path); return encoding ? __text(path) : new Uint8Array(b); },
  writeFile(path, data) { if(typeof data==='string') data=encoder(data);
    const b=data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset+data.byteLength); __write(path,b); },
  readdir: path => JSON.parse(__list(path || '.')),
  exists: path => __exists(path), mkdir: path => __mkdir(path), remove: path => __remove(path)
};
globalThis.console = {log: (...args) => __log(args.map(a => typeof a==='string' ? a : JSON.stringify(a)).join(' ')),
  error: (...args) => __error(args.map(a => typeof a==='string' ? a : JSON.stringify(a)).join(' '))};
globalThis.writeWav = (path, channels, sampleRate=48000) => {
  if(!Array.isArray(channels) || !channels.length || channels.length>32 || !Number.isInteger(sampleRate) || sampleRate<8000 || sampleRate>192000) throw Error('Invalid PCM channels or sample rate');
  const frames=channels[0].length, count=channels.length;
  if(!Number.isSafeInteger(frames) || !frames || channels.some(c => c.length!==frames)) throw Error('Channel lengths must match');
  const size=frames*count*2;
  if(size>4294967251) throw Error('WAV exceeds the RIFF format size');
  const b=new ArrayBuffer(44+size), v=new DataView(b);
  const text=(p,s) => {for(let i=0;i<s.length;i++)v.setUint8(p+i,s.charCodeAt(i));};
  text(0,'RIFF');v.setUint32(4,36+size,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);
  v.setUint16(20,1,true);v.setUint16(22,count,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*count*2,true);
  v.setUint16(32,count*2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,size,true);
  for(let i=0;i<frames;i++)for(let c=0;c<count;c++) {
    const x=channels[c][i]; if(!Number.isFinite(x)) throw Error('PCM must contain finite samples');
    v.setInt16(44+(i*count+c)*2, Math.round(Math.max(-1,Math.min(1,x))*(x<0?32768:32767)),true);
  }
  fs.writeFile(path,b); return {path,frames,sampleRate,channels:count,durationSeconds:frames/sampleRate};
};
`;

export function codingGlob(pattern: string, path: string) {
  const source = pattern.replace(/^\/project\//, '').replace(/^\.\//, '');
  let regex = '^';
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (c === '*' && source[i + 1] === '*') {
      i++;
      if (source[i + 1] === '/') {
        i++;
        regex += '(?:.*/)?';
      } else regex += '.*';
    } else if (c === '*') regex += '[^/]*';
    else if (c === '?') regex += '[^/]';
    else regex += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(regex + '$').test(path.slice('/project/'.length));
}

async function filesIn(
  fs: IFileSystem,
  directory = '/project',
): Promise<{ files: CodingFile[]; directories: string[] }> {
  const files: CodingFile[] = [],
    directories = [directory];
  for (const name of await fs.readdir(directory)) {
    const path = `${directory}/${name}`,
      stat = await fs.lstat(path);
    if (stat.isSymbolicLink)
      throw new Error(
        'Persistent workspace entries must be regular files or directories; remove symbolic links before finishing.',
      );
    if (stat.isDirectory) {
      const child = await filesIn(fs, path);
      files.push(...child.files);
      directories.push(...child.directories);
    } else if (stat.isFile)
      files.push({
        path,
        bytes: new Uint8Array(await fs.readFileBuffer(path)),
      });
  }
  return { files, directories };
}

async function javascript(
  fs: IFileSystem,
  code: string,
  filename: string,
  args: string[],
  log: (text: string) => void,
  cwd = '/project',
): Promise<CodingOutput> {
  const initial = await filesIn(fs),
    files = new Map(initial.files.map((file) => [file.path, file.bytes]));
  const directories = new Set(initial.directories);
  const engine = await newQuickJSWASMModuleFromVariant(variant),
    vm = engine.newContext();
  let stdout = '',
    stderr = '';
  const read = (path: string) => {
    const bytes = files.get(codingPath(path, cwd));
    if (!bytes) throw new Error('Workspace file not found.');
    return bytes;
  };
  const parents = (path: string) => {
    const parts = path.split('/');
    const paths: string[] = [];
    while (parts.length > 2) {
      parts.pop();
      paths.push(parts.join('/'));
    }
    for (const parent of paths)
      if (files.has(parent)) throw new Error(`Not a directory: ${parent}`);
    for (const parent of paths) directories.add(parent);
  };
  try {
    const bind = (
      name: string,
      callback: Parameters<typeof vm.newFunction>[1],
    ) => {
      const handle = vm.newFunction(name, callback);
      vm.setProp(vm.global, name, handle);
      handle.dispose();
    };
    bind('__read', (path) =>
      vm.newArrayBuffer(read(vm.getString(path)).slice().buffer),
    );
    bind('__text', (path) =>
      vm.newString(
        new TextDecoder('utf-8', { fatal: true }).decode(
          read(vm.getString(path)),
        ),
      ),
    );
    bind('__write', (pathHandle, bytesHandle) => {
      const path = codingPath(vm.getString(pathHandle), cwd);
      if (path === '/project' || directories.has(path))
        throw new Error('Choose a file path.');
      const bytes = vm.getArrayBuffer(bytesHandle);
      try {
        parents(path);
        files.set(path, bytes.value.slice());
      } finally {
        bytes.dispose();
      }
    });
    bind('__list', (handle) => {
      const root = codingPath(vm.getString(handle), cwd);
      const prefix = root + '/';
      if (!directories.has(root))
        throw new Error('Workspace directory not found.');
      return vm.newString(
        JSON.stringify(
          [
            ...new Set(
              [...files.keys(), ...directories]
                .filter((p) => p.startsWith(prefix))
                .map((p) => p.slice(prefix.length).split('/')[0]),
            ),
          ].sort(),
        ),
      );
    });
    bind('__exists', (handle) => {
      const path = codingPath(vm.getString(handle), cwd);
      return files.has(path) || directories.has(path) ? vm.true : vm.false;
    });
    bind('__mkdir', (handle) => {
      const path = codingPath(vm.getString(handle), cwd);
      if (files.has(path)) throw new Error('A file exists at this path.');
      parents(path + '/_');
    });
    bind('__remove', (handle) => {
      const path = codingPath(vm.getString(handle), cwd);
      if (path === '/project')
        throw new Error('Cannot remove the workspace root.');
      for (const name of files.keys())
        if (name === path || name.startsWith(path + '/')) files.delete(name);
      for (const name of directories)
        if (name === path || name.startsWith(path + '/'))
          directories.delete(name);
    });
    bind('__log', (handle) => {
      const text = vm.getString(handle) + '\n';
      stdout += text;
      log(text);
    });
    bind('__error', (handle) => {
      const text = vm.getString(handle) + '\n';
      stderr += text;
      log(text);
    });
    vm.unwrapResult(
      vm.evalCode(bootstrap + `\nglobalThis.argv = ${JSON.stringify(args)};`),
    ).dispose();
    vm.runtime.setModuleLoader(
      (name) =>
        name === 'fs' || name === 'node:fs'
          ? 'export default globalThis.fs; export const {readFile, writeFile, readdir, exists, mkdir, remove} = globalThis.fs;'
          : codingText(read(name)),
      (base, name) =>
        name === 'fs' || name === 'node:fs'
          ? name
          : codingPath(name, base.slice(0, base.lastIndexOf('/'))),
    );
    const result = vm.evalCode(code, filename, { type: 'module' });
    if (result.error) {
      const error = vm.dump(result.error);
      result.error.dispose();
      throw new Error(
        [error.message ?? String(error), error.stack]
          .filter(Boolean)
          .join('\n'),
      );
    }
    try {
      while (vm.runtime.hasPendingJob()) {
        const pending = vm.runtime.executePendingJobs();
        if (pending.error) {
          const error = vm.dump(pending.error);
          pending.error.dispose();
          throw new Error(error.message ?? String(error));
        }
      }
      const status = vm.getPromiseState(result.value);
      if (status.type === 'rejected') {
        const error = vm.dump(status.error);
        status.error.dispose();
        throw new Error(
          [error.message ?? String(error), error.stack]
            .filter(Boolean)
            .join('\n'),
        );
      }
      if (status.type === 'pending')
        throw new Error(
          'Script has an unresolved promise. Only local synchronous filesystem and JavaScript APIs are available.',
        );
      if (status.type === 'fulfilled' && status.value !== result.value)
        status.value.dispose();
    } finally {
      result.value.dispose();
    }
    validateCodingState({
      version: 1,
      revision: 0,
      files: [...files].map(([path, bytes]) => ({ path, bytes })),
      directories: [...directories],
    });
    await fs.rm('/project', { recursive: true, force: true });
    for (const path of [...directories].sort((a, b) => a.length - b.length))
      await fs.mkdir(path, { recursive: true });
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    return {
      stdout,
      stderr:
        stderr +
        (error instanceof Error ? error.message : String(error)) +
        '\n',
      exitCode: 1,
    };
  } finally {
    vm.dispose();
  }
}

/** Trusted interpreter code; guest JS only receives the explicitly constructed VM bindings. */
export async function runCoding(
  state: CodingState,
  operation: CodingOperation | CodingQuery,
  log: (text: string) => void = () => {},
): Promise<CodingExecution> {
  validateCodingState(state);
  const commands = getCommandNames().filter(
    (name) =>
      ![
        'gzip',
        'gunzip',
        'zcat',
        'sqlite3',
        'python',
        'python3',
        'js-exec',
      ].includes(name),
  ) as CommandName[];
  const bash: Bash = new Bash({
    cwd: '/project',
    files: Object.fromEntries(
      state.files.map((file) => [file.path, file.bytes]),
    ),
    commands,
    customCommands: [
      {
        name: 'js',
        execute: async (args, ctx) => {
          const inline = args[0] === '-c';
          const path = inline
            ? codingPath('inline.js', ctx.cwd)
            : codingPath(args[0] ?? '', ctx.cwd);
          return javascript(
            ctx.fs,
            inline ? (args[1] ?? '') : await ctx.fs.readFile(path),
            path,
            args.slice(inline ? 2 : 1),
            log,
            ctx.cwd,
          );
        },
      },
    ],
  });
  for (const directory of state.directories)
    await bash.fs.mkdir(directory, { recursive: true });
  let output: CodingOutput = { stdout: '', stderr: '', exitCode: 0 };
  if (operation.type === 'bash') output = await bash.exec(operation.command);
  else if (operation.type === 'execute_code')
    output = await javascript(
      bash.fs,
      await bash.fs.readFile(codingPath(operation.path)),
      codingPath(operation.path),
      operation.args,
      log,
    );
  else if (operation.type === 'write_file') {
    const path = codingPath(operation.path);
    await bash.fs.mkdir(path.slice(0, path.lastIndexOf('/')), {
      recursive: true,
    });
    await bash.fs.writeFile(path, operation.content);
  } else if (operation.type === 'edit_file') {
    const path = codingPath(operation.path),
      text = codingText(await bash.fs.readFileBuffer(path));
    const count = text.split(operation.oldText).length - 1;
    if (!count || (!operation.replaceAll && count !== 1))
      throw new Error(
        'oldText must match exactly once; use replaceAll for multiple matches.',
      );
    await bash.fs.writeFile(
      path,
      operation.replaceAll
        ? text.replaceAll(operation.oldText, () => operation.newText)
        : text.replace(operation.oldText, () => operation.newText),
    );
  }
  const next = { ...state, ...(await filesIn(bash.fs)) };
  if (operation.type === 'read_file') {
    const path = codingPath(operation.path);
    return {
      state: next,
      ...output,
      content: codingText(await bash.fs.readFileBuffer(path)),
      path,
    };
  }
  if (operation.type === 'glob')
    return {
      state: next,
      ...output,
      paths: next.files
        .filter((file) => codingGlob(operation.pattern, file.path))
        .map((file) => file.path),
    };
  if (operation.type === 'grep') {
    const pattern = new RegExp(
      operation.pattern,
      operation.ignoreCase ? 'i' : '',
    );
    const matches: { path: string; line: number; text: string }[] = [];
    for (const file of next.files.filter((file) =>
      codingGlob(operation.glob, file.path),
    )) {
      let text: string;
      try {
        text = codingText(file.bytes);
      } catch {
        continue;
      }
      text.split('\n').forEach((line, index) => {
        if (pattern.test(line))
          matches.push({ path: file.path, line: index + 1, text: line });
      });
    }
    return { state: next, ...output, matches };
  }
  return { state: next, ...output };
}
