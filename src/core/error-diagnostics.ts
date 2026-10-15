/** Local error snapshots only. Never traverse unrelated project/provider data or credentials. */
export interface ErrorDiagnostic {
  name: string;
  message: string;
  code?: string;
  stack: string;
  details?: Record<string, unknown>;
  cause?: ErrorDiagnostic;
  errors?: ErrorDiagnostic[];
}

const providerReasons = [
  'context_length_exceeded',
  'max_tokens_exceeded',
  'token_limit_exceeded',
  'string_too_long',
  'invalid_request',
  'invalid_prompt',
  'payload_too_large',
  'unprocessable',
  'unsupported_parameter',
  'invalid_tool_call',
  'invalid_tool_results',
  'refusal',
  'content_policy_violation',
] as const;
const requestParameters = [
  'model',
  'messages',
  'tools',
  'tool_choice',
  'max_tokens',
  'max_completion_tokens',
  'parallel_tool_calls',
  'tool_calls',
  'tool_call_id',
  'reasoning',
  'reasoning_content',
  'reasoning_details',
] as const;
export type RecoveryDetails = {
  status?: number;
  reason?:
    | 'output_limit'
    | 'empty_response'
    | 'reviewer_protocol'
    | 'document_update_target'
    | 'attachment_unavailable';
  stage?:
    | 'request_contract'
    | 'session_todos'
    | 'completion_check'
    | 'assistant_response'
    | 'context_compaction';
  providerReason?: (typeof providerReasons)[number];
  parameter?: (typeof requestParameters)[number];
};

/** One bounded machine-data contract across direct errors, queued Jobs and local
 * diagnostics. Arbitrary remote text is never a recovery field. */
export function safeRecoveryDetails(
  value: unknown,
  code?: string,
): RecoveryDetails {
  const details: RecoveryDetails = {};
  if (!value || typeof value !== 'object') return details;
  const metadata = value as Record<string, unknown>;
  if (
    typeof metadata.status === 'number' &&
    Number.isInteger(metadata.status) &&
    metadata.status >= 400 &&
    metadata.status <= 599
  )
    details.status = metadata.status;
  if (
    code === 'RESPONSE_INCOMPLETE' &&
    (metadata.reason === 'output_limit' || metadata.reason === 'empty_response')
  )
    details.reason = metadata.reason;
  if (code === 'INVALID_RESPONSE' && metadata.reason === 'reviewer_protocol')
    details.reason = metadata.reason;
  if (
    code === 'INVALID_RESPONSE' &&
    metadata.reason === 'document_update_target'
  )
    details.reason = metadata.reason;
  if (
    code === 'INVALID_REQUEST' &&
    metadata.reason === 'attachment_unavailable'
  )
    details.reason = metadata.reason;
  if (
    metadata.stage === 'request_contract' ||
    metadata.stage === 'session_todos' ||
    metadata.stage === 'completion_check' ||
    metadata.stage === 'assistant_response' ||
    metadata.stage === 'context_compaction'
  )
    details.stage = metadata.stage;
  if (
    typeof metadata.providerReason === 'string' &&
    providerReasons.some((reason) => reason === metadata.providerReason)
  )
    details.providerReason =
      metadata.providerReason as RecoveryDetails['providerReason'];
  if (
    typeof metadata.parameter === 'string' &&
    requestParameters.some((parameter) => parameter === metadata.parameter)
  )
    details.parameter = metadata.parameter as RecoveryDetails['parameter'];
  return details;
}

/** Safe terminal chat diagnostics: never retain remote messages or stacks. */
export function safeChatFailure(value: unknown) {
  const error =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  const knownCodes = [
    'AUTH_REQUIRED',
    'AUTH_INVALID',
    'INSUFFICIENT_CREDITS',
    'RATE_LIMITED',
    'PROVIDER_UNAVAILABLE',
    'NETWORK_ERROR',
    'TIMEOUT',
    'CANCELLED',
    'DISPOSED',
    'MODEL_REQUIRED',
    'MODEL_UNSUPPORTED',
    'INVALID_REQUEST',
    'INVALID_RESPONSE',
    'RESPONSE_LIMIT',
    'RESPONSE_INCOMPLETE',
    'PROVIDER_REFUSAL',
    'BUSY',
    'REVISION_CONFLICT',
    'CONTEXT_LIMIT',
    'TOOL_LIMIT',
    'TOOL_NOT_ALLOWED',
    'INVALID_TOOL_ARGUMENTS',
    'EDIT_REJECTED',
  ];
  const code =
    typeof error.code === 'string' && knownCodes.includes(error.code)
      ? error.code
      : 'UNKNOWN';
  return { code, details: safeRecoveryDetails(error.details, code) };
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
  seen = new Set<object>(),
): ErrorDiagnostic {
  if (!error || typeof error !== 'object')
    return {
      name: 'Error',
      message: redactDiagnosticText(String(error)),
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
    typeof value.message === 'string'
      ? redactDiagnosticText(value.message)
      : 'Error details unavailable';
  const stack =
    typeof value.stack === 'string'
      ? value.stack
      : 'Stack trace unavailable: the source did not retain it.';
  const details: Record<string, unknown> = {};
  if (value.details && typeof value.details === 'object') {
    Object.assign(
      details,
      safeRecoveryDetails(
        value.details,
        typeof value.code === 'string' ? value.code : undefined,
      ),
    );
    for (const [key, entry] of Object.entries(value.details)) {
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
      ? { cause: errorDiagnostic(value.cause, seen) }
      : {}),
    ...(Array.isArray(value.errors)
      ? {
          errors: value.errors.map((item) => errorDiagnostic(item, seen)),
        }
      : {}),
  };
}
