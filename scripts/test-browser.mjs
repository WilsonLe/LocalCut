import { fileURLToPath, pathToFileURL } from 'node:url';
import { runProcess } from './build-state.mjs';

const runPlaywright = (args, env, options) =>
  runProcess(
    process.execPath,
    [fileURLToPath(import.meta.resolve('@playwright/test/cli')), ...args],
    env,
    options,
  );

// Multiple Playwright workers own isolated contexts in one Chrome process.
// Use Playwright's transport so the standard tracing and context teardown stay
// intact, including when a failed test causes a worker to be replaced.
export async function runBrowserTests(
  args = [],
  env = process.env,
  { launchServer, run = runPlaywright, signals = process } = {},
) {
  const command = ['test', '--project=chrome', ...args];
  if (args.some((arg) => ['--list', '--help', '-h'].includes(arg))) {
    await run(command, env);
    return 0;
  }

  const launch =
    launchServer ??
    ((options) =>
      import('@playwright/test').then(({ chromium }) =>
        chromium.launchServer(options),
      ));
  const debug = env.PWDEBUG && !['0', 'false'].includes(env.PWDEBUG);
  const controller = new globalThis.AbortController();
  const exitCodes = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
  const handlers = new Map();
  let interrupted;
  let server;
  for (const signal of Object.keys(exitCodes)) {
    const handler = () => {
      interrupted ??= signal;
      // Playwright unwinds its fixture/web-server teardown stack on SIGINT.
      // Forwarding SIGTERM would orphan its separately grouped web server.
      controller.abort('SIGINT');
    };
    handlers.set(signal, handler);
    signals.on(signal, handler);
  }
  try {
    server = await launch({
      channel: 'chrome',
      executablePath: env.LOCALCUT_CHROME_EXECUTABLE,
      headless:
        !debug && !args.includes('--headed') && !args.includes('--debug'),
      host: '127.0.0.1',
      port: 0,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
    console.log(
      `LocalCut Chrome: one shared browser (PID ${server.process?.()?.pid ?? 'unavailable'}).`,
    );
    if (!controller.signal.aborted)
      await run(
        command,
        { ...env, LOCALCUT_BROWSER_WS_ENDPOINT: server.wsEndpoint() },
        { signal: controller.signal },
      );
  } catch (error) {
    if (!interrupted || error.cleanupFailed) throw error;
  } finally {
    try {
      await server?.close();
    } finally {
      for (const [signal, handler] of handlers)
        signals.removeListener(signal, handler);
    }
  }
  return interrupted ? exitCodes[interrupted] : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  runBrowserTests(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error);
      process.exitCode = error.exitCode ?? 1;
    },
  );
