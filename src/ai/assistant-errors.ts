import { EditorError } from '../core/errors';
import { AiError } from './errors';

export function cancelled(signal: AbortSignal) {
  if (signal.aborted)
    throw new AiError('CANCELLED', 'Assistant turn cancelled.');
}
export function localError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof EditorError)
    return new AiError(
      error.code === 'REVISION_CONFLICT'
        ? 'REVISION_CONFLICT'
        : error.code === 'CANCELLED'
          ? 'CANCELLED'
          : 'EDIT_REJECTED',
      error.code === 'REVISION_CONFLICT'
        ? 'The project changed. Request a new proposal.'
        : error.code === 'CANCELLED'
          ? 'Operation cancelled.'
          : 'The editor rejected this operation. Inspect the project and verify the requested settings.',
      { editorCode: error.code },
    );
  return new AiError(
    'INVALID_RESPONSE',
    'The assistant operation could not be completed.',
  );
}
export async function interruptible<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  cancelled(signal);
  let abort: (() => void) | undefined;
  const stop = new Promise<never>((_, reject) => {
    abort = () => reject(new AiError('CANCELLED', 'Assistant turn cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([promise, stop]);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
}
