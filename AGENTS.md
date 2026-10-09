# LocalCut contributor contract

- The approved production interface is a conversation-led workspace: editing conversation at left, preview and compact timeline at right. Use the existing neutral Vega shadcn/Base UI foundation; do not add sample media or simulated editing behavior to production.
- Initial page load must not start workers, initialize storage, fetch models, request permissions, or instantiate the editor. Open/create/import actions explicitly initialize the engine. An explicit OpenRouter OAuth return may complete authentication after removing callback secrets from the address.
- All future controls and agent transports must invoke the shared engine API. Keep one canonical project document and explicit revision/request contracts.
- Keep src/core pure TypeScript: no React, browser storage, media libraries, services, workers, or network operations.
- Keep media and inference local. Model/runtime downloads require explicit preparation. No user-media uploads, embedded secrets, or hosted processing services.
- Optional OpenRouter text reasoning lives only in `src/ai` and the lazy `ai.js` entry. User-owned keys remain in memory; temporary PKCE state is tab-scoped. Send only explicitly requested, policy-filtered text/metadata. AI tools propose changes; explicit callers apply them through the existing editor API. Keep raw media and local speech inference on-device.
- Preserve microsecond integers, rational frame rates, half-open ranges, idempotent receipts, atomic history/document commits, and client-side capability preflight.
- Dispose native resources and workers. Use app-owned storage namespaces; do not clear origin-wide databases, files, or caches.
- Use pinned dependencies and the committed lockfile. Model revision, quantization, runtime CDN, and artifact hashes are contracts.
- Run pnpm check and relevant real Chrome acceptance gates. A mocked inference or Chromium-only pass does not satisfy transcription/codec acceptance. Record missing evidence as a failure, never a passing skip.
- Use an isolated feature worktree, issue-linked draft PR, and independent review. Merge and Pages deployment require separate authorization.

- UI operations use the shared engine and optional assistant APIs. Keep remote AI opt-in, models user-selected, sharing choices unchecked, credentials memory-only, and every AI proposal explicitly applied or discarded. Show asynchronous feedback through accessible Sonner toasts or the active operation dialog.
