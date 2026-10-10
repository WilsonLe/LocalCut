import type { ServiceRoutes } from '../ai/providers';
export interface ProviderProfile {
  id: string;
  name: string;
  kind: 'openrouter' | 'compatible' | 'chatgpt';
  baseUrl?: string;
  model?: string;
  speechModel?: string;
  voices?: string[];
}
export interface ProviderConfiguration {
  profiles: ProviderProfile[];
  routes: ServiceRoutes;
}
export const defaultProviderConfiguration = (): ProviderConfiguration => ({
  profiles: [{ id: 'openrouter', name: 'OpenRouter', kind: 'openrouter' }],
  routes: {
    llm: [{ providerId: 'openrouter', model: '' }],
    tts: [{ providerId: 'openrouter', model: '' }],
    stt: [{ providerId: 'local', model: 'whisper' }],
  },
});
const modelId = (v: unknown) =>
  typeof v === 'string' &&
  (v === '' ||
    (/^~?[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(v) &&
      !v.includes('://') &&
      v !== 'openrouter/auto'));
/** Whitelist portable configuration. Credentials, callback URLs and consent are never admitted. */
export function parseProviderConfiguration(raw: string): ProviderConfiguration {
  try {
    if (raw.length > 65536) return defaultProviderConfiguration();
    const value = JSON.parse(raw) as ProviderConfiguration;
    if (
      !value ||
      !Array.isArray(value.profiles) ||
      value.profiles.length > 20 ||
      !value.routes
    )
      return defaultProviderConfiguration();
    const profiles: ProviderProfile[] = [];
    for (const p of value.profiles) {
      if (
        !p ||
        typeof p.id !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,80}$/.test(p.id) ||
        profiles.some((x) => x.id === p.id) ||
        typeof p.name !== 'string' ||
        p.name.trim().length === 0 ||
        p.name.length > 80 ||
        !['openrouter', 'compatible', 'chatgpt'].includes(p.kind) ||
        (p.kind === 'openrouter' && p.id !== 'openrouter') ||
        (p.kind !== 'openrouter' && p.id === 'openrouter')
      )
        return defaultProviderConfiguration();
      const profile: ProviderProfile = { id: p.id, name: p.name, kind: p.kind };
      if (p.kind === 'compatible') {
        const url = new URL(p.baseUrl!);
        if (
          p.baseUrl!.length > 2048 ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          !(
            url.protocol === 'https:' ||
            (url.protocol === 'http:' &&
              ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
          )
        )
          return defaultProviderConfiguration();
        profile.baseUrl = url.href.replace(/\/+$/, '');
        if (p.model !== undefined) {
          if (!modelId(p.model) || !p.model)
            return defaultProviderConfiguration();
          profile.model = p.model;
        }
        if (p.speechModel !== undefined) {
          if (!modelId(p.speechModel) || !p.speechModel)
            return defaultProviderConfiguration();
          profile.speechModel = p.speechModel;
        }
        if (p.voices !== undefined) {
          if (
            !Array.isArray(p.voices) ||
            p.voices.length > 256 ||
            !p.voices.every(
              (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(v),
            )
          )
            return defaultProviderConfiguration();
          profile.voices = [...new Set(p.voices)];
        }
      }
      profiles.push(profile);
    }
    if (!profiles.some((p) => p.id === 'openrouter'))
      profiles.unshift({
        id: 'openrouter',
        name: 'OpenRouter',
        kind: 'openrouter',
      });
    const routes: ServiceRoutes = {
      llm: [],
      tts: [],
      stt: [{ providerId: 'local', model: 'whisper' }],
    };
    for (const service of ['llm', 'tts'] as const) {
      if (
        !Array.isArray(value.routes[service]) ||
        value.routes[service].length > 20
      )
        return defaultProviderConfiguration();
      for (const r of value.routes[service]) {
        const p = profiles.find((p) => p.id === r?.providerId);
        if (
          !p ||
          routes[service].some((x) => x.providerId === r.providerId) ||
          !modelId(r.model) ||
          (service === 'tts' &&
            (p.kind === 'chatgpt' ||
              (p.kind === 'compatible' && !p.speechModel))) ||
          (service === 'llm' && p.kind === 'compatible' && !p.model)
        )
          return defaultProviderConfiguration();
        const route = {
          providerId: r.providerId,
          model: r.model,
          ...(typeof r.voice === 'string' &&
          /^[A-Za-z0-9_-]{1,80}$/.test(r.voice)
            ? { voice: r.voice }
            : {}),
        };
        routes[service].push(route);
      }
    }
    return { profiles, routes };
  } catch {
    return defaultProviderConfiguration();
  }
}
