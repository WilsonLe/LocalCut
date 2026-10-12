import { invariant } from './errors';
import type { LibraryEntry } from './media-library';

export function libraryDescendants(
  entries: LibraryEntry[],
  id: string,
): LibraryEntry[] {
  const result = entries.filter((entry) => entry.id === id);
  for (let i = 0; i < result.length; i++)
    result.push(...entries.filter((entry) => entry.parentId === result[i]!.id));
  return result;
}
export function libraryPath(entries: LibraryEntry[], id: string): string {
  const entry = entries.find((entry) => entry.id === id);
  invariant(entry, 'NOT_FOUND', 'Library entry no longer exists.');
  if (entry.trashed) return `media-trash/${entry.id}/${entry.name}`;
  return entry.parentId
    ? `${libraryPath(entries, entry.parentId)}/${entry.name}`
    : `media-library/${entry.name}`;
}
