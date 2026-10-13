import type { LibraryEntry, LibrarySnapshot } from '../core/media-library';
import { AiError } from './errors';
import type { ContextPolicy } from './context';

export interface LibraryQuery {
  folderId?: string | null;
  recursive?: boolean;
  includeTrashed?: boolean;
  offset?: number;
  limit?: number;
}

/** Registered project Media only, never a probe of the user's filesystem. */
export function librarySelection(
  library: LibrarySnapshot,
  query: LibraryQuery,
) {
  const byId = new Map(library.entries.map((entry) => [entry.id, entry]));
  const isTrashed = (entry: LibraryEntry) => {
    const seen = new Set<string>();
    let current: LibraryEntry | undefined = entry;
    while (current && !seen.has(current.id)) {
      if (current.trashed) return true;
      seen.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return false;
  };
  if (query.folderId != null) {
    const folder = byId.get(query.folderId);
    if (!folder || folder.kind !== 'folder')
      throw new AiError(
        'EDIT_REJECTED',
        'Folder is not in this project Media library. Inspect the library again.',
      );
    if (!query.includeTrashed && isTrashed(folder))
      throw new AiError(
        'EDIT_REJECTED',
        'Folder is in Trash. Restore it through Media before resolving assets.',
      );
  }
  const entries = library.entries.filter(
    (entry) => query.includeTrashed || !isTrashed(entry),
  );
  const descendants = (folderId: string | null) => {
    const found = new Set<string>();
    const parents = [folderId];
    for (let i = 0; i < parents.length; i++)
      for (const entry of entries)
        if (entry.parentId === parents[i] && !found.has(entry.id)) {
          found.add(entry.id);
          if (entry.kind === 'folder') parents.push(entry.id);
        }
    return entries.filter((entry) => found.has(entry.id));
  };
  const folderId = query.folderId ?? null;
  const selected =
    query.recursive === false
      ? entries.filter((entry) => entry.parentId === folderId)
      : descendants(folderId);
  return { entries, selected, descendants, isTrashed, folderId };
}

export function libraryContext(
  library: LibrarySnapshot,
  query: LibraryQuery,
  allowed: ReadonlySet<string>,
  policy: ContextPolicy,
) {
  const selection = librarySelection(library, query);
  const ids = (entries: LibraryEntry[]) => [
    ...new Set(
      entries.flatMap((entry) => (entry.assetId ? [entry.assetId] : [])),
    ),
  ];
  const registered = ids(selection.selected);
  const authorized = registered.filter((id) => allowed.has(id));
  const visible = selection.selected.filter(
    (entry) => !entry.assetId || allowed.has(entry.assetId),
  );
  const offset = query.offset ?? 0;
  // Pagination is optional, not a default hard ceiling on discovery.
  const limit = query.limit ?? visible.length;
  return {
    revision: library.revision,
    folderId: selection.folderId,
    recursive: query.recursive !== false,
    includeTrashed: !!query.includeTrashed,
    source: 'registered_project_media',
    registeredContentsResolved: true,
    childrenResolved: registered.length === authorized.length,
    registeredAssetCount: registered.length,
    authorizedAssetCount: authorized.length,
    withheldAssetCount: registered.length - authorized.length,
    status:
      registered.length === 0
        ? 'no_registered_media'
        : registered.length === authorized.length
          ? 'resolved'
          : 'assets_withheld',
    nextStep:
      registered.length === 0
        ? 'No registered media in this scope. Upload the files or folder through Media; if an import failed, inspect its task/error and retry that import. The assistant cannot scan an arbitrary computer folder.'
        : registered.length !== authorized.length
          ? 'Some registered assets are outside the caller allowlist. Attach them or let the trusted host authorize project-library resolution; do not describe this container as empty.'
          : 'Resolve the requested container to asset IDs before dependent work. Inspect metadata/readiness and reuse saved evidence before new indexing.',
    total: visible.length,
    offset,
    nextOffset: offset + limit < visible.length ? offset + limit : null,
    entries: visible.slice(offset, offset + limit).map(({ name, ...entry }) => {
      delete entry.sourceSignature;
      const children = selection.entries.filter(
        (child) => child.parentId === entry.id,
      );
      const descendants = selection.descendants(entry.id);
      const assetIds = ids(descendants);
      const authorizedIds = assetIds.filter((id) => allowed.has(id));
      return {
        ...entry,
        trashed: selection.isTrashed(entry as LibraryEntry),
        ...(policy.includeAssetNames ? { name } : {}),
        ...(entry.kind === 'folder'
          ? {
              childCount: children.length,
              assetCount: assetIds.length,
              authorizedAssetCount: authorizedIds.length,
              childrenResolved: assetIds.length === authorizedIds.length,
            }
          : {}),
      };
    }),
  };
}

export function resolveLibraryAssets(
  library: LibrarySnapshot,
  query: Pick<LibraryQuery, 'folderId' | 'recursive'>,
  allowed: ReadonlySet<string>,
  allowProjectLibrary: boolean,
) {
  const selection = librarySelection(library, query);
  const registered = [
    ...new Set(
      selection.selected.flatMap((entry) =>
        entry.assetId ? [entry.assetId] : [],
      ),
    ),
  ];
  const assetIds = registered.filter(
    (id) => allowProjectLibrary || allowed.has(id),
  );
  return {
    revision: library.revision,
    folderId: selection.folderId,
    recursive: query.recursive !== false,
    assetIds,
    assetCount: assetIds.length,
    registeredAssetCount: registered.length,
    withheldAssetCount: registered.length - assetIds.length,
    childrenResolved: registered.length === assetIds.length,
    status: !registered.length
      ? 'no_registered_media'
      : registered.length === assetIds.length
        ? 'resolved'
        : 'assets_withheld',
    indexingSubmitted: false,
  };
}
