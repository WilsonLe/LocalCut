import { z } from 'zod';

/** Keep the shared engine's coded failures intact at either site-tool boundary. */
export function toolErrorResult(error: unknown) {
  return {
    isError: true,
    error: {
      code:
        error instanceof DOMException && error.name === 'AbortError'
          ? 'CANCELLED'
          : error instanceof z.ZodError
            ? 'INVALID_COMMAND'
            : error && typeof error === 'object' && 'code' in error
              ? error.code
              : 'INVALID_COMMAND',
      message: error instanceof Error ? error.message : 'Tool failed',
      ...(error instanceof z.ZodError ? { issues: error.issues } : {}),
      ...(error && typeof error === 'object' && 'details' in error
        ? { details: error.details }
        : {}),
    },
  };
}
