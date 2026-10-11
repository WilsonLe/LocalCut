export function errorCode(error: unknown): string {
  return error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : '';
}
export function errorText(error: unknown): string {
  if (
    errorCode(error) === 'INVALID_REQUEST' &&
    error &&
    typeof error === 'object' &&
    'details' in error &&
    error.details &&
    typeof error.details === 'object' &&
    'status' in error.details
  ) {
    const status = error.details.status;
    if (status === 404)
      return 'The selected model or endpoint is unavailable (HTTP 404). Refresh models or choose another tool-capable model.';
    if (status === 413)
      return 'The request is too large (HTTP 413). Start a new chat or shorten your message.';
    if (
      typeof status === 'number' &&
      Number.isInteger(status) &&
      status >= 400 &&
      status < 500
    )
      return `The provider rejected this request (HTTP ${status}). Check the selected model and request settings.`;
  }
  const messages: Record<string, string> = {
    INVALID_REQUEST: 'Check the selected model, endpoint and request settings.',
    AUTH_STORAGE:
      'Credentials could not be saved. Allow browser storage and reconnect.',
    AUTH_REQUIRED: 'Connect a provider for this service to continue.',
    AUTH_INVALID:
      'Authorization was rejected. Check credentials and reconnect.',
    AUTH_STORAGE_UNAVAILABLE:
      'OpenRouter credentials could not be saved, read or removed. Allow local browser storage, then reconnect or Disconnect again.',
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
