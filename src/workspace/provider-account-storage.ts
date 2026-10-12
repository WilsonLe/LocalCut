import type { AuthorizationStorage } from '../ai/types';
import type { ProviderProfile } from './provider-preferences';
import { CREDENTIAL_STORAGE_KEY } from '../ai/credential-storage-key';

export const OPENROUTER_ACCOUNT_PENDING =
  'localcut.openrouter-account-pending.v1';

/** Keep the retained legacy account’s existing credential namespace. */
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
  return accountStorageKey(profile, CREDENTIAL_STORAGE_KEY);
}

/** Remove saved authority even when this tab never activated the account. */
export function forgetAccount(profile: ProviderProfile) {
  const persistent = accountStorage(profile, () => window.localStorage);
  const temporary = accountStorage(profile, () => window.sessionStorage);
  persistent.removeItem(CREDENTIAL_STORAGE_KEY);
  temporary.removeItem('localcut-openrouter-oauth-v1');
  if (window.sessionStorage.getItem(OPENROUTER_ACCOUNT_PENDING) === profile.id)
    window.sessionStorage.removeItem(OPENROUTER_ACCOUNT_PENDING);
}

/** Retire removed account authority without restoring clients or sending requests. */
export function retireRemovedProviderCredentials(profile?: ProviderProfile) {
  const keep = accountCredentialKey(
    profile ?? { id: 'openrouter', kind: 'openrouter' },
  );
  for (const key of Object.keys(window.localStorage)) {
    if (
      key === 'localcut.chatgpt-credentials.v1' ||
      key.startsWith('localcut.chatgpt-credentials.v1:')
    ) {
      const suffix = key.slice('localcut.chatgpt-credentials.v1'.length);
      window.localStorage.setItem(
        `localcut.chatgpt-authority.v1${suffix}`,
        crypto.randomUUID(),
      );
      window.localStorage.removeItem(key);
    }
    if (
      (key === CREDENTIAL_STORAGE_KEY ||
        key.startsWith(`${CREDENTIAL_STORAGE_KEY}:`)) &&
      key !== keep
    )
      window.localStorage.removeItem(key);
  }
  const oauth = accountStorageKey(
    profile ?? { id: 'openrouter', kind: 'openrouter' },
    'localcut-openrouter-oauth-v1',
  );
  for (const key of Object.keys(window.sessionStorage)) {
    if (
      key === 'localcut.chatgpt-pkce.v1' ||
      key.startsWith('localcut.chatgpt-pkce.v1:') ||
      ((key === 'localcut-openrouter-oauth-v1' ||
        key.startsWith('localcut-openrouter-oauth-v1:')) &&
        key !== oauth)
    )
      window.sessionStorage.removeItem(key);
  }
}
