# Local persistence

This directory owns IndexedDB commits, OPFS file access, journals, resource locks,
and quota recovery. Read [storage and recovery](../../docs/storage.md) for the
persisted formats and [API contracts](../../docs/api.md) for publication semantics.

- Commit project, history, and receipt together. Check an existing receipt before the expected revision; compare its versioned request content without rewriting old receipts.
- Keep undo/redo revisions monotonic and the history bound intact. Normalize legacy identities across current and historical snapshots in one transaction without advancing the editing revision.
- Cancellation may abort a pending transaction. Once committed, return its successful result; late cancellation must not remove published originals or transcripts.
- OPFS and IndexedDB do not share a transaction. Journal file mutations and mark original publication alongside ready metadata; recovery re-reads the journal after acquiring its job lock.
- Scope locks, files, databases, and caches to the supplied namespace. Respect active jobs/readers during recovery and eviction; a missing source requires relinking rather than replacement of a ready original.
- Evict disposable derivatives before retrying quota failures once. Preserve originals, edits, and transcripts; project deletion deliberately retains original files.
- Validate complete backups before writing records. Restores remap project/asset/transcript IDs, start at revision zero, and leave omitted originals missing for relinking. Workspace archives may publish verified selected originals with metadata through journaled staging and one project transaction; use the [transfer contract](../../docs/storage.md#workspace-and-project-transfer).

Run focused checks from the repository root:

```sh
pnpm test tests/unit/storage-races.test.ts tests/unit/publication.test.ts tests/unit/services.test.ts
pnpm test:browser tests/browser/history.spec.ts tests/browser/recovery.spec.ts
```

The Chrome command requires current production builds; follow the
[build and test recipes](../../docs/development.md). Use isolated test namespaces.
