# LocalCut agent guide

## Start here

- Read [user preferences](docs/user-preferences.md); update that record when the user states a durable preference. Newer explicit choices take precedence.
- Use [README setup and commands](README.md#setup), then the [development guide](docs/development.md) for module ownership, focused checks, and failure recovery. Read the relevant API, storage, AI, or deployment contract only when the change touches it.
- Inspect the current branch, dirty files, base, and linked issue/PR before editing. Reuse the task's isolated feature worktree and existing tracking issue; preserve unrelated work. Keep the issue's scope current before implementation.

## Keep one development cycle short

- Change the existing owner of a behavior. UI controls call the shared engine/assistant APIs; do not duplicate editing or provider logic in components.
- During iteration, run the smallest meaningful test for the changed behavior. `pnpm test:ui --grep 'speed rounding'` is an example of a focused production-UI check that verifies and reuses both static builds. Use the [check-selection recipes](docs/development.md) for other layers.
- Keep builds and tests in sequence when they share `dist` or `dist-root`. Parallelize isolated tests/read-only investigation; use separate ports and storage namespaces for independent browser runs.
- Before a code, configuration, or dependency handoff, run `pnpm check` plus the affected real Chrome transcription/performance gates. For documentation-only changes, validate formatting, links, and any new commands, and retain clearly scoped evidence for unchanged runtime code. Do not repeat successful expensive checks without changed inputs, a failure, or an unresolved concern.
- Freeze the candidate and run one independent draft-PR review-and-address cycle. Fix accepted findings and rerun affected checks; do not automatically start another independent review. Record the reviewed and resulting heads and distinguish author validation from independent review.
- Keep the issue and PR linked both ways. Report the exact head/base, checks, limitations, and release state. Merge and Pages deployment require separate authorization.

## Product and runtime contracts

- The approved production interface is a conversation-led workspace: editing conversation at left, preview and compact timeline at right. Use the existing neutral Vega shadcn/Base UI foundation; do not add sample media or simulated editing behavior to production.
- Initial page load must not start workers, initialize storage, fetch models, request permissions, or instantiate the editor. Open/create/import actions explicitly initialize the engine. An explicit OpenRouter OAuth return may complete authentication after removing callback secrets from the address.
- All future controls and agent transports must invoke the shared engine API. Keep one canonical project document and explicit revision/request contracts.
- Keep src/core pure TypeScript: no React, browser storage, media libraries, services, workers, or network operations.
- Keep media and inference local. Model/runtime downloads require explicit preparation. No user-media uploads, embedded secrets, or hosted processing services.
- Optional OpenRouter text reasoning lives only in `src/ai` and the lazy `ai.js` entry. User-owned keys remain in memory; temporary PKCE state is tab-scoped. Send only explicitly requested, policy-filtered text/metadata. AI tools propose changes; explicit callers apply them through the existing editor API. Keep raw media and local speech inference on-device.
- Preserve microsecond integers, rational frame rates, half-open ranges, idempotent receipts, atomic history/document commits, and client-side capability preflight.
- Dispose native resources and workers. Use app-owned storage namespaces; do not clear origin-wide databases, files, or caches.
- Use pinned dependencies and the committed lockfile. Model revision, quantization, runtime CDN, and artifact hashes are contracts.
- A mocked inference or Chromium-only pass does not satisfy transcription/codec acceptance. Record missing evidence as a failure, never a passing skip.
- Keep remote AI opt-in, models user-selected, sharing choices unchecked, credentials memory-only, and every AI proposal explicitly applied or discarded. Show asynchronous feedback through accessible Sonner toasts or the active operation dialog.
