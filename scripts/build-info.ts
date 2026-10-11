import { execFileSync } from 'node:child_process';

/** Public revision identity only; never includes authors, messages or credentials. */
export function readBuildInfo(root: string) {
  try {
    const commits = execFileSync('git', ['rev-list', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split('\n');
    return { version: 1, commit: commits[0]!, ancestors: commits.slice(1) };
  } catch {
    // Source archives/dev environments without Git cannot establish an update.
    return { version: 1, commit: null, ancestors: [] as string[] };
  }
}
