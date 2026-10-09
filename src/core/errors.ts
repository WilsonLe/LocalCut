export type ErrorCode =
  | 'INVALID_DOCUMENT'
  | 'INVALID_COMMAND'
  | 'REVISION_CONFLICT'
  | 'REQUEST_CONFLICT'
  | 'NOT_FOUND'
  | 'MISSING_ASSET'
  | 'UNSUPPORTED_CODEC'
  | 'AMBIGUOUS_STREAM'
  | 'QUOTA_EXCEEDED'
  | 'CANCELLED'
  | 'WORKER_FAILED'
  | 'PLAYBACK_BLOCKED'
  | 'MODEL_REQUIRED'
  | 'MODEL_DOWNLOAD_FAILED'
  | 'DISPOSED';
export class EditorError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'EditorError';
  }
}
export function invariant(
  condition: unknown,
  code: ErrorCode,
  message: string,
): asserts condition {
  if (!condition) throw new EditorError(code, message);
}
export function asEditorError(error: unknown): EditorError {
  if (error instanceof EditorError) return error;
  if (error instanceof DOMException && error.name === 'QuotaExceededError')
    return new EditorError('QUOTA_EXCEEDED', error.message);
  if (error instanceof DOMException && error.name === 'AbortError')
    return new EditorError('CANCELLED', 'Operation cancelled');
  return new EditorError(
    'WORKER_FAILED',
    error instanceof Error ? error.message : String(error),
  );
}
