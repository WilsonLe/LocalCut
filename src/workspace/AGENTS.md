# Workspace

- Own view state and interaction in this directory; the editor snapshot is the canonical saved project. Route edits, history, imports, preview, and export through the public editor API.
- Submit property edits against the revision that authored the form. On conflict, refresh and let the user retry; never silently apply stale values to a newer snapshot.
- Preserve exact source endpoints for gain-only and speed-only changes. An explicit duration edit may change the source range; avoid round trips through displayed seconds for untouched values.
- Keep editor and AI imports lazy behind their existing explicit actions. Preserve the OAuth-return exception and eager synchronous callback-secret removal in `oauth-callback.ts` before the lazy conversation loads.
- Keep `Conversation`, `WorkspaceDialogs`, `AIConnectionDialog`, and the connected `ConversationSession` lazy. Command metadata in `workspace-command-list.ts` loads when the palette opens; show the palette only after its commands are ready. Measure the full initial import graph with `pnpm check:bundle` after changing shared primitives; moving JSX alone may leave an eager dependency elsewhere.
- Keep progress, cancellation, errors, and saved revisions tied to actual jobs and receipts. Ignore superseded async results; tear down subscriptions, sessions, and artifacts with their owner.
- Collapsing chat preserves its mounted conversation and connection state. Hidden contents must be inert; keep focus usable when opening, closing, or navigating settings.
- Coordinate chat/layout transitions and respect reduced motion. Long replies scroll inside the conversation while the composer and preview remain reachable, including narrow layouts.
- Keep durable workspace choices in `preferences.ts` and appearance in its existing owner. Patch individual fields; do not persist project/session state, secrets or text/name/transcript sharing consent. Keep the newer remembered indexing permission in its separate versioned owner; revocation cancels jobs and retires label-bearing chats. Save deliberate layout changes, not responsive measurements or automatic panel opening. Remembered models require explicit connection and current catalog validation.
- Keep less frequent controls in the grouped settings menu. Follow the recorded [workspace preferences](../../docs/user-preferences.md) and [behavior](../../docs/workspace.md).
- Match the approved CYOBot instructor chat interaction structure while retaining LocalCut tokens. Keep media in an independently collapsible right rail and retain one AI provider settings entry point.
- Keep keyboard edits in the shared shortcut resolver. Single-key commands apply only inside the focused editor; never steal typing, IME composition, native button activation or modal/menu keys. Route playback through its existing session owner and editing shortcuts through the same revision-aware commands as visible controls.

Use the cached production UI runner for the affected scenario; for timing/revision properties:

```sh
pnpm test:ui --grep 'stale property|speed rounding'
```

For scrolling or settings changes, select the matching title in `tests/browser/workspace-regressions.spec.ts` or `workspace-preferences.spec.ts`. Follow the [development loop](../../docs/development.md) for build freshness and broader gates.
