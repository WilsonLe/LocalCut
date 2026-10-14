import { z } from 'zod';

/** Guest paths address only the project coding filesystem, never engine storage. */
export function codingPath(input: string, cwd = '/project'): string {
  const parts: string[] = [];
  for (const part of (input.startsWith('/') ? input : `${cwd}/${input}`).split(
    '/',
  )) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  const path = '/' + parts.join('/');
  if (path !== '/project' && !path.startsWith('/project/'))
    throw new Error('Path must stay within /project.');
  if (path.includes('\0') || path.includes('\\'))
    throw new Error('Invalid workspace path.');
  return path;
}

const path = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      return codingPath(value) !== '/project';
    } catch {
      return false;
    }
  }, 'Choose a file within /project.');
export const codingRevision = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
export const codingOperations = {
  write_file: z
    .object({ type: z.literal('write_file'), path, content: z.string() })
    .strict(),
  edit_file: z
    .object({
      type: z.literal('edit_file'),
      path,
      oldText: z.string().min(1),
      newText: z.string(),
      replaceAll: z.boolean().default(false),
    })
    .strict(),
  bash: z
    .object({ type: z.literal('bash'), command: z.string().min(1) })
    .strict(),
  execute_code: z
    .object({
      type: z.literal('execute_code'),
      path,
      args: z.array(z.string()).default([]),
    })
    .strict(),
  import_workspace_file: z
    .object({
      type: z.literal('import_workspace_file'),
      path,
      name: z.string().min(1).optional(),
    })
    .strict(),
};
export const codingOperationSchema = z.discriminatedUnion('type', [
  codingOperations.write_file,
  codingOperations.edit_file,
  codingOperations.bash,
  codingOperations.execute_code,
  codingOperations.import_workspace_file,
]);
export type CodingOperation = z.infer<typeof codingOperationSchema>;
export const codingQueries = {
  read_file: z.object({ type: z.literal('read_file'), path }).strict(),
  glob: z
    .object({ type: z.literal('glob'), pattern: z.string().default('**/*') })
    .strict(),
  grep: z
    .object({
      type: z.literal('grep'),
      pattern: z.string(),
      glob: z.string().default('**/*'),
      ignoreCase: z.boolean().default(false),
    })
    .strict(),
};
export const codingQuerySchema = z.discriminatedUnion('type', [
  codingQueries.read_file,
  codingQueries.glob,
  codingQueries.grep,
]);
export type CodingQuery = z.infer<typeof codingQuerySchema>;
export interface CodingFile {
  path: string;
  bytes: Uint8Array<ArrayBuffer>;
}
export interface CodingState {
  version: 1;
  revision: number;
  files: CodingFile[];
  directories: string[];
}
export function validateCodingState(state: CodingState) {
  const directories = new Set(state.directories);
  const files = new Set(state.files.map((file) => file.path));
  const parentsExist = (path: string) => {
    while (path !== '/project') {
      path = path.slice(0, path.lastIndexOf('/'));
      if (!directories.has(path) || files.has(path)) return false;
    }
    return true;
  };
  if (
    state.version !== 1 ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0 ||
    !directories.has('/project') ||
    directories.size !== state.directories.length ||
    files.size !== state.files.length ||
    state.directories.some(
      (path) =>
        codingPath(path) !== path || files.has(path) || !parentsExist(path),
    ) ||
    state.files.some(
      (file) =>
        codingPath(file.path) !== file.path ||
        file.path === '/project' ||
        !(file.bytes instanceof Uint8Array) ||
        !parentsExist(file.path),
    )
  )
    throw new Error(
      'Invalid coding filesystem: entries must have directory ancestors and unique file/directory paths.',
    );
}
export interface CodingOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}
export interface CodingExecution extends CodingOutput {
  state: CodingState;
  content?: string;
  path?: string;
  paths?: string[];
  matches?: { path: string; line: number; text: string }[];
}
export const codingRuntime = {
  root: '/project',
  shell: 'just-bash 3.6.0 (browser Bash interpreter)',
  javascript: 'QuickJS 0.32.0 (isolated JavaScript, typed arrays, ES modules)',
  execution:
    'execute_code runs a saved JavaScript file; bash also supports js script.js or js -c code',
  filesystem:
    'Persistent project-owned files and directories. Other project roots, immutable media originals, internal databases and credentials are not mounted.',
  network: false,
  nativeProcesses: false,
  python: false,
  packageInstallation: false,
  api: 'fs.readFile(path, encoding?), fs.writeFile(path, string|ArrayBuffer|typedArray), fs.readdir(path?), fs.exists(path), fs.mkdir(path), fs.remove(path), console.log/error, argv, writeWav(path, channels, sampleRate). Import fs from "fs" or "node:fs"; import local JavaScript modules with relative paths. No browser globals or native Node runtime.',
} as const;

export function codingManifest(state: CodingState) {
  return {
    revision: state.revision,
    runtime: codingRuntime,
    directories: state.directories,
    files: state.files.map((file) => ({
      path: file.path,
      size: file.bytes.byteLength,
    })),
  };
}

/** Binary artifacts stay local; text is agent-authored workspace content. */
export function codingText(bytes: Uint8Array): string {
  if (bytes.includes(0))
    throw new Error(
      'Binary file: inspect its size or analyze it locally with execute_code.',
    );
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
