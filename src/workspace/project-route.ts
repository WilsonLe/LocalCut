export type ProjectRoute =
  { screen: 'editor' | 'projects'; projectId?: string } | { screen: 'invalid' };

const validId = (id: string) => id.length > 0 && id.length <= 200;
// Dot-only segments are normalized away by browsers, even when percent-encoded.
// Reserve a literal tilde for them and escape tildes in ordinary identities.
const encodeId = (id: string) =>
  id === '.' || id === '..'
    ? `~${id}`
    : encodeURIComponent(id).replace(/~/g, '%7E');

/** Only local project identity belongs in the URL, never documents or credentials. */
export function parseProjectRoute(pathname: string, search = ''): ProjectRoute {
  const query = new URLSearchParams(search);
  if (pathname === '/' || pathname === '/projects') {
    const ids = query.getAll('project');
    if (ids.length > 1) return { screen: 'invalid' };
    const projectId = ids[0];
    return projectId === undefined || validId(projectId)
      ? { screen: 'projects', ...(projectId ? { projectId } : {}) }
      : { screen: 'invalid' };
  }
  const match = /^\/(workspace|project)\/([^/]+)$/.exec(pathname);
  if (!match || query.has('project')) return { screen: 'invalid' };
  try {
    const segment = match[2]!;
    const projectId =
      match[1] === 'workspace' && (segment === '~.' || segment === '~..')
        ? segment.slice(1)
        : decodeURIComponent(segment);
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
    ? `/${id ? `?project=${encodeURIComponent(id)}` : ''}`
    : id
      ? `/workspace/${encodeId(id)}`
      : '/';
}
