import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function filesIn(path) {
  const entries = await readdir(path, { withFileTypes: true }).catch(
    (error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    },
  );
  const groups = await Promise.all(
    entries.map(async (entry) => {
      const file = join(path, entry.name);
      return entry.isDirectory() ? filesIn(file) : entry.isFile() ? [file] : [];
    }),
  );
  return groups.flat().sort();
}

async function hashFiles(files, prefix = '') {
  const hash = createHash('sha256').update(prefix);
  for (const file of files.sort()) {
    hash.update(relative(root, file)).update('\0');
    hash.update(await readFile(file)).update('\0');
  }
  return hash.digest('hex');
}

export function target(
  rootBuild = false,
  base = process.env.LOCALCUT_BASE_PATH || '/LocalCut/',
) {
  return {
    name: rootBuild ? 'root' : 'project',
    directory: rootBuild ? 'dist-root' : 'dist',
    base: rootBuild ? '/' : base,
  };
}

export async function inputHash(build) {
  const rootFiles = (await readdir(root))
    .filter(
      (name) =>
        [
          'index.html',
          'package.json',
          'pnpm-lock.yaml',
          'pnpm-workspace.yaml',
          '.npmrc',
        ].includes(name) ||
        /^\.env(?:\.production)?(?:\.local)?$/.test(name) ||
        /^(vite|postcss|tailwind)\.config\./.test(name) ||
        /^tsconfig(?:\.(?:types|worker))?\.json$/.test(name),
    )
    .map((name) => join(root, name));
  const files = [
    ...rootFiles,
    // Agent instructions are development metadata, never production inputs.
    ...(await filesIn(join(root, 'src'))).filter(
      (file) => basename(file) !== 'AGENTS.md',
    ),
    ...(await filesIn(join(root, 'public'))),
    ...['build.mjs', 'build-state.mjs', 'font-snapshot.ts'].map((name) =>
      join(root, 'scripts', name),
    ),
  ];
  const environment = Object.fromEntries(
    Object.entries(process.env)
      .filter(([name]) => name === 'NODE_ENV' || name.startsWith('VITE_'))
      .sort(),
  );
  return hashFiles(
    files,
    JSON.stringify({
      version: 1,
      base: build.base,
      node: process.versions.node,
      environment,
    }),
  );
}

const statePath = (build) =>
  join(root, '.cache', 'build-state', build.name + '.json');

export async function recordBuild(build, input) {
  const files = await filesIn(join(root, build.directory));
  const state = {
    version: 1,
    input,
    output: await hashFiles(files),
    base: build.base,
  };
  const path = statePath(build);
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + '.' + process.pid + '.tmp';
  await writeFile(temporary, JSON.stringify(state) + '\n');
  await rename(temporary, path);
}

export async function buildStatus(build) {
  let state;
  try {
    state = JSON.parse(await readFile(statePath(build), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError)
      return { current: false, reason: 'no verified build stamp' };
    throw error;
  }
  if (
    !state ||
    state.version !== 1 ||
    state.base !== build.base ||
    state.input !== (await inputHash(build))
  )
    return {
      current: false,
      reason: 'source, configuration or lockfile changed',
    };
  const files = await filesIn(join(root, build.directory));
  if (!files.length || state.output !== (await hashFiles(files)))
    return { current: false, reason: 'build output changed or is missing' };
  return { current: true, reason: 'source and every output file match' };
}

export async function runPnpm(args, env = process.env, { signal } = {}) {
  const executable = env.npm_execpath;
  const command = executable ? process.execPath : 'pnpm';
  const commandArgs = executable ? [executable, ...args] : args;
  return runProcess(command, commandArgs, env, { signal });
}

export async function runProcess(
  command,
  args,
  env = process.env,
  { signal } = {},
) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: 'inherit',
      // Keep terminal signals from reaching both the wrapper and runner. The
      // direct runner receives one forwarded signal and owns child teardown.
      detached: Boolean(signal) && process.platform !== 'win32',
    });
    // Wait for close even after cancellation: the owned runner must finish its
    // cleanup before a caller tears down the browser or other shared resources.
    const abort = () =>
      child.kill(typeof signal.reason === 'string' ? signal.reason : 'SIGTERM');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let error;
    child.on('error', (cause) => {
      error = cause;
    });
    child.on('close', (code, exitSignal) => {
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else if (code === 0) resolve();
      else
        reject(
          Object.assign(
            new Error(
              `${command} ${args.join(' ')} exited ${code ?? exitSignal}`,
            ),
            { exitCode: code, signal: exitSignal },
          ),
        );
    });
  });
}

export async function ensureBuilds(env = process.env) {
  env = { ...env, LOCALCUT_BASE_PATH: '/LocalCut/' };
  for (const rootBuild of [false, true]) {
    const build = target(rootBuild, env.LOCALCUT_BASE_PATH);
    const status = await buildStatus(build);
    if (status.current)
      console.log(`Reusing ${build.directory}: ${status.reason}.`);
    else {
      console.log(`Building ${build.directory}: ${status.reason}.`);
      await runPnpm(['run', rootBuild ? 'build:root' : 'build'], env);
    }
  }
}
