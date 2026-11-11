/** Retire obsolete credentials locally without loading their former adapters or editing storage. */
export function retireLegacyAISettings(storage: Storage) {
  const prefixes = [
    'localcut.openrouter-credential.v1',
    'localcut.openrouter-account-pending.v1',
    'localcut-openrouter-oauth-v1',
    'localcut.chatgpt-credentials.v1',
    'localcut.chatgpt-authority.v1',
    'localcut.chatgpt-host.v1',
    'localcut.chatgpt-pkce.v1',
    'localcut.voice-presets.v1',
  ];
  const keys = Array.from({ length: storage.length }, (_, index) =>
    storage.key(index),
  );
  for (const key of keys) {
    if (
      key &&
      prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}:`))
    )
      storage.removeItem(key);
  }
}
