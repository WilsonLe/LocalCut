import { aiInvariant } from './errors';

/** Routing/observability identity, never a name, prompt or global user identifier. */
export function requestSessionId(value?: string): string {
  aiInvariant(
    value === undefined ||
      (typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(value)),
    'INVALID_REQUEST',
    'AI session ID must be an opaque identifier of 1 to 256 characters.',
  );
  return value ?? crypto.randomUUID();
}

/** Public application identity; never derive attribution from a private page URL. */
export const applicationHeaders = Object.freeze({
  'HTTP-Referer': 'https://wilsonle.github.io/LocalCut/',
  'X-OpenRouter-Title': 'LocalCut',
});
