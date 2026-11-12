import type { ModelContext, SiteToolHost } from './types';
import { browserAgentConnection } from './connection';

/** Only own our registrations; abort never clears another feature's tools. */
export function registerProjectTools(
  context: ModelContext | (() => ModelContext | undefined),
  host: SiteToolHost,
) {
  return browserAgentConnection.bind(
    'project',
    typeof context === 'function' ? context : () => context,
    async (signal) => {
      const { projectTools } = await import('./tools');
      return signal.aborted ? { tools: [] } : projectTools(host, signal);
    },
    host.onError,
  );
}
