import { asEditorError } from '../core/errors';
import { checkAbort } from '../services/jobs';

interface Transaction {
  abort(): void;
  done: Promise<unknown>;
}

/** Cancellation wins until IndexedDB commits; a committed result is final. */
export async function commitWithSignal<T>(
  transaction: Transaction,
  signal: AbortSignal | undefined,
  write: () => Promise<T>,
): Promise<T> {
  const abort = () => {
    try {
      transaction.abort();
    } catch {
      // A transaction which already committed cannot be rolled back.
    }
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    checkAbort(signal);
    const result = await write();
    await transaction.done;
    return result;
  } catch (error) {
    abort();
    await transaction.done.catch(() => {});
    checkAbort(signal);
    throw asEditorError(error);
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
