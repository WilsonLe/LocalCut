export type ProjectRoute =
  { screen: 'editor' | 'projects'; projectId?: string } | { screen: 'invalid' };

const validId = (id: string) => id.length > 0 && id.length <= 200;
const encodeId = (id: string) => encodeURIComponent(id).replace(/\./g, '%2E');

/** Only local project identity belongs in the URL, never documents or credentials. */
export function parseProjectRoute(pathname: string, search = ''): ProjectRoute {
  const query = new URLSearchParams(search);
  if (pathname === '/' && !search) return { screen: 'editor' };
  if (pathname === '/projects') {
    const ids = query.getAll('project');
    if ([...query.keys()].some((key) => key !== 'project') || ids.length > 1)
      return { screen: 'invalid' };
    const projectId = ids[0];
    return projectId === undefined || validId(projectId)
      ? { screen: 'projects', ...(projectId ? { projectId } : {}) }
      : { screen: 'invalid' };
  }
  const match = /^\/project\/([^/]+)$/.exec(pathname);
  if (!match || search) return { screen: 'invalid' };
  try {
    const projectId = decodeURIComponent(match[1]!);
    return validId(projectId)
      ? { screen: 'editor', projectId }
      : { screen: 'invalid' };
  } catch {
    return { screen: 'invalid' };
  }
}

export function projectRoutePath(screen: 'editor' | 'projects', id?: string) {
  if (id && !validId(id)) throw new Error('Invalid project ID.');
  return screen === 'projects'
    ? `/projects${id ? `?project=${encodeId(id)}` : ''}`
    : id
      ? `/project/${encodeId(id)}`
      : '/';
}
