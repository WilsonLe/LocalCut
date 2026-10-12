import { z } from 'zod';
import { libraryDescendants } from './media-library-path';

export const libraryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine(
    (name) =>
      name !== '.' &&
      name !== '..' &&
      !name.includes('/') &&
      !name.includes('\\') &&
      !Array.from(name).some((char) => char.charCodeAt(0) < 32),
    'Use a filename without slashes or control characters.',
  );
const id = z.string().min(1).max(200);
export const libraryOperationSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('create'),
      parentId: id.nullable(),
      name: libraryNameSchema,
    })
    .strict(),
  z
    .object({ type: z.literal('rename'), entryId: id, name: libraryNameSchema })
    .strict(),
  z
    .object({
      type: z.literal('move'),
      entryId: id,
      parentId: id.nullable(),
      name: libraryNameSchema.optional(),
    })
    .strict(),
  z
    .object({ type: z.literal('copy'), entryId: id, parentId: id.nullable() })
    .strict(),
  z.object({ type: z.literal('trash'), entryId: id }).strict(),
  z.object({ type: z.literal('restore'), entryId: id }).strict(),
]);
export type LibraryOperation = z.infer<typeof libraryOperationSchema>;
export interface LibraryEntry {
  id: string;
  parentId: string | null;
  name: string;
  kind: 'folder' | 'asset';
  assetId?: string;
  trashed?: boolean;
  previousParentId?: string | null;
  sourceSignature?: string;
}
export interface LibrarySnapshot {
  revision: number;
  entries: LibraryEntry[];
}
export { libraryDescendants, libraryPath } from './media-library-path';
export function availableLibraryName(
  entries: LibraryEntry[],
  parentId: string | null,
  requested: string,
) {
  const name = libraryNameSchema.parse(requested);
  const taken = (value: string) =>
    entries.some(
      (entry) =>
        !entry.trashed && entry.parentId === parentId && entry.name === value,
    );
  if (!taken(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot, dot + 100) : '';
  for (let i = 2; ; i++) {
    const candidate = `${stem.slice(0, 220 - extension.length)} (${i})${extension}`;
    if (!taken(candidate)) return candidate;
  }
}

/** Freeze the released shared library into existing project owners without loss. */
export function assignLegacyLibrary(
  entries: LibraryEntry[],
  references: ReadonlyMap<string, ReadonlySet<string>>,
) {
  const owners = [...references.keys()].sort();
  const referenced = new Set(
    [...references.values()].flatMap((ids) => [...ids]),
  );
  const result: Record<string, LibraryEntry[]> = {};
  for (const projectId of owners) {
    const fallback = projectId === owners[0];
    const selected = new Set<string>();
    const include = (id: string | null | undefined) => {
      const entry = entries.find((entry) => entry.id === id);
      if (!entry || selected.has(entry.id)) return;
      selected.add(entry.id);
      include(entry.parentId);
      include(entry.previousParentId);
    };
    for (const entry of entries) {
      if (
        entry.assetId
          ? references.get(projectId)!.has(entry.assetId) ||
            (fallback && !referenced.has(entry.assetId))
          : fallback &&
            !libraryDescendants(entries, entry.id).some(
              (child) => child.assetId,
            )
      )
        include(entry.id);
    }
    result[projectId] = entries.filter((entry) => selected.has(entry.id));
  }
  return result;
}
