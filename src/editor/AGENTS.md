# Editor facade

- `index.ts` owns the public `Editor` API, job/event wiring, and disposal. Consult [API contracts](../../docs/api.md) when changing its types or behavior.
- Keep construction explicit: importing the entry must not open storage or start workers. Preserve lazy `WorkerClient` creation and separate interactive, background, and speech lanes.
- Delegate canonical mutations to `Store` and pure commands. Do not replace submitted batch content with parsed/defaulted content before receipt matching.
- Emit project events only after successful storage commits. Preserve revisions across cross-tab notifications, undo, and redo.
- Preserve publication ownership: committed imports/transcripts survive late cancellation; undelivered frames and exports must be discarded. See [storage publication rules](../../docs/storage.md).
- Keep consumer-owned canvas/audio contexts separate from engine-owned sessions, listeners, workers, and artifacts. Make disposal idempotent and await active cleanup.
- For facade changes, run `pnpm test:browser tests/browser/editor.spec.ts tests/browser/lifecycle.spec.ts` against current production builds; add history/recovery specs when those contracts change.
- Run `pnpm typecheck` for public declaration changes. Follow the [development guide](../../docs/development.md) for build freshness and final checks.
