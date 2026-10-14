import { openDB } from 'idb';
import { EditorError, invariant } from '../core/errors';
import { validateCodingState } from '../core/coding';
import type { CodingState } from '../core/coding';
import { checkAbort } from '../services/jobs';
import { commitWithSignal } from './transaction';

/** One atomic authored snapshot avoids partially published scripts/audio on reload. */
export async function codingState<T>(
  namespace: string,
  projectId: string,
  work: (
    state: CodingState,
    commit: (next: CodingState, signal: AbortSignal) => Promise<void>,
  ) => Promise<T>,
) {
  const db = await openDB(`${namespace}-coding-v1`, 1, {
    upgrade(db) {
      db.createObjectStore('projects');
    },
  });
  try {
    const state: CodingState = (await db.get('projects', projectId)) ?? {
      version: 1,
      revision: 0,
      files: [],
      directories: ['/project'],
    };
    invariant(
      state.version === 1,
      'INVALID_DOCUMENT',
      'Unsupported coding workspace version',
    );
    validateCodingState(state);
    return await work(state, async (next, signal) => {
      checkAbort(signal);
      invariant(
        next.revision === state.revision + 1,
        'INVALID_DOCUMENT',
        'Invalid coding workspace snapshot',
      );
      validateCodingState(next);
      const tx = db.transaction('projects', 'readwrite');
      try {
        const current: CodingState | undefined = await tx.store.get(projectId);
        if ((current?.revision ?? 0) !== state.revision) {
          tx.abort();
          throw new EditorError(
            'REVISION_CONFLICT',
            'Coding workspace changed. Inspect it and retry with its current revision.',
          );
        }
        await commitWithSignal(tx, signal, () => tx.store.put(next, projectId));
      } catch (error) {
        await tx.done.catch(() => {});
        throw error;
      }
    });
  } finally {
    db.close();
  }
}
