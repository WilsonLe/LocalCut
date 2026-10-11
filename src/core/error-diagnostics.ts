/** Local diagnostics only. Never traverse project data, provider bodies or credentials. */
export interface ErrorDiagnostic {
  name: string;
  message: string;
  code?: string;
  stack: string;
  details?: Record<string, unknown>;
  cause?: ErrorDiagnostic;
  errors?: ErrorDiagnostic[];
}

export function redactDiagnosticText(text: string): string {
  return (
    text
      .replace(/\b(?:Bearer\s+|sk-(?:or-v1-)?)[\w.+/-]+/gi, '[REDACTED]')
      .replace(
        /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret)\s*[:=]\s*)[^\s,;]+/gi,
        '$1[REDACTED]',
      )
      // Callback/provider URLs may carry credentials in any query or fragment field.
      .replace(/https?:\/\/[^\s)]+/g, (url) =>
        url.replace(/[?#].*$/, '[REDACTED URL PARAMETERS]'),
      )
  );
}

const metadataKeys = new Set([
  'status',
  'reason',
  'retryAfterSeconds',
  'operation',
  'requestId',
  'jobId',
  'taskId',
  'projectId',
  'assetId',
  'clipId',
  'trackId',
  'expectedRevision',
  'actualRevision',
  'revision',
  'width',
  'height',
  'size',
  'durationUs',
  'format',
  'codec',
  'stage',
]);

export function errorDiagnostic(
  error: unknown,
  includeMessage = true,
  seen = new Set<object>(),
): ErrorDiagnostic {
  if (!error || typeof error !== 'object')
    return {
      name: 'Error',
      message: includeMessage
        ? redactDiagnosticText(String(error))
        : 'Task failed',
      stack: 'Stack trace unavailable: no Error object was supplied.',
    };
  if (seen.has(error))
    return {
      name: 'Error',
      message: 'Circular error reference',
      stack: 'Stack trace unavailable: circular reference.',
    };
  seen.add(error);
  const value = error as Record<string, unknown>;
  const name = typeof value.name === 'string' ? value.name : 'Error';
  const message =
    includeMessage && typeof value.message === 'string'
      ? redactDiagnosticText(value.message)
      : 'Error details unavailable';
  let stack =
    typeof value.stack === 'string'
      ? value.stack
      : 'Stack trace unavailable: the source did not retain it.';
  if (!includeMessage && typeof value.stack === 'string') {
    // Unknown/provider messages can echo bodies. Keep every frame, omit the header.
    const frames = stack
      .split('\n')
      .filter(
        (line) =>
          /^\s*at\s/.test(line) || /@(?:https?:|file:|blob:|\/)/.test(line),
      );
    stack = `${name}: [message omitted]${frames.length ? '\n' + frames.join('\n') : '\nStack trace unavailable: no source frames were retained.'}`;
  }
  const details: Record<string, unknown> = {};
  if (value.details && typeof value.details === 'object') {
    for (const [key, entry] of Object.entries(value.details)) {
      if (
        !includeMessage &&
        !(key === 'status' && typeof entry === 'number') &&
        !(key === 'reason' && entry === 'output_limit')
      )
        continue;
      if (
        metadataKeys.has(key) &&
        (typeof entry === 'string' ||
          typeof entry === 'number' ||
          typeof entry === 'boolean')
      )
        details[key] =
          typeof entry === 'string' ? redactDiagnosticText(entry) : entry;
    }
  }
  return {
    name: redactDiagnosticText(name),
    message,
    ...(typeof value.code === 'string'
      ? { code: redactDiagnosticText(value.code) }
      : {}),
    stack: redactDiagnosticText(stack),
    ...(Object.keys(details).length ? { details } : {}),
    ...(value.cause !== undefined
      ? { cause: errorDiagnostic(value.cause, includeMessage, seen) }
      : {}),
    ...(Array.isArray(value.errors)
      ? {
          errors: value.errors.map((item) =>
            errorDiagnostic(item, includeMessage, seen),
          ),
        }
      : {}),
  };
}
