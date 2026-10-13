export function errorCode(error: unknown): string {
  return error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : '';
}
export function errorText(error: unknown): string {
  const message = requestErrorText(error);
  const details =
    error && typeof error === 'object' && 'details' in error
      ? error.details
      : undefined;
  if (details && typeof details === 'object' && 'stage' in details) {
    if (details.stage === 'request_contract')
      return `The initial goal check failed. ${message} Any completed actions remain saved.`;
    if (details.stage === 'completion_check')
      return `The completion check failed after the assistant response. ${message} Any completed actions remain saved.`;
  }
  return message;
}

function requestErrorText(error: unknown): string {
  const details =
    error && typeof error === 'object' && 'details' in error
      ? error.details
      : undefined;
  if (details && typeof details === 'object') {
    if ('reason' in details && details.reason === 'attachment_unavailable')
      return 'An attached image is unavailable. Restore it in Media before retrying, or send a new request with a replacement image.';
    if ('reason' in details && details.reason === 'reviewer_protocol')
      return 'The model returned tool protocol instead of a plain-text review after recovery attempts. Use Retry response, or choose another model.';
    if ('providerReason' in details) {
      switch (details.providerReason) {
        case 'context_length_exceeded':
        case 'string_too_long':
        case 'payload_too_large':
          return 'The provider rejected the conversation size. Existing history is preserved. Start a separate chat or choose a model with a larger context window.';
        case 'max_tokens_exceeded':
        case 'token_limit_exceeded':
          return 'The provider rejected the token budget. Check the selected model and its output allowance.';
        case 'invalid_prompt':
          return 'The provider rejected the message format. Use Retry response after updating LocalCut, or choose another model.';
      }
    }
  }
  if (
    errorCode(error) === 'RESPONSE_INCOMPLETE' &&
    error &&
    typeof error === 'object' &&
    'details' in error &&
    error.details &&
    typeof error.details === 'object' &&
    'reason' in error.details &&
    error.details.reason === 'empty_response'
  )
    return 'The provider returned an empty reply after automatic retries. Use Retry response, or choose another model. Any completed actions remain saved.';
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
  if (
    errorCode(error) === 'RESPONSE_INCOMPLETE' &&
    error &&
    typeof error === 'object' &&
    'details' in error &&
    error.details &&
    typeof error.details === 'object' &&
    'reason' in error.details &&
    error.details.reason === 'output_limit'
  )
    return 'The model reached its response limit before finishing. No proposal was published. Try a smaller edit or another model.';
  const messages: Record<string, string> = {
    INVALID_REQUEST: 'Check the selected model, endpoint and request settings.',
    AUTH_STORAGE:
      'Credentials could not be saved. Allow browser storage and reconnect.',
    AUTH_REQUIRED: 'Connect a provider for this service to continue.',
    AUTH_INVALID:
      'Authorization was rejected. Check credentials and reconnect.',
    AUTH_STORAGE_UNAVAILABLE:
      'OpenRouter credentials could not be saved, read or removed. Allow local browser storage, then reconnect or Disconnect again.',
    AUTH_FLOW_INVALID: 'Sign-in could not be verified. Start a new connection.',
    AUTH_EXPIRED: 'The connection link expired. Start a new connection.',
    AUTH_CANCELLED: 'Provider connection was cancelled.',
    INSUFFICIENT_CREDITS: 'The provider account needs more credits.',
    RATE_LIMITED: 'The provider is rate limiting requests. Try again later.',
    MODEL_UNSUPPORTED: 'Choose a model that supports editing tools.',
    REVISION_CONFLICT: 'The project changed. Ask for a new proposal.',
    RESPONSE_INCOMPLETE:
      'The response ended early. No proposal was published. You can retry the request.',
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
