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
    INVALID_REQUEST: 'Check the endpoint, model, voice and request settings.',
    AUTH_STORAGE:
      'Credentials could not be saved. Allow browser storage and reconnect.',
    AUTH_REQUIRED: 'Connect a provider for this service to continue.',
    AUTH_INVALID:
      'Authorization was rejected. Check credentials and reconnect.',
    AUTH_FLOW_INVALID:
      'This connection link is invalid. Start a new connection.',
    AUTH_EXPIRED: 'The connection link expired. Start a new connection.',
    AUTH_CANCELLED: 'Provider connection was cancelled.',
    INSUFFICIENT_CREDITS: 'The provider account needs more credits.',
    RATE_LIMITED: 'The provider is rate limiting requests. Try again later.',
    MODEL_UNSUPPORTED: 'Choose a model that supports editing tools.',
    REVISION_CONFLICT: 'The project changed. Ask for a new proposal.',
    RESPONSE_INCOMPLETE: 'The response ended early. No proposal was published.',
    NETWORK_ERROR: 'The provider could not be reached. Check your connection.',
    TIMEOUT: 'The provider took too long. You can send the request again.',
    PROVIDER_UNAVAILABLE:
      'The selected provider is unavailable. Try again later.',
  };
  return (
    messages[errorCode(error)] ??
    'The AI request could not be completed. You can try again.'
  );
}
