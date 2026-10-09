# Local storage and recovery

Opening createEditor explicitly creates IndexedDB localcut-v1 and OPFS localcut/. Model preparation uses localcut-asr-v1 in Cache Storage. Tests pass a separate namespace. All paths on a GitHub Pages origin share storage; cleanup must remain scoped to LocalCut resources.

IndexedDB contains projects, 100 undo/redo snapshots, lifetime idempotency receipts, metadata, transcripts, derivative records, and journals. A document/history/receipt change uses one atomic transaction with a revision check. Unsupported schemas and malformed imports fail without replacing a saved project.

Original media is immutable OPFS content identified by asset ID. An import journal precedes file mutation. An asset becomes ready only after the file finishes; failure removes partial content. Relink accepts a missing original with matching metadata; it does not overwrite a ready source.

Exports and derivatives also journal their temporary files. Explicit engine opening recovers abandoned journals under Web Locks. An active job's lock prevents another tab from deleting its work. Completed ready originals survive recovery. File reads report MISSING_ASSET with a relinking path when needed.

Derivative records track size/access time. Cleanup uses an LRU budget of 512 MiB, reduced for available origin quota, and attempts eviction before an original import. Active PCM readers pin their asset resources. Cache eviction never deletes originals, edits, or transcripts. Quota exceptions become QUOTA_EXCEEDED. The browser can still externally evict origin storage, so retain source backups.

Project deletion removes the document/history and its receipts. Original media is conservatively retained, including shared and historical sources; it is not automatically reclaimed. Explicit original garbage collection needs a later consumer-facing retention policy. Artifact disposal removes the owned export file. Model-cache clearing deletes only the namespaced inference cache.

Project JSON backups contain documents and asset IDs, not embedded media. Retain originals separately. JSON import generates a new project ID at revision zero; missing asset IDs require relinking before media-dependent work.

No application shell caching or offline navigation is installed. Cached inference can run without remote model/runtime hosts after reload as long as the static app itself remains available.
