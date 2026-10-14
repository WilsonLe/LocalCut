import { codingState } from '../storage/coding';
import {
  codingManifest,
  codingOperationSchema,
  codingQuerySchema,
} from '../core/coding';
import type {
  CodingOperation,
  CodingQuery,
  CodingOutput,
  CodingExecution,
} from '../core/coding';
import { invariant, EditorError } from '../core/errors';
import { checkAbort } from './jobs';
import { WorkerClient } from './worker-client';
import type { Progress } from './jobs';

export async function inspectCoding(namespace: string, projectId: string) {
  return codingState(namespace, projectId, async (state) =>
    codingManifest(state),
  );
}
export async function codingFile(
  namespace: string,
  projectId: string,
  path: string,
  revision?: number,
) {
  return codingState(namespace, projectId, async (state) => {
    invariant(
      revision === undefined || revision === state.revision,
      'REVISION_CONFLICT',
      'Coding workspace changed',
    );
    const { codingPath } = await import('../core/coding');
    const file = state.files.find((file) => file.path === codingPath(path));
    invariant(file, 'INVALID_COMMAND', 'Coding workspace file not found');
    return new File([file.bytes], file.path.split('/').at(-1)!);
  });
}
export async function executeCoding(
  namespace: string,
  projectId: string,
  input: CodingOperation | CodingQuery,
  expectedRevision: number | undefined,
  signal: AbortSignal,
  progress: (value: Progress) => void,
) {
  const query = codingQuerySchema.safeParse(input);
  const operation = query.success
    ? query.data
    : codingOperationSchema.parse(input);
  return codingState(namespace, projectId, async (state, commit) => {
    invariant(
      query.success || state.revision === expectedRevision,
      'REVISION_CONFLICT',
      'Coding workspace changed. Inspect its current revision.',
    );
    checkAbort(signal);
    progress({ stage: 'Running project code' });
    const client = new WorkerClient(
      () =>
        new Worker(new URL('../workers/coding.worker.ts', import.meta.url), {
          type: 'module',
        }),
    );
    const abort = () =>
      client.reset(new EditorError('CANCELLED', 'Coding execution cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    try {
      const result = await client.run<CodingExecution>(
        'coding',
        { state, operation },
        signal,
        progress,
      );
      if (!query.success) {
        result.state.revision = state.revision + 1;
        await commit(result.state, signal);
      }
      const { state: next, ...output } = result;
      return { ...output, ...codingManifest(next) };
    } finally {
      signal.removeEventListener('abort', abort);
      client.reset();
    }
  });
}
export type CodingResult = Awaited<ReturnType<typeof executeCoding>> &
  CodingOutput;
