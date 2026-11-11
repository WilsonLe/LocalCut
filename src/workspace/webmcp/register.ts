import type { ModelContext, SiteToolHost } from './types';
import { projectTools } from './tools';

/** Only own our registrations; abort never clears another feature's tools. */
export function registerProjectTools(
  context: ModelContext,
  host: SiteToolHost,
) {
  const controller = new AbortController();
  const project = projectTools(host, controller.signal);
  const ready = (async () => {
    try {
      for (const tool of project.tools) {
        if (controller.signal.aborted) return;
        await context.registerTool(tool, { signal: controller.signal });
      }
    } catch (error) {
      if (!controller.signal.aborted) host.onError(error);
      controller.abort();
      await project.dispose();
    }
  })();
  return {
    ready,
    async dispose() {
      controller.abort();
      await project.dispose();
      await ready;
    },
  };
}
