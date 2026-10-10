import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

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
    ...['build.mjs', 'build-state.mjs'].map((name) =>
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
  await new Promise((resolve, reject) => {
    const ownGroup = Boolean(signal) && process.platform !== 'win32';
    const child = spawn(command, commandArgs, {
      cwd: root,
      env,
      stdio: 'inherit',
      detached: ownGroup,
    });
    // Wait for close even after cancellation: the owned runner must finish its
    // cleanup before a caller tears down the browser or other shared resources.
    const kill = (name) => {
      if (!ownGroup) return child.kill(name);
      if (!child.pid) return;
      try {
        process.kill(-child.pid, name);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    };
    const abort = () =>
      kill(typeof signal.reason === 'string' ? signal.reason : 'SIGTERM');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let error;
    child.on('error', (cause) => {
      error = cause;
    });
    child.on('close', async (code, exitSignal) => {
      signal?.removeEventListener('abort', abort);
      if (ownGroup && signal.aborted && child.pid) {
        // pnpm may exit before its Playwright/server children. Reap only this
        // invocation's process group before allowing the shared browser to close.
        try {
          const exists = () => {
            try {
              process.kill(-child.pid, 0);
              return true;
            } catch (cause) {
              if (cause.code === 'ESRCH') return false;
              throw cause;
            }
          };
          const deadline = Date.now() + 5000;
          while (exists() && Date.now() < deadline) await delay(10);
          if (exists()) kill('SIGKILL');
          const forcedDeadline = Date.now() + 1000;
          while (exists() && Date.now() < forcedDeadline) await delay(10);
          if (exists())
            throw new Error('Cancelled test process group did not exit.');
        } catch (cause) {
          reject(Object.assign(cause, { cleanupFailed: true }));
          return;
        }
      }
      if (error) reject(error);
      else if (code === 0) resolve();
      else
        reject(
          Object.assign(
            new Error(`pnpm ${args.join(' ')} exited ${code ?? exitSignal}`),
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
