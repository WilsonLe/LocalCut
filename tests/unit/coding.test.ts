import { describe, it, expect } from 'vitest';
import { runCoding, codingGlob } from '../../src/services/coding-runtime';
import { codingPath, codingText } from '../../src/core/coding';
import type { CodingState } from '../../src/core/coding';
import {
  capabilityDiscovery,
  parseTool,
  toolDefinitions,
} from '../../src/ai/tools';

const initial = (): CodingState => ({
  version: 1,
  revision: 0,
  files: [],
  directories: ['/project'],
});
async function source(code: string) {
  return (
    await runCoding(initial(), {
      type: 'write_file',
      path: 'compose.js',
      content: code,
    })
  ).state;
}
describe('browser coding workspace', () => {
  it('supports shell files, pipelines, heredocs, loops, exact edits and searches', async () => {
    const shell = await runCoding(initial(), {
      type: 'bash',
      command: `mkdir -p sources
cat > sources/a.txt <<'EOF'
tempo=96
melody
EOF
for n in 1 2 3; do echo "$n"; done | tail -n 2 > beats.txt
grep tempo sources/a.txt`,
    });
    expect(shell.exitCode).toBe(0);
    expect(shell.stdout).toContain('tempo=96');
    const edited = await runCoding(shell.state, {
      type: 'edit_file',
      path: 'sources/a.txt',
      oldText: '96',
      newText: '108',
      replaceAll: false,
    });
    expect(
      (
        await runCoding(edited.state, {
          type: 'read_file',
          path: 'sources/a.txt',
        })
      ).content,
    ).toContain('tempo=108');
    expect(
      (await runCoding(edited.state, { type: 'glob', pattern: '**/*.txt' }))
        .paths,
    ).toEqual(
      expect.arrayContaining(['/project/sources/a.txt', '/project/beats.txt']),
    );
    expect(
      (
        await runCoding(edited.state, {
          type: 'grep',
          pattern: 'tempo=108',
          glob: '**/*',
          ignoreCase: false,
        })
      ).matches,
    ).toEqual([{ path: '/project/sources/a.txt', line: 1, text: 'tempo=108' }]);
    await expect(
      runCoding(edited.state, {
        type: 'edit_file',
        path: 'sources/a.txt',
        oldText: 'missing',
        newText: 'x',
        replaceAll: false,
      }),
    ).rejects.toThrow('match exactly once');
    expect(
      shell.state.files.find((f) => f.path === '/project/sources/a.txt')!.bytes,
    ).not.toEqual(
      edited.state.files.find((f) => f.path === '/project/sources/a.txt')!
        .bytes,
    );
  });
  it('runs arbitrary composition, typed-array WAV and local modules in the isolated interpreter', async () => {
    let state =
      await source(`import fs from 'fs'; import { frequency } from './notes.js';
const sr=24000, data=new Float32Array(sr); for(let i=0;i<data.length;i++)data[i]=0.25*Math.sin(2*Math.PI*frequency*i/sr);
const result=writeWav('music.wav',[data],sr); fs.writeFile('metrics.json',JSON.stringify(result)); console.log('rendered',argv[0]);`);
    state = (
      await runCoding(state, {
        type: 'write_file',
        path: 'notes.js',
        content: 'export const frequency=330;',
      })
    ).state;
    const logs: string[] = [];
    const rendered = await runCoding(
      state,
      { type: 'execute_code', path: 'compose.js', args: ['test'] },
      (text) => logs.push(text),
    );
    expect(rendered).toMatchObject({
      exitCode: 0,
      stderr: '',
      stdout: 'rendered test\n',
    });
    expect(logs).toEqual(['rendered test\n']);
    const bytes = rendered.state.files.find((f) =>
      f.path.endsWith('music.wav'),
    )!.bytes;
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint32(40, true)).toBe(48000);
    let power = 0;
    for (let i = 44; i < bytes.length; i += 2)
      power += (view.getInt16(i, true) / 32768) ** 2;
    expect(Math.sqrt(power / 24000)).toBeCloseTo(0.25 / Math.sqrt(2), 3);
    expect(
      JSON.parse(
        codingText(
          rendered.state.files.find((f) => f.path.endsWith('metrics.json'))!
            .bytes,
        ),
      ),
    ).toMatchObject({ durationSeconds: 1, frames: 24000 });
    expect(() => codingText(bytes)).toThrow('Binary');
    const fromShell = await runCoding(rendered.state, {
      type: 'bash',
      command: `js -c 'console.log(2**10)'`,
    });
    expect(fromShell.stdout).toBe('1024\n');
    expect(fromShell.exitCode).toBe(0);
  });
  it('has no application/browser/Node capabilities and rejects root escapes and invalid PCM', async () => {
    const state =
      await source(`console.log(typeof fetch,typeof indexedDB,typeof navigator,typeof document,typeof process,typeof self);
let blocked=false; try { console.log(fs.readFile('/other-project/key')); } catch { blocked=true; } console.log(blocked);
console.log(__log.constructor('return typeof fetch')());`);
    const result = await runCoding(state, {
      type: 'execute_code',
      path: 'compose.js',
      args: [],
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      'undefined undefined undefined undefined undefined undefined\ntrue\nundefined\n',
    );
    expect(codingPath('a/../b')).toBe('/project/b');
    expect(() => codingPath('../../secret')).toThrow('within /project');
    const invalid = await source(
      `writeWav('bad.wav',[new Float32Array([NaN])]);`,
    );
    const failed = await runCoding(invalid, {
      type: 'execute_code',
      path: 'compose.js',
      args: [],
    });
    expect(failed.exitCode).toBe(1);
    expect(failed.stderr).toContain('finite');
    expect(failed.state.files.map((f) => f.path)).not.toContain(
      '/project/bad.wav',
    );
  });
  it('reports syntax and module/promise failures without publishing guest writes', async () => {
    for (const code of [
      "fs.writeFile('partial.txt','x'); throw Error('bad take')",
      'const =',
      "import x from './missing.js'",
      'await new Promise(()=>{});',
    ]) {
      const state = await source(code);
      const result = await runCoding(state, {
        type: 'execute_code',
        path: 'compose.js',
        args: [],
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).not.toBe('');
      expect(result.state.files.map((f) => f.path)).toEqual([
        '/project/compose.js',
      ]);
    }
    expect(codingGlob('**/*.js', '/project/folder/a.js')).toBe(true);
    expect(codingGlob('*.js', '/project/folder/a.js')).toBe(false);
  });
});

it('discovers coding support separately from loading, sharing and mutation schemas', () => {
  const caps = {
    coding: true,
    undo: false,
    redo: false,
    export: false,
    transcriptionStatus: false,
    transcription: false,
    transcriptionPreparation: false,
  };
  const loaded = new Set<import('../../src/ai/skills').SkillId>(['coding']);
  expect(capabilityDiscovery(false, caps).tools.execute_code).toMatchObject({
    supported: true,
    available: false,
  });
  expect(
    capabilityDiscovery(false, caps, loaded).tools.execute_code.blockers,
  ).toEqual([expect.objectContaining({ reason: 'sharing_disabled' })]);
  const tools = toolDefinitions(false, caps, loaded, false, true, true);
  expect(tools.map((t) => t.function.name)).toEqual(
    expect.arrayContaining([
      'read_file',
      'write_file',
      'edit_file',
      'glob',
      'grep',
      'bash',
      'execute_code',
      'import_workspace_file',
      'propose_action',
    ]),
  );
  expect(
    parseTool(
      'write_file',
      JSON.stringify({
        path: 'sources/a.js',
        content: 'const x=1;',
        expectedRevision: 0,
      }),
    ).args,
  ).toMatchObject({ expectedRevision: 0 });
  expect(() =>
    parseTool(
      'write_file',
      JSON.stringify({
        path: '/credentials',
        content: 'x',
        expectedRevision: 0,
      }),
    ),
  ).toThrow();
});
