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
export async function retireRemovedProviderCredentials(
  profile?: ProviderProfile,
) {
  const hasLegacyChatGPT = [
    ...Object.keys(window.localStorage),
    ...Object.keys(window.sessionStorage),
  ].some((key) => key.startsWith('localcut.chatgpt-'));
  // Serialize retirement with the old adapter's final authority check and token save.
  if (hasLegacyChatGPT && navigator.locks)
    await navigator.locks.request('localcut-chatgpt-credentials-v1', () =>
      retireAccounts(profile),
    );
  else retireAccounts(profile);
}

function retireAccounts(profile?: ProviderProfile) {
  const keep = accountCredentialKey(
    profile ?? { id: 'openrouter', kind: 'openrouter' },
  );
  const chatgptAuthority = 'localcut.chatgpt-authority.v1';
  const chatgptCredential = 'localcut.chatgpt-credentials.v1';
  const chatgptHost = 'localcut.chatgpt-host.v1';
  const chatgptPending = 'localcut.chatgpt-pkce.v1';
  const namespaces = new Set<string>();
  for (const key of [
    ...Object.keys(window.localStorage),
    ...Object.keys(window.sessionStorage),
  ]) {
    const prefix = [
      chatgptAuthority,
      chatgptCredential,
      chatgptHost,
      chatgptPending,
    ].find((candidate) => key === candidate || key.startsWith(`${candidate}:`));
    if (prefix) namespaces.add(key.slice(prefix.length));
  }
  // Old first-time exchanges captured null authority before they had a token.
  // Persistent host records also reveal pending flows owned by another tab.
  for (const suffix of namespaces) {
    window.localStorage.setItem(
      `${chatgptAuthority}${suffix}`,
      crypto.randomUUID(),
    );
    window.localStorage.removeItem(`${chatgptCredential}${suffix}`);
    window.localStorage.removeItem(`${chatgptHost}${suffix}`);
  }
  for (const key of Object.keys(window.localStorage)) {
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
