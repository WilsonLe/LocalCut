export type AiErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_INVALID'
  | 'AUTH_FLOW_INVALID'
  | 'AUTH_EXPIRED'
  | 'AUTH_CANCELLED'
  | 'INSUFFICIENT_CREDITS'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'DISPOSED'
  | 'MODEL_REQUIRED'
  | 'MODEL_UNSUPPORTED'
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'RESPONSE_LIMIT'
  | 'RESPONSE_INCOMPLETE'
  | 'PROVIDER_REFUSAL'
  | 'BUSY'
  | 'PROPOSAL_NOT_FOUND'
  | 'PROPOSAL_DISCARDED'
  | 'REVISION_CONFLICT'
  | 'CONTEXT_LIMIT'
  | 'TOOL_LIMIT'
  | 'TOOL_NOT_ALLOWED'
  | 'INVALID_TOOL_ARGUMENTS'
  | 'EDIT_REJECTED';

/** Details must be local, bounded metadata, never remote error bodies or credentials. */
export class AiError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'AiError';
  }
}
export function aiInvariant(
  condition: unknown,
  code: AiErrorCode,
  message: string,
): asserts condition {
  if (!condition) throw new AiError(code, message);
}

/** Provider bodies can echo secrets or prompt data; only map status, never expose body text. */
export function httpError(status: number, retryAfter?: string | null): AiError {
  const retrySeconds = retryAfter ? Number(retryAfter) : NaN;
  const dateSeconds = retryAfter
    ? Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000)
    : NaN;
  const seconds = Number.isFinite(retrySeconds) ? retrySeconds : dateSeconds;
  const details: Record<string, unknown> = { status };
  if (Number.isFinite(seconds) && seconds >= 0)
    details.retryAfterSeconds = Math.min(Math.ceil(seconds), 86_400);
  if (status === 401 || status === 403)
    return new AiError(
      'AUTH_INVALID',
      'OpenRouter authorization was rejected.',
      details,
    );
  if (status === 402)
    return new AiError(
      'INSUFFICIENT_CREDITS',
      'OpenRouter credits are insufficient.',
      details,
    );
  if (status === 429)
    return new AiError(
      'RATE_LIMITED',
      'OpenRouter rate limit reached.',
      details,
    );
  return new AiError(
    status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'INVALID_REQUEST',
    status >= 500
      ? 'OpenRouter is unavailable.'
      : 'OpenRouter rejected the request.',
    details,
  );
}
