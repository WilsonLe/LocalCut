import { chatGPTNetworkErrorText } from '../ai/chatgpt-network';
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
    errorCode(error) === 'NETWORK_ERROR' &&
    error &&
    typeof error === 'object' &&
    'details' in error &&
    error.details &&
    typeof error.details === 'object' &&
    'stage' in error.details
  ) {
    const text = chatGPTNetworkErrorText(error.details.stage);
    if (text) return text;
  }
  if (
    errorCode(error) === 'AUTH_FLOW_INVALID' &&
    error &&
    typeof error === 'object' &&
    'details' in error &&
    error.details &&
    typeof error.details === 'object' &&
    'stage' in error.details &&
    error.details.stage === 'chatgpt_identity'
  ) {
    const reasons: Record<string, string> = {
      token_response: 'ChatGPT returned incomplete sign-in credentials.',
      token_format: 'ChatGPT returned an unsupported identity token.',
      issuer: 'The ChatGPT identity token has an unexpected issuer.',
      audience: 'The ChatGPT identity token does not authorize this app.',
      token_expired:
        'The ChatGPT identity token has expired. Check your device clock.',
      token_not_yet_valid:
        'The ChatGPT identity token is not valid yet. Check your device clock.',
      nonce: 'The ChatGPT identity token does not match this sign-in attempt.',
      subject:
        'The ChatGPT identity token does not match the selected account.',
      signature: 'The ChatGPT identity token signature could not be verified.',
    };
    const reason = 'reason' in error.details ? error.details.reason : undefined;
    const message =
      typeof reason === 'string' && Object.hasOwn(reasons, reason)
        ? reasons[reason]
        : 'ChatGPT identity verification failed.';
    return `${message} Start a new connection with Continue with ChatGPT.`;
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
    return 'The provider returned an empty reply. Send your request again to retry, or choose another model. Any completed actions remain saved.';
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
