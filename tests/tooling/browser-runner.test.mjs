import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import { runBrowserTests } from '../../scripts/test-browser.mjs';
import { runProcess } from '../../scripts/build-state.mjs';

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

test(
  'browser cancellation lets the real Playwright runner close its detached web server',
  { timeout: 15000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'localcut-runner-'));
    const readyPath = join(directory, 'ready');
    const pidPath = join(directory, 'server-pid');
    const configPath = join(directory, 'playwright.config.mjs');
    const serverPath = join(directory, 'server.mjs');
    const listener = createServer();
    await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    const url = `http://127.0.0.1:${port}`;
    const playwright = import.meta.resolve('@playwright/test');
    await Promise.all([
      writeFile(
        serverPath,
        `import { createServer } from 'node:http';
          import { writeFileSync } from 'node:fs';
          writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
          createServer((_request, response) => response.end('ready')).listen(${port}, '127.0.0.1');`,
      ),
      writeFile(
        configPath,
        `export default {
          testDir: '.', testMatch: 'probe.spec.mjs', workers: 1, reporter: 'list',
          projects: [{ name: 'chrome' }],
          webServer: { command: ${JSON.stringify(JSON.stringify(process.execPath) + ' ' + JSON.stringify(serverPath))}, url: ${JSON.stringify(url)} }
        };`,
      ),
      writeFile(
        join(directory, 'probe.spec.mjs'),
        `import { test } from ${JSON.stringify(playwright)};
          import { writeFileSync } from 'node:fs';
          test('interruption probe without browser fixtures', async () => {
            writeFileSync(${JSON.stringify(readyPath)}, 'ready');
            await new Promise(resolve => setTimeout(resolve, 60000));
          });`,
      ),
    ]);
    const signals = new EventEmitter();
    let closed = false;
    const running = runBrowserTests(['--config', configPath], process.env, {
      signals,
      launchServer: async () => ({
        wsEndpoint: () => 'ws://127.0.0.1/unused',
        close: async () => {
          closed = true;
        },
      }),
    });
    try {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (await readFile(readyPath, 'utf8').catch(() => '')) break;
        await delay(10);
      }
      assert.equal(await readFile(readyPath, 'utf8'), 'ready');
      assert.equal((await globalThis.fetch(url)).status, 200);
      signals.emit('SIGTERM');
      assert.equal(await running, 143);
      assert.equal(closed, true);
      await assert.rejects(globalThis.fetch(url));
      await assert.rejects(
        runProcess(process.execPath, ['-e', 'process.exit(7)']),
        (error) => error.exitCode === 7,
      );
    } finally {
      signals.emit('SIGTERM');
      await running.catch(() => {});
      const pid = Number(await readFile(pidPath, 'utf8').catch(() => 0));
      if (pid)
        try {
          process.kill(pid, 'SIGKILL');
        } catch (error) {
          assert.equal(error.code, 'ESRCH');
        }
      await rm(directory, { recursive: true, force: true });
    }
  },
);
