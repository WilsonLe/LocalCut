export function errorCode(error: unknown): string {
  return error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : '';
}
export function errorText(error: unknown): string {
  const messages: Record<string, string> = {
    AUTH_REQUIRED: 'Connect an OpenRouter account to continue.',
    AUTH_INVALID: 'OpenRouter rejected the key. Check it and connect again.',
    AUTH_FLOW_INVALID:
      'This connection link is invalid. Start a new connection.',
    AUTH_EXPIRED: 'The connection link expired. Start a new connection.',
    AUTH_CANCELLED: 'OpenRouter connection was cancelled.',
    INSUFFICIENT_CREDITS: 'Your OpenRouter account needs more credits.',
    RATE_LIMITED: 'OpenRouter is rate limiting requests. Try again later.',
    MODEL_UNSUPPORTED: 'Choose a model that supports editing tools.',
    REVISION_CONFLICT: 'The project changed. Ask for a new proposal.',
    RESPONSE_INCOMPLETE: 'The response ended early. No proposal was published.',
    NETWORK_ERROR: 'OpenRouter could not be reached. Check your connection.',
    TIMEOUT: 'OpenRouter took too long. You can send the request again.',
    PROVIDER_UNAVAILABLE:
      'The selected provider is unavailable. Try again later.',
  };
  return (
    messages[errorCode(error)] ??
    'The AI request could not be completed. You can try again.'
  );
}
