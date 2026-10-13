import type { AiError } from './errors';

/** Same frozen chat request only; never use this policy for tool/service actions. */
export function inferenceRetryDelay(
  error: AiError,
  attempt: number,
  visibleText = false,
): number | undefined {
  const transient =
    [
      'NETWORK_ERROR',
      'TIMEOUT',
      'RATE_LIMITED',
      'PROVIDER_UNAVAILABLE',
      'RESPONSE_INCOMPLETE',
    ].includes(error.code) && error.details.reason !== 'output_limit';
  const retryAfter = error.details.retryAfterSeconds;
  const waitMs = Math.max(
    500 * 2 ** attempt,
    typeof retryAfter === 'number' && Number.isFinite(retryAfter)
      ? retryAfter * 1000
      : 0,
  );
  if (!transient || visibleText || attempt >= 2 || waitMs > 30_000) return;
  return waitMs;
}
