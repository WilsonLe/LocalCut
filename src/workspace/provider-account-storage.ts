import type { AuthorizationStorage } from '../ai/types';
import type { ProviderProfile } from './provider-preferences';
import { CREDENTIAL_STORAGE_KEY } from '../ai/credential-storage-key';

export const OPENROUTER_ACCOUNT_PENDING =
  'localcut.openrouter-account-pending.v1';

/** Legacy accounts keep their existing records; additional accounts get their own namespace. */
export function accountStorageKey(
  profile: Pick<ProviderProfile, 'id' | 'kind'>,
  key: string,
) {
  return profile.id === profile.kind ? key : `${key}:${profile.id}`;
}

export function accountStorage(
  profile: Pick<ProviderProfile, 'id' | 'kind'>,
  resolve: () => AuthorizationStorage,
): AuthorizationStorage {
  return {
    getItem: (key) => resolve().getItem(accountStorageKey(profile, key)),
    setItem: (key, value) =>
      resolve().setItem(accountStorageKey(profile, key), value),
    removeItem: (key) => resolve().removeItem(accountStorageKey(profile, key)),
  };
}

export function accountCredentialKey(
  profile: Pick<ProviderProfile, 'id' | 'kind'>,
) {
  return accountStorageKey(
    profile,
    profile.kind === 'chatgpt'
      ? 'localcut.chatgpt-credentials.v1'
      : CREDENTIAL_STORAGE_KEY,
  );
}

/** Remove saved authority even when this tab never activated the account. */
export function forgetAccount(profile: ProviderProfile) {
  if (profile.kind === 'compatible') return;
  const persistent = accountStorage(profile, () => window.localStorage);
  const temporary = accountStorage(profile, () => window.sessionStorage);
  if (profile.kind === 'chatgpt') {
    persistent.setItem('localcut.chatgpt-authority.v1', crypto.randomUUID());
    persistent.removeItem('localcut.chatgpt-credentials.v1');
    temporary.removeItem('localcut.chatgpt-pkce.v1');
  } else {
    persistent.removeItem(CREDENTIAL_STORAGE_KEY);
    temporary.removeItem('localcut-openrouter-oauth-v1');
    if (
      window.sessionStorage.getItem(OPENROUTER_ACCOUNT_PENDING) === profile.id
    )
      window.sessionStorage.removeItem(OPENROUTER_ACCOUNT_PENDING);
  }
}
