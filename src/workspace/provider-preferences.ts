import type { ServiceRoutes } from '../ai/providers';
import type { ContextPolicy } from '../ai/context';
export interface ProviderProfile {
  id: string;
  name: string;
  kind: 'openrouter';
}
export interface ProviderConfiguration {
  profiles: ProviderProfile[];
  routes: ServiceRoutes;
}
/** Connection terms authorize workspace context; portable profiles alone grant nothing. */
export function workspaceContextPolicy(
  profiles: ProviderProfile[],
  connectedProviders: string[],
): Required<ContextPolicy> {
  const connected = profiles.some(
    (profile) =>
      profile.kind === 'openrouter' && connectedProviders.includes(profile.id),
  );
  return {
    includeText: connected,
    includeAssetNames: connected,
    includeTranscripts: connected,
    includeCaptureMetadata: connected,
    // Saved labels retain the existing workspace policy; execution still needs a live indexer.
    includeAssetIndexes: true,
  };
}
export const defaultProviderConfiguration = (): ProviderConfiguration => ({
  profiles: [],
  routes: {
    llm: [],
    tts: [],
    stt: [{ providerId: 'local', model: 'whisper' }],
  },
});
const modelId = (v: unknown) =>
  typeof v === 'string' &&
  (v === '' ||
    (/^~?[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(v) &&
      !v.includes('://') &&
      v !== 'openrouter/auto'));
/** Normalize legacy/portable settings without importing credentials or backup authority. */
export function parseProviderConfiguration(raw: string): ProviderConfiguration {
  const empty = defaultProviderConfiguration();
  try {
    if (raw.length > 65536) return empty;
    const value = JSON.parse(raw);
    if (
      !value ||
      !Array.isArray(value.profiles) ||
      value.profiles.length > 20 ||
      !value.routes
    )
      return empty;
    // Retain the previously selected OpenRouter account, or the first valid OpenRouter.
    const valid = value.profiles.filter(
      (p: ProviderProfile) =>
        p &&
        p.kind === 'openrouter' &&
        typeof p.id === 'string' &&
        /^[a-zA-Z0-9_-]{1,80}$/.test(p.id) &&
        p.id !== 'local' &&
        typeof p.name === 'string' &&
        p.name.trim().length > 0 &&
        p.name.length <= 80,
    );
    const account =
      valid.find(
        (p: ProviderProfile) => p.id === value.routes.llm?.[0]?.providerId,
      ) ?? valid[0];
    if (!account) return empty;
    const profile: ProviderProfile = {
      id: account.id,
      name: 'OpenRouter',
      kind: 'openrouter',
    };
    const routes: ServiceRoutes = {
      llm: [{ providerId: profile.id, model: '' }],
      tts: [{ providerId: profile.id, model: '' }],
      stt: empty.routes.stt,
    };
    for (const service of ['llm', 'tts', 'stt'] as const) {
      const previous = value.routes[service];
      if (!Array.isArray(previous) || previous.length > 20) continue;
      // A removed primary never promotes a remote STT backup over local transcription.
      const route =
        service === 'stt'
          ? previous[0]
          : previous.find((r) => r?.providerId === profile.id);
      if (
        route?.providerId !== profile.id ||
        !modelId(route.model) ||
        (service === 'stt' && !route.model)
      )
        continue;
      routes[service] = [
        {
          providerId: profile.id,
          model: route.model,
          ...(service === 'tts' &&
          typeof route.voice === 'string' &&
          /^[A-Za-z0-9_-]{1,80}$/.test(route.voice)
            ? { voice: route.voice }
            : {}),
        },
      ];
    }
    return { profiles: [profile], routes };
  } catch {
    return empty;
  }
}
