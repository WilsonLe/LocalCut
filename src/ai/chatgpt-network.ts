/** Allowlisted, content-free recovery text shared by transport and workspace. */
export function chatGPTNetworkErrorText(stage: unknown): string | undefined {
  switch (stage) {
    case 'chatgpt_signing_keys':
      return 'ChatGPT sign-in could not fetch OpenAI’s signing keys. Browser cross-origin access or the network may be blocking verification. Start a new sign-in after access is restored.';
    case 'chatgpt_code_exchange':
      return 'ChatGPT sign-in could not exchange the authorization code. Browser cross-origin access or the network may be blocking the token endpoint. Start a new sign-in after access is restored.';
    case 'chatgpt_token_refresh':
      return 'ChatGPT credentials could not be refreshed. Check network and browser cross-origin access, then reconnect.';
    case 'chatgpt_models':
      return 'The ChatGPT model catalog could not be reached. Check network and browser cross-origin access, then retry.';
    case 'chatgpt_response':
      return 'The ChatGPT request could not reach OpenAI. Check network and browser cross-origin access, then retry.';
  }
}
