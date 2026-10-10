import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { ensureBuilds, root } from './build-state.mjs';
import {
  mediaRoundTrip,
  reopen,
  cleanup,
  interfaceLayout,
} from '../tests/safari/scenarios.mjs';

if (process.platform !== 'darwin')
  throw new Error('Native Safari requires macOS and Safari Remote Automation.');
await ensureBuilds();
async function freePort() {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}
const [driverPort, serverPort] = await Promise.all([freePort(), freePort()]);
const children = [];
function start(command, args, env = process.env) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.output = '';
  child.failure = undefined;
  child.stdout.on('data', (data) => {
    child.output += data;
  });
  child.stderr.on('data', (data) => {
    child.output += data;
  });
  child.on('error', (error) => {
    child.failure = error;
  });
  children.push(child);
  return child;
}
async function ready(url, child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.failure || child.exitCode !== null)
      throw child.failure ?? new Error(child.output || 'Test server exited');
    try {
      const response = await globalThis.fetch(url);
      if (response.ok) return;
    } catch {
      /* startup */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out starting Safari test service: ' + child.output);
}
const endpoint = `http://127.0.0.1:${driverPort}`;
let session;
async function request(method, path, body) {
  const response = await globalThis.fetch(endpoint + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: globalThis.AbortSignal.timeout(180000),
  });
  const data = await response.json();
  if (!response.ok || data.value?.error)
    throw new Error(JSON.stringify(data.value));
  return data.value;
}
async function execute(fn, ...args) {
  const result = await request('POST', `/session/${session}/execute/async`, {
    script: `const done = arguments[arguments.length - 1]; (${fn.toString()})(...Array.from(arguments).slice(0, -1)).then(value => done({value}), error => done({error: String(error.stack || error)}));`,
    args,
  });
  if (result.error) throw new Error(result.error);
  return result.value;
}
const report = { results: [] },
  directory = `${root}/test-results/safari`;
await mkdir(directory, { recursive: true });
try {
  const driver = start('/usr/bin/safaridriver', ['--port', String(driverPort)]);
  const server = start(process.execPath, ['scripts/test-server.mjs'], {
    ...process.env,
    LOCALCUT_TEST_PORT: String(serverPort),
  });
  await Promise.all([
    ready(endpoint + '/status', driver),
    ready(`http://127.0.0.1:${serverPort}/health`, server),
  ]);
  const created = await request('POST', '/session', {
    capabilities: { alwaysMatch: { browserName: 'safari' } },
  });
  session = created.sessionId;
  report.capabilities = created.capabilities;
  await request('POST', `/session/${session}/timeouts`, {
    script: 150000,
    pageLoad: 30000,
  });
  await request('POST', `/session/${session}/window/rect`, {
    width: 1440,
    height: 1000,
  });
  for (const base of ['/', '/LocalCut/']) {
    const namespace = 'test-safari-' + randomUUID();
    await request('POST', `/session/${session}/url`, {
      url: `http://127.0.0.1:${serverPort}${base}`,
    });
    try {
      assert.equal(
        await request('GET', `/session/${session}/title`),
        'LocalCut',
      );
      const layout = await execute(interfaceLayout);
      for (const measurement of layout) {
        assert.ok(measurement.gap <= 1, JSON.stringify(measurement));
        assert.ok(measurement.overflow <= 1, JSON.stringify(measurement));
        assert.ok(
          Math.abs(measurement.workspaceHeight - measurement.viewportHeight) <=
            1,
          JSON.stringify(measurement),
        );
        assert.ok(
          Math.abs(measurement.headerHeight - 64 * measurement.scale) <= 1,
          JSON.stringify(measurement),
        );
      }
      const result = await execute(mediaRoundTrip, base, namespace);
      report.results.push({ base, layout, ...result });
      for (const m of result.measurements) {
        assert.ok(m.bytes > 100);
        assert.equal(m.videoCodec, 'avc');
        assert.equal(m.audioCodec, 'aac');
        assert.ok(Math.abs(m.durationUs - 1000000) < 50000, JSON.stringify(m));
        assert.ok(
          m.pixel[0] > 240 && m.pixel[1] < 15 && m.pixel[2] < 15,
          JSON.stringify(m),
        );
        assert.equal(m.channels, 2);
        assert.equal(m.sampleRate, 48000);
        if (m.mode === 'silent')
          assert.ok(
            m.rms.every((value) => value < 0.001),
            JSON.stringify(m),
          );
        else {
          assert.ok(
            m.rms[0] > 0.15 &&
              m.rms[0] < 0.25 &&
              m.rms[1] > 0.07 &&
              m.rms[1] < 0.13,
            JSON.stringify(m),
          );
          assert.ok(Math.abs(m.onset - 0.2) < 0.05, JSON.stringify(m));
        }
      }
      await request('POST', `/session/${session}/refresh`, {});
      assert.deepEqual(
        await execute(reopen, base, namespace, result.projectId),
        { revision: 1, tracks: ['persisted'] },
      );
      console.log(
        `Safari ${base}: WAV/AAC/silent MP4 round trips and storage reload passed.`,
      );
    } finally {
      await execute(cleanup, namespace);
    }
  }
} catch (error) {
  report.error = String(error.stack || error);
  if (session) {
    try {
      await writeFile(
        `${directory}/failure.png`,
        Buffer.from(
          await request('GET', `/session/${session}/screenshot`),
          'base64',
        ),
      );
    } catch {
      /* original error retained */
    }
  }
  throw error;
} finally {
  await writeFile(
    `${directory}/results.json`,
    JSON.stringify(report, null, 2) + '\n',
  );
  if (session) {
    try {
      await request('DELETE', `/session/${session}`);
    } catch {
      /* terminate owned driver below */
    }
  }
  await Promise.all(
    children.map(async (child) => {
      if (child.exitCode === null && !child.failure) {
        const closed = once(child, 'close');
        child.kill();
        await closed;
      }
    }),
  );
}
