import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runBrowserTests } from '../../scripts/test-browser.mjs';
import { runPnpm } from '../../scripts/build-state.mjs';

test('browser discovery forwards selection without launching Chrome', async () => {
  const env = { LOCALCUT_BROWSER_WORKERS: '8' };
  let command;
  assert.equal(
    await runBrowserTests(['workspace.spec.ts', '--list'], env, {
      launchServer: () => assert.fail('discovery must not open Chrome'),
      run: async (args, actualEnv) => {
        command = args;
        assert.equal(actualEnv, env);
      },
    }),
    0,
  );
  assert.deepEqual(command, [
    'exec',
    'playwright',
    'test',
    '--project=chrome',
    'workspace.spec.ts',
    '--list',
  ]);
});

test('one loopback Chrome server is retained until the runner finishes', async () => {
  const signals = new EventEmitter();
  const env = {
    LOCALCUT_CHROME_EXECUTABLE: '/custom/chrome',
    LOCALCUT_BROWSER_WS_ENDPOINT: 'ws://external.invalid/do-not-reuse',
  };
  let closed = 0;
  let launched = 0;
  assert.equal(
    await runBrowserTests(['--headed', '--workers=8'], env, {
      signals,
      launchServer: async (options) => {
        launched++;
        assert.equal(options.channel, 'chrome');
        assert.equal(options.executablePath, '/custom/chrome');
        assert.equal(options.host, '127.0.0.1');
        assert.equal(options.port, 0);
        assert.equal(options.headless, false);
        return {
          wsEndpoint: () => 'ws://127.0.0.1:12345/owned',
          close: async () => closed++,
        };
      },
      run: async (_args, actualEnv) => {
        assert.equal(closed, 0);
        assert.equal(
          actualEnv.LOCALCUT_BROWSER_WS_ENDPOINT,
          'ws://127.0.0.1:12345/owned',
        );
        assert.equal(actualEnv.LOCALCUT_CHROME_EXECUTABLE, '/custom/chrome');
      },
    }),
    0,
  );
  assert.equal(launched, 1);
  assert.equal(closed, 1);
  assert.deepEqual(env, {
    LOCALCUT_CHROME_EXECUTABLE: '/custom/chrome',
    LOCALCUT_BROWSER_WS_ENDPOINT: 'ws://external.invalid/do-not-reuse',
  });
  assert.deepEqual(signals.eventNames(), []);
});

test('runner failure closes Chrome and preserves the original failure', async () => {
  const signals = new EventEmitter();
  const failure = Object.assign(new Error('test failed'), { exitCode: 7 });
  let closed = 0;
  await assert.rejects(
    runBrowserTests(
      [],
      {},
      {
        signals,
        launchServer: async () => ({
          wsEndpoint: () => 'ws://127.0.0.1:12345/owned',
          close: async () => closed++,
        }),
        run: async () => {
          throw failure;
        },
      },
    ),
    (error) => error === failure,
  );
  assert.equal(closed, 1);
  assert.deepEqual(signals.eventNames(), []);
});

test('interruption waits for runner cleanup before closing its shared browser', async () => {
  const signals = new EventEmitter();
  const events = [];
  let ready;
  const started = new Promise((resolve) => (ready = resolve));
  let finish;
  const running = runBrowserTests(
    [],
    {},
    {
      signals,
      launchServer: async () => ({
        wsEndpoint: () => 'ws://127.0.0.1:12345/owned',
        close: async () => events.push('browser closed'),
      }),
      run: (_args, _env, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            assert.equal(signal.reason, 'SIGINT');
            events.push('runner signalled');
          });
          finish = () => {
            events.push('runner closed');
            reject(new Error('interrupted'));
          };
          ready();
        }),
    },
  );
  await started;
  signals.emit('SIGTERM');
  assert.deepEqual(events, ['runner signalled']);
  finish();
  assert.equal(await running, 143);
  assert.deepEqual(events, [
    'runner signalled',
    'runner closed',
    'browser closed',
  ]);
  assert.deepEqual(signals.eventNames(), []);
});

for (const detached of [false, true])
  test(
    `pnpm cancellation waits for ${detached ? 'runner cleanup of a detached server' : 'owned descendants'} and preserves failed exit codes`,
    { skip: process.platform === 'win32' },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'localcut-runner-'));
      const entry = join(directory, 'fake-pnpm.mjs');
      const readyPath = join(directory, 'ready');
      const closedPath = join(directory, 'closed');
      const grandchildPath = join(directory, 'grandchild-closed');
      const pidPath = join(directory, 'server-pid');
      const descendant = `
    const { writeFileSync } = require('node:fs');
    process.on('SIGTERM', () => setTimeout(() => {
      writeFileSync(${JSON.stringify(grandchildPath)}, 'closed');
      process.exit(0);
    }, 80));
    process.send('ready');
    setInterval(() => {}, 1000);`;
      await writeFile(
        entry,
        `import { writeFileSync } from 'node:fs';
     import { spawn } from 'node:child_process';
     if (process.argv.includes('fail')) process.exit(7);
     const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {
       detached: ${JSON.stringify(detached)},
       stdio: ['ignore', 'inherit', 'inherit', 'ipc']
     });
     writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));
     process.on(${JSON.stringify(detached ? 'SIGINT' : 'SIGTERM')}, () => {
       if (${JSON.stringify(detached)}) {
         child.once('exit', () => {
           writeFileSync(${JSON.stringify(closedPath)}, 'closed');
           process.exit(0);
         });
         child.kill('SIGTERM');
       } else setTimeout(() => {
         writeFileSync(${JSON.stringify(closedPath)}, 'closed');
         process.exit(0);
       }, 30);
     });
     child.once('message', () => writeFileSync(${JSON.stringify(readyPath)}, 'ready'));
     setInterval(() => {}, 1000);`,
      );
      const controller = new globalThis.AbortController();
      const env = { ...process.env, npm_execpath: entry };
      const running = runPnpm([], env, { signal: controller.signal });
      try {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (await readFile(readyPath, 'utf8').catch(() => '')) break;
          await delay(10);
        }
        assert.equal(await readFile(readyPath, 'utf8'), 'ready');
        controller.abort(detached ? 'SIGINT' : 'SIGTERM');
        await running;
        assert.equal(await readFile(closedPath, 'utf8'), 'closed');
        if (process.platform !== 'win32')
          assert.equal(await readFile(grandchildPath, 'utf8'), 'closed');
        await assert.rejects(
          runPnpm(['fail'], env),
          (error) => error.exitCode === 7,
        );
      } finally {
        controller.abort(detached ? 'SIGINT' : 'SIGTERM');
        await running.catch(() => {});
        const pid = Number(await readFile(pidPath, 'utf8').catch(() => 0));
        if (pid)
          try {
            process.kill(detached ? -pid : pid, 'SIGKILL');
          } catch (error) {
          assert.equal(error.code, 'ESRCH');
          }
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
