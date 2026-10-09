# Workspace

- Own view state and interaction in this directory; the editor snapshot is the canonical saved project. Route edits, history, imports, preview, and export through the public editor API.
- Submit property edits against the revision that authored the form. On conflict, refresh and let the user retry; never silently apply stale values to a newer snapshot.
- Preserve exact source endpoints for gain-only and speed-only changes. An explicit duration edit may change the source range; avoid round trips through displayed seconds for untouched values.
- Keep editor and AI imports lazy behind their existing explicit actions. Preserve the OAuth-return exception and synchronous callback-secret removal in `Conversation.tsx`.
- Keep progress, cancellation, errors, and saved revisions tied to actual jobs and receipts. Ignore superseded async results; tear down subscriptions, sessions, and artifacts with their owner.
- Collapsing chat preserves its mounted conversation and connection state. Hidden contents must be inert; keep focus usable when opening, closing, or navigating settings.
- Coordinate chat/layout transitions and respect reduced motion. Long replies scroll inside the conversation while the composer and preview remain reachable, including narrow layouts.
- Keep less frequent controls in the grouped settings menu. Follow the recorded [workspace preferences](../../docs/user-preferences.md) and [behavior](../../docs/workspace.md).

Use the cached production UI runner for the affected scenario; for timing/revision properties:

```sh
pnpm test:ui --grep 'stale property|speed rounding'
```

For scrolling or settings changes, select the matching title in `tests/browser/workspace-regressions.spec.ts` or `workspace-preferences.spec.ts`. Follow the [development loop](../../docs/development.md) for build freshness and broader gates.
