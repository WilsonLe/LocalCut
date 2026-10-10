import { AiError, aiInvariant } from './errors';
import type { AuthorizationStorage } from './types';

import { CREDENTIAL_STORAGE_KEY } from './credential-storage-key';
export { CREDENTIAL_STORAGE_KEY } from './credential-storage-key';
export type CredentialStorage = () => AuthorizationStorage;

export function credentialKey(value: unknown): string {
  aiInvariant(
    typeof value === 'string',
    'AUTH_INVALID',
    'An OpenRouter API key is required.',
  );
  const key = value.trim();
  aiInvariant(
    /^[\x21-\x7e]{8,4096}$/.test(key),
    'AUTH_INVALID',
    'OpenRouter API key format is invalid.',
  );
  return key;
}

function access<T>(
  storage: CredentialStorage,
  operation: (store: AuthorizationStorage) => T,
): T {
  try {
    return operation(storage());
  } catch {
    throw new AiError(
      'AUTH_STORAGE_UNAVAILABLE',
      'OpenRouter credentials could not be saved or read. Allow local browser storage and reconnect.',
    );
  }
}
export function readCredential(storage?: CredentialStorage): string | null {
  if (!storage) return null;
  const raw = access(storage, (store) => store.getItem(CREDENTIAL_STORAGE_KEY));
  if (raw === null) return null;
  try {
    if (raw.length > 8192) throw new Error();
    const record: unknown = JSON.parse(raw);
    if (
      !record ||
      typeof record !== 'object' ||
      !('version' in record) ||
      record.version !== 1 ||
      !('key' in record)
    )
      throw new Error();
    return credentialKey(record.key);
  } catch {
    throw new AiError(
      'AUTH_INVALID',
      'Saved OpenRouter credentials are invalid. Reconnect or Disconnect to remove them.',
    );
  }
}
export function writeCredential(
  storage: CredentialStorage | undefined,
  key: string,
): void {
  if (storage)
    access(storage, (store) =>
      store.setItem(
        CREDENTIAL_STORAGE_KEY,
        JSON.stringify({ version: 1, key }),
      ),
    );
}
export function clearCredential(storage?: CredentialStorage): void {
  if (storage)
    access(storage, (store) => store.removeItem(CREDENTIAL_STORAGE_KEY));
}
