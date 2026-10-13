import { safeRecoveryDetails } from '../core/error-diagnostics';

export type AiErrorCode =
  | 'AUTH_STORAGE'
  | 'AUTH_REQUIRED'
  | 'AUTH_INVALID'
  | 'AUTH_STORAGE_UNAVAILABLE'
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

/** Provider bodies can echo secrets or prompt data. Copy only fixed machine
 * categories, never provider messages, arbitrary parameters or raw metadata. */
export function httpError(
  status: number,
  retryAfter?: string | null,
  diagnostic?: unknown,
): AiError {
  const retrySeconds = retryAfter ? Number(retryAfter) : NaN;
  const dateSeconds = retryAfter
    ? Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000)
    : NaN;
  const seconds = Number.isFinite(retrySeconds) ? retrySeconds : dateSeconds;
  const details: Record<string, unknown> = { status };
  if (diagnostic && typeof diagnostic === 'object') {
    const error = diagnostic as Record<string, unknown>;
    const metadata = error.metadata;
    // Providers use code, type or metadata.error_type for machine categories.
    // Prefer a recognized category; an unknown wrapper must not hide it.
    for (const category of [
      metadata && typeof metadata === 'object' && 'error_type' in metadata
        ? metadata.error_type
        : undefined,
      error.code,
      error.type,
    ]) {
      const safe = safeRecoveryDetails({ providerReason: category });
      if (safe.providerReason) {
        details.providerReason = safe.providerReason;
        break;
      }
    }
    Object.assign(details, safeRecoveryDetails({ parameter: error.param }));
  }
  if (Number.isFinite(seconds) && seconds >= 0)
    details.retryAfterSeconds = Math.min(Math.ceil(seconds), 86_400);
  if (
    details.providerReason === 'refusal' ||
    details.providerReason === 'content_policy_violation'
  )
    return new AiError(
      'PROVIDER_REFUSAL',
      'OpenRouter declined the request.',
      details,
    );
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
  if (status === 408)
    return new AiError('TIMEOUT', 'OpenRouter request timed out.', details);
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
      : `OpenRouter rejected the request (HTTP ${status}).`,
    details,
  );
}
