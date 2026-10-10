import { useEffect, useSyncExternalStore } from 'react';
export const INDEX_CONSENT_KEY = 'localcut.asset-index-consent.v1';
let allowed = false,
  initialized = false;
const listeners = new Set<() => void>();
export function readIndexConsent(raw: string | null) {
  try {
    const value = JSON.parse(raw ?? 'null');
    return (
      value?.version === 1 &&
      value.provider === 'openrouter' &&
      value.allowed === true
    );
  } catch {
    return false;
  }
}
function notify() {
  for (const listener of listeners) listener();
}
function initialize() {
  if (initialized) return;
  initialized = true;
  try {
    allowed = readIndexConsent(localStorage.getItem(INDEX_CONSENT_KEY));
  } catch {
    allowed = false;
  }
  window.addEventListener('storage', (event) => {
    if (event.key !== INDEX_CONSENT_KEY && event.key !== null) return;
    try {
      allowed = readIndexConsent(localStorage.getItem(INDEX_CONSENT_KEY));
    } catch {
      allowed = false;
    }
    notify();
  });
  notify();
}
export function saveIndexConsent(value: boolean) {
  allowed = value;
  let saved = true;
  try {
    localStorage.setItem(
      INDEX_CONSENT_KEY,
      JSON.stringify({ version: 1, provider: 'openrouter', allowed: value }),
    );
  } catch {
    saved = false;
  }
  notify();
  return saved;
}
export const getIndexConsent = () => allowed;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useIndexConsent() {
  useEffect(initialize, []);
  return useSyncExternalStore(subscribe, getIndexConsent);
}
