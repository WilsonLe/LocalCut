# Production Chrome acceptance

- These tests import built `editor.js`/`ai.js` or use the production workspace. Do not substitute source/dev imports for production-entry coverage.
- [playwright.config.ts](../../playwright.config.ts) uses installed stable Chrome. Preserve explicit root and `/LocalCut/` coverage when modifying shared entries or asset resolution.
- Workspace iteration: `pnpm test:ui --grep '<title>'` verifies/reuses both builds. Engine iteration: build both targets, then `pnpm test:browser tests/browser/<name>.spec.ts`.
- `pnpm test:browser tests/browser/<name>.spec.ts --list` checks selection without starting the browser. Do not mistake this for executed evidence.
- Normal acceptance defaults to one reused Chrome worker. `LOCALCUT_BROWSER_WORKERS` opts into additional workers within the shared CPU/memory budget; keep measured parallelism bounded. Combine compatible stories with named `test.step` phases, reuse journey-owned primary/secondary tabs, and preserve fresh contexts for unrelated fixtures. See [the journey inventory](../../docs/playwright-journeys.md). Keep performance/transcription in the separate one-worker `acceptance` project.
- Keep native encode/decode, actual persisted revisions, waveform/audio values, and cancellation cleanup assertions. Intercepted OpenRouter replies prove protocol behavior, not paid inference.
- Exercise superseded requests and cross-tab conflicts with explicit synchronization; avoid assuming elapsed sleeps equal playback progress on a busy machine.
- Preserve checksum-verified speech preparation and the fresh-worker replay with remote hosts blocked. Run `pnpm test:transcription` per [validation](../../docs/validation.md).
- Keep the performance workload's isolated disk-backed profile and cleanup; incognito OPFS stores output in RAM and distorts processing measurements. Run `pnpm test:performance` without competing browser workloads.
- Inspect retained traces and measured values before retrying. Record the tested revision, base paths, capabilities, and any unresolved failure.
