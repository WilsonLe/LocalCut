# Development loop

Start with [CONTRIBUTING.md](../CONTRIBUTING.md), the [agent contract](../AGENTS.md) and, for workspace changes, [user preferences](user-preferences.md). Use the [setup guide](setup.md) and [command reference](#commands). Work in an issue-linked isolated feature worktree; reuse the task's existing worktree and draft PR when continuing a change.

Verify Node 24, pnpm 11.25.0, and installed stable Google Chrome once, then reuse that setup throughout the iteration. Run `pnpm install --frozen-lockfile` when dependencies are missing or the lockfile changes; do not reinstall or download a browser after every edit. Generic Playwright Chromium does not satisfy the native codec acceptance gate.

## Commands

| Command                               | Purpose                                                       |
| ------------------------------------- | ------------------------------------------------------------- |
| `pnpm dev`                            | Local editor workspace at the root path                       |
| `pnpm typecheck`                      | Strict browser, worker, Node/test/config checks               |
| `pnpm lint`                           | ESLint and pure-core import boundaries                        |
| `pnpm format:check`                   | Prettier                                                      |
| `pnpm test`                           | Domain and service unit tests                                 |
| `pnpm build`                          | App + `editor.js` + `ai.js` + worker assets + declarations    |
| `pnpm build:root`                     | Equivalent build at `/` in `dist-root`                        |
| `pnpm test:browser`                   | Production integration in Google Chrome                       |
| `pnpm test:safari`                    | Native Safari storage and H.264/AAC regressions (macOS)       |
| `pnpm test:profile <label> <command>` | Wall time, descendant CPU/RSS and host utilization profile    |
| `pnpm test:tooling`                   | Resource scheduling and verified-build cache regressions      |
| `pnpm test:ui`                        | Focused workspace tests; rebuild only stale production assets |
| `pnpm test:transcription`             | Real pinned Whisper preparation and cached replay             |
| `pnpm test:performance`               | Warmup, two- and five-minute 1080p exports                    |
| `pnpm test:ai:live`                   | Opt-in real OpenRouter test; private key and model required   |
| `pnpm check:bundle`                   | Actual entry graph and static artifact budgets                |
| `pnpm check`                          | Normal formatting/lint/type/unit/build/bundle/browser gates   |

Browser commands require both production builds first, except `test:ui` and `test:safari`, which verify or build them automatically. The harness server is test-only and never enters `dist`. See [build reuse and resource scheduling](#expand-verification-at-the-boundary) and [native browser verification](browser-support.md#native-browser-verification).

TypeScript 7.0.2 supplies `tsc` through the `@typescript/native` alias. The `typescript` alias supplies Microsoft's pinned v6 compatibility API for typescript-eslint; it does not replace the production compiler. Dependencies and the lockfile are exact.

## Read guidance at the file's scope

Read the root `AGENTS.md`, then the guides in the target file's ancestor directories. For `src/workspace/Conversation.tsx`, that is root → `src/AGENTS.md` → `src/workspace/AGENTS.md`; for a browser test, root → `tests/AGENTS.md` → `tests/browser/AGENTS.md`. Parent rules remain in force; local guides add module-specific responsibilities and check selection. Keep a new rule at the narrowest shared owner instead of copying it across guides.

## Find the owner

| Directory                                                                                                                                        | Responsibility                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| [`src/workspace/`](../src/workspace/AGENTS.md)                                                                                                   | Conversation, preview, timeline, settings, and their UI state; editing goes through the shared APIs.     |
| [`src/components/ui/`](../src/components/ui/AGENTS.md), `src/styles.css`, `src/lib/`                                                             | Shared shadcn/Base UI primitives, semantic styling, and utilities.                                       |
| [`src/core/`](../src/core/AGENTS.md)                                                                                                             | Pure documents, commands, identity, captions, timing, and resampling.                                    |
| [`src/editor/`](../src/editor/AGENTS.md)                                                                                                         | Public editor facade, lifecycle, jobs, and events exposed to consumers.                                  |
| [`src/storage/`](../src/storage/AGENTS.md)                                                                                                       | IndexedDB transactions, OPFS originals, journals, recovery, and quota.                                   |
| [`src/media/`](../src/media/AGENTS.md)                                                                                                           | Import/decode, derivatives, composition, and streaming export.                                           |
| [`src/services/`](../src/services/AGENTS.md), [`src/workers/`](../src/workers/AGENTS.md)                                                         | Preview clock, job/worker transport, and local media/transcription execution.                            |
| [`src/ai/`](../src/ai/AGENTS.md)                                                                                                                 | Optional OpenRouter authentication, transport, context policy, and proposed edits.                       |
| [`tests/`](../tests/AGENTS.md): [`unit/`](../tests/unit/AGENTS.md), [`browser/`](../tests/browser/AGENTS.md), [`live/`](../tests/live/AGENTS.md) | Pure/service tests, production Chrome acceptance, and opt-in paid-provider acceptance.                   |
| [`scripts/`](../scripts/AGENTS.md), [`.github/workflows/`](../.github/workflows/AGENTS.md)                                                       | Local builds/checks, verified build reuse, test server, and automatic Pages deployment on `main` pushes. |

See [architecture](architecture.md) and [API contracts](api.md) before crossing a boundary. Preserve the existing owner instead of duplicating project state in a control or transport.

## Persist reusable computation

Treat refresh and reopening as cache consumers. For every new or changed expensive derived computation, inspect its existing owner and enumerate its UI, editor, worker and assistant consumers before implementing it. Reuse a valid persisted result before decoding, analyzing or encoding again. Keep the [computation inventory](storage.md#reusable-computation-inventory) current; an in-memory map alone does not satisfy reuse across refreshes.

Every production task registration declares `cache` first in its handler, using `freshTask(reason)` or a versioned reusable policy. The editor's `queued` wrapper requires the same policy. Legacy external handlers without a policy remain fresh for compatibility; new production tasks cannot omit the decision. `task-cache.ts` owns typed content keys and policy validation; `task-queue.ts` owns admission, sharing and durable completion. Keep cache logic out of UI components.

Reusable admission checks the existing result owner before creating a queue row. A namespaced Web Lock rechecks that owner and the queue cache, then atomically persists a miss's key/inputs/task before scheduling or publishing it. Computed result writes finish before terminal success. A result cannot be written before its first computation; the pre-enqueue write is its durable claim. Artifact-backed policies disable completed queue-result reuse so eviction, corruption and relinking stay authoritative. Pure computations can reuse completed queue results. Cancelling a reusable consumer detaches it; explicit queue cancellation stops the shared task.

A derived-data change is complete only when:

1. Its cache key includes algorithm/format version, immutable source identity and every result-affecting request parameter. Presentation-only changes such as renaming, trimming or gain do not invalidate source analysis. Relinking invalidates old results even when size/duration match.
2. Persistence belongs to the existing storage owner and stays local and namespaced. Disposable artifacts use journaled OPFS files and derivative records with the shared LRU/quota policy; authored data, transcripts and retained index evidence keep their existing stronger retention contracts. Never persist native handles or object URLs.
3. Matching concurrent requests share computation, cancellation leaves no partial publication, and missing/corrupt/obsolete cache entries rebuild. Cache-write failure must preserve an otherwise successfully computed display result. Eviction protects originals and active readers.
4. A production Chrome regression computes once, closes/reloads into a fresh engine/worker, then proves the repeat request avoids native computation and returns equivalent output. Cover changed parameters, source replacement, corruption/missing files and relevant cancellation/quota races. A warm same-session repeat or timing-only assertion is insufficient.
5. Any deliberate recomputation has a concrete validity or lifecycle reason in the inventory, such as current codec support, integrity verification or native resources tied to a rendering realm. New caches must preserve explicit consent and bare-startup laziness; cache population cannot initiate remote work.

For media derivative changes, start with:

```sh
pnpm test tests/unit/task-cache.test.ts tests/unit/task-queue.test.ts tests/unit/thumbnail-cache.test.ts tests/unit/derived-cache.test.ts tests/unit/storage-races.test.ts tests/unit/worker-publication.test.ts
# After both current production builds:
pnpm test:browser tests/browser/derived-cache.spec.ts tests/browser/layered-cache.spec.ts tests/browser/task-queue.spec.ts tests/browser/recovery.spec.ts
```

Select affected workspace consumers, retain native media checks, and run the performance gate when shared PCM/export behavior changes. See [storage formats and recovery](storage.md) for implementation contracts. During review, check this list against every changed computation and its consumers; undocumented session-only caching is incomplete work.

## Keep agent access complete

Every new or changed editing feature must ship with assistant access in the same change, following the [durable user preference](user-preferences.md#complete-agent-editing-access--11-october-2026). Before implementation, inventory the affected UI/API commands, authored properties, recipes and service actions against the [AI feature-access inventory](ai.md#editing-feature-access-inventory). Record a concrete reason for each user-owned boundary; a missing assistant path is unfinished editing work.

For each included feature, verify these completion conditions:

1. The shared engine owns the behavior and canonical schema; `validate_edits`/`propose_edits` expose every operation and field without a separate AI whitelist. Add new service actions through the existing capability-filtered, reviewable action path.
2. The assistant can discover valid IDs/options/recipes and inspect the relevant state under the existing sharing policy. Extend `inspect_capabilities`, bounded catalog discovery or the owning inspection tool as needed. Keep recipe catalogs shared with the UI.
3. The editing/service skill catalog and loaded guidance explain how to use the feature, preserve unrelated state and recover from validation/stale-revision errors. Loading remains incremental and never grants consent or approval.
4. A meaningful regression demonstrates inspect/discover → validate/propose → requested workspace execution (or explicit default headless approval) → persisted result. Cover cancellation/rejection or immutable instance ownership when affected. The operation-complete test must still enumerate every canonical operation; add a case whenever that list grows. Property-schema parity catches fields dropped from either edit tool; new authored behavior also needs runtime assertions.
5. Update the inventory, relevant API/workspace contract and check-selection recipe with the change. In the PR, report feature coverage and any reserved boundary explicitly.

Start with `pnpm test tests/unit/assistant.test.ts` for schema/operation/property/parameter coverage and approval/privacy authority. Use the related core regressions for changed timing, text, captions, tracks or groups. After both builds are current, run `pnpm test:browser tests/browser/ai-skills.spec.ts tests/browser/ai.spec.ts tests/browser/ai-actions.spec.ts` for complete per-round discovery, wrong-domain recovery, sharing-blocked continuation, lazy guidance, fresh-turn/frozen-round authority, actual persisted approvals, history and native exports at both hosting bases. The typed registry in `src/ai/tools.ts` owns both declarations and capability/error discovery for every canonical tool/action; new variants need support/loading/sharing coverage in the same change. Add the affected workspace selector when the UI changes; retain the normal integration and applicable native acceptance gates. These deterministic providers establish engine/tool access, not live model editing quality or paid inference.

## One edit, one focused check

For appearance font choices/loading, run `pnpm test tests/unit/appearance-fonts.test.ts tests/unit/font-cache.test.ts tests/unit/workspace-settings.test.ts`, then `pnpm test:ui --grep 'workspace appearance searches|workspace appearance previews the actual app'`. These cover the shared catalog, selected local faces, inheritance, reload/cross-tab persistence, checksum failure/retry and superseded loads. After shared-loader changes, retain `pnpm test:browser tests/browser/text-fonts.spec.ts` on current builds for authored text and native exports. Run both builds and `pnpm check:bundle` to verify lazy startup and font packaging.

Choose the smallest test that exercises the changed behavior, then run the cheap static checks. For a preview scheduling change:

```sh
pnpm test tests/unit/preview-latency.test.ts
pnpm typecheck
pnpm lint
pnpm format:check
```

For audio separation, groups and transition recipes, run `pnpm test tests/unit/timeline-features.test.ts`. The production scenario `pnpm test:ui --grep 'timeline audio|native separated'` covers selection and grouping, all template previews, native audio equivalence, MP4/WebM outputs, persistence and both static paths.

For workspace changes, use `pnpm dev` for interactive work, then run the matching production UI scenario:

```sh
pnpm test:ui --grep 'speed rounding'
```

This example selects the existing speed regression at both `/` and `/LocalCut/`. Replace the filter with the relevant test title, or omit it to run all workspace specs. The command verifies source/configuration/dependency fingerprints and every output file, rebuilding only stale targets. It reuses current assets after test-only or documentation changes. Build stamps live in ignored `.cache/build-state/`; `dist` and `dist-root` remain deployable output only.

For native file dropping and retained batch progress, use `pnpm test:ui --grep 'asset drop|compact workspace imports|workspace imports image, audio and video'`. This covers app-wide/Media hover, nested leaves, blocked/text drops, actual local image/video imports, per-file failure, cross-tab task cancellation, full-batch queue submission, early Okay/X/Escape dismissal, background editing/navigation, picker parity and persisted reloads at both bases. Existing picker, keyboard, mobile and recording stories dismiss the retained result dialog explicitly through `workspace-import-helper.ts`; internal media-to-timeline drags keep their pointer-based path.

Keyboard and assistant service regressions have their own specs. After the same two builds are current, run `pnpm test:browser tests/browser/keyboard.spec.ts tests/browser/ai-actions.spec.ts`. The keyboard tests use real persisted edits and native playback; the assistant tests reopen native MP4/WebM artifacts. To check just the AAC configuration regression before building, use `pnpm test tests/unit/audio-config.test.ts`.

For shared dialog sizing, run `pnpm test:ui --grep 'dialog sizing fits'` for content-sized short forms, rich editors, mobile backup bounds, project browsing, command search, shortcut reflow, internal scrolling and focus return at both static bases and all interface scales. Select the affected consumer journeys as well when changing their internal layout.

For track schema/locks/output/AI changes, run `pnpm test tests/unit/track-operations.test.ts tests/unit/timeline-features.test.ts tests/unit/assistant.test.ts`, then `pnpm test:ui --grep 'track menu operations|track disable mute solo|timeline add tracks'`. These cover menus, revision-bound forms, locked edits, history, both bases/mobile, approved assistant batches and real visual/audio MP4/WebM reopening. Composition changes retain the separate performance gate.

For interface sizing and timeline anchoring, run `pnpm test:ui --grep 'interface size'`. This checks all three sizes, portal placement, narrow popup bounds, touch playback with expanded media, scaled editing gestures and saved choices at both bases. Native Safari's `pnpm test:safari` additionally measures size and bottom alignment before its media/storage scenarios.

For a non-UI Chrome regression, build both targets after changing production code, then select its spec:

```sh
pnpm build
pnpm build:root
pnpm test:browser tests/browser/recovery.spec.ts
```

When only that test changed and the production builds are still current, reuse them and run the last command. Direct `test:browser` does not validate or rebuild assets. Use `--list` with that command to check selection without launching Chrome. Do not replace native codec or inference evidence with unit mocks.

For documentation-only edits, check formatting and the referenced files/commands. Reuse existing code evidence when the code and tests are unchanged; a full build or browser rerun adds no evidence for a prose correction.

For compatible browser stories, use [the Playwright journey inventory](playwright-journeys.md) to reuse an open app, project and tab across named steps. Batch related specs into one runner invocation before adding browser workers or tabs. The implemented combinations carry `@journey` in their titles; `pnpm test:ui --grep '@journey'` selects them at both hosting bases. Original story titles remain in the enclosing test name and named steps, so their existing grep selectors still work. Keep incompatible startup, failure and native fixtures isolated.

For screen-recording changes, start with `pnpm test tests/unit/screen-recording.test.ts`, then `pnpm test:ui --grep 'screen recording'`. Controlled capture streams cover native encoding, audio, import/export, retry and disposal at both bases. The separate stable-Chrome instance in that spec exercises real browser-tab capture using a test-only selector for its synthetic tab; it never selects the user's desktop. Native OS screen/window pickers and OS audio availability still need interactive verification on the target platform.

For text-to-speech changes, start with `pnpm test tests/unit/speech.test.ts tests/unit/openrouter.test.ts`, then `pnpm test:ui --grep 'text to speech'`. These test live catalog/voice validation, multilingual request settings, cancellation, exact pitch-preserving timing, local import/history/reopening and native export. Provider interception is deterministic transport evidence; assess natural delivery separately with an explicitly connected account and a Generate action.

## Expand verification at the boundary

Run `pnpm check` locally before handing off code changes and after changes to shared contracts, dependencies, build configuration, or the test pipeline. It runs formatting, lint, types, tooling regressions, units, both verified production builds, bundle budgets, and the complete normal Chrome suite. Independent static checks overlap, then unit tests can overlap with the sequential build stage; browser consumers wait for verified outputs and bundle validation. Focused checks make the iteration fast; they do not replace this integration gate. Hosted CI is disabled; local results are the acceptance evidence.

Follow [validation](validation.md) for real transcription/cached replay and the five-minute export gate before implementation handoff, and whenever changes affect those capabilities. They are explicit `pnpm test:transcription` and `pnpm test:performance` commands, outside normal `check`. Real-provider testing is separately opt-in; read [AI privacy and live-test requirements](ai.md) before `pnpm test:ai:live`. Report missing capabilities or failed gates directly.

The shared CPU/memory policy scales unit pools and caps explicit Chrome parallelism with available capacity, without fixed machine-size ceilings. Normal Chrome shares one browser process across concurrent workers with isolated contexts and tabs. `LOCALCUT_BROWSER_WORKERS` caps that context pool, including through `pnpm check`. Unit allocation stays adaptive. The policy accounts for CPU affinity, available memory including reclaimable file cache, and cgroup quotas. Normal shared-browser pools reserve 0.5 GiB per slot, without a fixed worker ceiling; other pools retain 0.75 GiB per slot and a separately launched browser worker reserves two. One GiB stays available for the OS and shared browser parent. Overrides accept positive safe integers and never exceed live headroom: `LOCALCUT_TEST_SLOTS=1` serializes `check`; `LOCALCUT_UNIT_WORKERS=1` narrows the unit pool. Raw Playwright `--workers` remains available for controlled profiling. The `test:browser` runner owns the loopback-only shared browser, closes it after success/failure/interruption, and skips launching it for `--list`. `test:ui` uses the same runner. Functional checks use reduced motion; explicit animation and modal-focus regressions restore full motion.

`check` retains the 0.75-GiB ordinary slot budget for static checks, units and builds, then admits Chrome using the 0.5-GiB shared-context budget after that phase passes. Each phase refreshes capacity at gate boundaries and every second while waiting. Recent CPU-time deltas replace the startup one-minute load estimate; running reservations are counted once. Elastic pools receive the slots available when they launch. Child runners receive the measured slot grant and still apply CPU/quota/RAM caps, avoiding a second subtraction of the parent’s historical load. Already-running pools drain normally under pressure, and worker counts stay fixed for that invocation. Units overlap the sequential builds; Chrome waits for units and bundle validation so a failed unit gate never starts browser acceptance. Direct Vitest commands sample capacity at startup. The Chrome runner and `check` first sample current CPU utilization for 100 ms, avoiding stale one-minute load after earlier work finishes. The Chrome runner forwards that measured grant to its child configuration, which rechecks CPU/quota/RAM without deducting historical load again. Runner logs disclose the allocation and any explicit worker limit. Native Safari, transcription, performance and live-provider gates remain serial and separate so native measurements do not compete.

Use automatic allocation for routine runs: `pnpm check` or `pnpm test:ui --grep '<title>'`. Do not routinely set `LOCALCUT_BROWSER_WORKERS=2`; this deliberate narrowing override can serialize hundreds of cases despite available capacity. Use it only to reproduce a measured contention problem. A five-minute budget is a target for normal `check`, not a guarantee under host pressure; transcription/performance remain separate serial gates.

Profile a complete gate at merge or sweep focused worker settings sequentially:

```sh
pnpm test:profile check-auto check
pnpm test:profile units-8 test --maxWorkers=8
# Both production builds must already be current:
pnpm test:profile chrome-7 test:browser tests/browser/workspace-mobile.spec.ts --workers=7
```

The profiler writes timestamped logs and JSON to ignored `.artifacts/test-profiles/`, including wall time, sampled descendant CPU seconds, average CPU cores, peak summed RSS, host busy percentage, initial allocation, per-gate timings, browser scenario median/p95/slowest timings and exit status. It samples every 500 ms with macOS/Linux `ps`; very short-lived processes may be missed, summed RSS includes shared pages, and host busy includes unrelated apps. These are bounded diagnostics, not exact exclusive CPU or physical-memory measurements. It propagates failure status. CLI worker flags are raw runner overrides for controlled sweeps; use the `LOCALCUT_*` variables for capacity-capped routine runs. Keep sweeps sequential and distinguish cold builds from verified warm reuse. See [the shared-browser full-check result](validation.md#shared-chrome-full-check--11-october-2026) and [the earlier scheduler benchmark](validation.md#dynamic-test-resources--10-october-2026).

## Isolate runs and resume from evidence

- Give engine tests unique namespaces, following `test-` plus `crypto.randomUUID()` in existing browser specs. Dispose sessions, engines, and returned artifacts. Follow [storage ownership](storage.md); never clear an origin's unrelated data.
- Coordinate one owner for each test server and output directory. The default test port is 4178; for a separate run, use an available port, for example `LOCALCUT_TEST_PORT=4185 pnpm test:browser tests/browser/recovery.spec.ts`. A different port does not isolate `dist`, `dist-root`, or reports.
- Finish builds before starting browser acceptance. Do not write either production output directory while another test is using it. Distinct worktrees or serialized runs avoid that conflict; evidence belongs to the build tested.
- Read the failing assertion and retained trace in `test-results/`, plus the HTML report in `playwright-report/`, before retrying. Retain these local artifacts when recording a failure. Preserve the command, revision, base path, and observed values; timing failures need actual clock values, not just a boolean result.
- Fix the identified cause and rerun the affected scenario. Broaden only when the change reaches another owner or a remaining failure needs it. Resume successful work from its artifacts instead of restarting the complete suite after every edit.

## Review and delivery

Keep the issue, draft PR, implementation, and evidence aligned. Run exactly one automatic independent review cycle for the candidate. Address its findings and run targeted revalidation plus any affected integration gates; do not automatically start another review of those fixes. Record remaining limitations and the checks actually run.

Merge requires authorization and triggers automatic Pages deployment on `main`. Complete local validation before merging and follow [deployment and rollback](../DEPLOY.md) for live release verification; a local pass or review approval does not prove merge or deployment succeeded.

## Indexing checks

```sh
pnpm test tests/unit/asset-index.test.ts tests/unit/asset-index-provider.test.ts tests/unit/assistant.test.ts
pnpm test:ui --grep 'workspace indexing|chat indexing'
# After both current builds:
pnpm test:browser tests/browser/asset-index.spec.ts
pnpm test:performance
```

The native performance workload measures scanning and excerpt generation separately after its export measurements, with no provider request. Total generation/labeling work depends on detected scene count. Four-Hz discovery covers every detected shot, but can miss shots/transitions shorter than the 250 ms sample interval or visually similar cuts; lighting changes may cause extra cuts; highlight scoring describes sampled pixels rather than semantic importance. Audio uses deterministic energy/silence boundaries and bounded continuous segments, not semantic speech/music sections. LLM labels are nondeterministic. See [AI consent and live verification](ai.md#manual-asset-indexing).

## Resizable panel compatibility

Workspace splits use the shadcn Base Resizable wrappers over pinned `react-resizable-panels` 4.14.3. Its browser ESM pointer calculation is patched through pnpm to translate visual pointer deltas into layout pixels under CSS zoom; keep the patch and lockfile together. This preserves the saved 75%/100%/125% interface sizes. Verify any dependency upgrade with `pnpm test:ui --grep 'workspace resizable|interface size'`, covering horizontal and vertical dividers at both static bases. Save sizes from completed layouts, not stale imperative reads or per-move callbacks.

## Font catalog maintenance

`node scripts/import-fonts.mjs` is an explicit maintenance operation for the pinned Fontsource metadata snapshot. It imports all licensed upright families and every available regular subset, preserves source URLs/copyright/license notices, and records exclusions. Existing assets are reused only when their checksum matches the family manifest. It does not run during install or build. Update source pins deliberately before adding another snapshot. `pnpm check:bundle` verifies both output catalogs, every WOFF2 hash/license, and the separate 512 MiB font budget while retaining the normal JS/CSS budgets.

Production packaging moves the catalog to `fonts/<snapshot-sha256>/` and embeds that identity in UI/worker font loading. Do not edit files beneath a published snapshot URL. After font/build/cache changes, select `tests/unit/font-cache.test.ts`, `tests/tooling/font-snapshot.test.mjs`, `tests/tooling/build-state.test.mjs`, and `tests/browser/workspace-release.spec.ts` alongside the affected font/media cases. The release browser scenarios exercise missing engine/panel chunks, explicit fresh-HTML recovery with saved project/route retention, and headless discovery that bypasses stale public aliases at both bases.

For font or animation changes, run `pnpm test tests/unit/text-library.test.ts tests/unit/text-animation.test.ts`, `pnpm test:ui --grep 'searchable fonts|bundled font pages'`, then (using the same verified builds) `pnpm test:browser tests/browser/text-fonts.spec.ts tests/browser/text-rendering.spec.ts`. The Chrome cases cover real worker glyphs, typewriter and handmade frames, native MP4/WebM reopening, integrity failures, tag search, pagination, editing and persistence at both bases. `pnpm test:safari` additionally covers native Safari fonts/animation through real MP4 reopening at both bases. Renderer changes retain the separate performance gate; inference code is unaffected by font-only work.

## Durable task queue checks

```sh
pnpm test tests/unit/task-queue.test.ts tests/unit/assistant.test.ts tests/unit/speech.test.ts
pnpm test:ui --grep 'task queue table'
pnpm test:ui --grep 'chat response actions|text to speech'
pnpm test:browser tests/browser/task-queue.spec.ts tests/browser/editor.spec.ts tests/browser/lifecycle.spec.ts
```

The browser commands use current production builds at both static bases. Facade/scheduling changes also retain the real local transcription and disk-backed export performance gates. Intercepted speech requests prove queue lifecycle and transport behavior, not paid voice quality. Dictation's controlled recognition fixture proves draft integration; microphone permission and the browser's speech service require a manual supported-browser check.

## Header update checks

For application update checks or deployment identity, run `pnpm test:ui --grep 'header check for update|deployment recovery|missing optional UI chunk'` and `node --test tests/tooling/build-state.test.mjs`. These journeys cover both static bases, desktop/mobile, explicit checks, later/current/older/unrelated commits, pending feedback, retry, preserved projects and cache-busting reload. Changes to revision generation also require both builds and `pnpm check:bundle`. The update action is a user-owned lifecycle boundary, outside the editing-feature access inventory.

## Project header and recent-project startup checks

Run `pnpm test tests/unit/recent-project.test.ts tests/unit/project-route.test.ts`, then `pnpm test:ui --grep 'project routing|workspace storyboard|chat readiness'` for header icons/keyboard/mobile bounds, all interface sizes, most-recent restoration, malformed-ID fallback, delayed conversation navigation, explicit URL precedence, fresh startup, missing projects and restored chat without startup inference at both bases. These navigation controls do not change authored editing operations or the assistant access inventory.

## Storyboard checks

Use `pnpm test tests/unit/storyboard.test.ts tests/unit/assistant.test.ts tests/unit/workspace-backup.test.ts` for schema, partial patches, redaction, serialized canvas writes and assistant coverage. Use `pnpm test:ui --grep 'workspace storyboard'` for real Excalidraw drawing, shared history, approved agent edits, reload, versions/backups and narrow layouts at both bases. Excalidraw remains a lazy UI dependency; core/headless schema and commands do not import it.

The same Chrome selection verifies failed drawing fonts stay local and rejects dropped files/library scenes in live and historical views. `node --test tests/tooling/storyboard-assets.test.mjs` checks the pinned development/production fallback adapter; dependency updates must preserve local-only loading or deliberately update that adapter and its evidence.

`scripts/storyboard-assets.ts` publishes the pinned package's drawing fonts below `storyboard/excalidraw-0.18.1/`, with a SHA-256 inventory verified by the bundle gate. Update the package pin, asset path and inventory together on upgrade. The package includes internal Radix components; its transitive peer metadata predates React 19, so verify the real diagram interactions alongside the package's declared React 19 support.

## Automatic chat title checks

Run `pnpm test tests/unit/chat-title.test.ts tests/unit/providers.test.ts`, then `pnpm test:ui --grep 'chat title runs|chat navigation pauses|chat picker matches'`. These cover bounded complete text, the selected model and configured route transport, independent delayed naming, session/branch ownership, failure and retirement, searchable titles, full/reduced motion and retained conversation controls at both hosting bases. Provider interception establishes transport and lifecycle evidence; live naming quality and cost depend on the configured provider. Naming is session UI metadata and grants no editing/tool authority.

## Notification history checks

For error diagnostics and notification history, run `pnpm test tests/unit/error-diagnostics.test.ts tests/unit/notification-history.test.ts tests/unit/services.test.ts tests/unit/task-queue.test.ts tests/unit/worker-publication.test.ts`, then `pnpm test:ui --grep 'notification history|concurrent notification reports'`. The Chrome scenario covers both static bases, original stack/session capture, clipboard success/check/reset and denial, dismissal, persisted reopening, informational notifications, unread dots, clear history, narrow layouts and simultaneous reports under a shared write lock. Notification history is user-owned lifecycle UI; it grants no assistant edit operation.

## Capture metadata checks

Run `pnpm test tests/unit/capture-metadata.test.ts tests/unit/asset-indexer-capture.test.ts tests/unit/asset-index.test.ts tests/unit/asset-index-provider.test.ts tests/unit/assistant.test.ts tests/unit/workspace-backup.test.ts`, then both builds and `pnpm test:browser tests/browser/capture-metadata.spec.ts tests/browser/asset-index.spec.ts`. These cover real EXIF/container extraction, independent remote redaction, capture-informed label revocation and retry recovery, native imports, index prompt manifests, local reload and backup preservation at both static bases. Use `pnpm test:ui --grep 'workspace indexing|chat indexing'` for the shared indexing controls. Extraction bounds and supported tags are documented in [the API contract](api.md#embedded-asset-capture-metadata).

## Chat persistence checks

Run `pnpm test tests/unit/chat-persistence.test.ts tests/unit/assistant.test.ts tests/unit/conversation-errors.test.ts`, then `pnpm test:ui --grep 'chat readiness|chat title runs|chat navigation pauses|chat picker matches|chat continuation remembers'`. The persistence journey covers local IndexedDB reload/selection/drafts, text-only continuation, branching, rename/title races, archive/restore, independent forks, last-active-chat recovery, concurrent-tab session creation, project/sharing isolation, startup without inference, same-effective-model continuity and multi-scope save-failure recovery at both hosting bases. Session retention is workspace lifecycle state and grants no assistant editing operation. The continuation journey verifies typed continuation before output, interruption recovery after local reload, reasoning-only empty-response feedback and explicit manual retry. Native transcription/export/performance behavior is unchanged.

## Chat export checks

Run `pnpm test tests/unit/chat-export.test.ts tests/unit/task-queue.test.ts`, then `pnpm test:ui --grep 'chat export queues|chat export captures|chat export recovers'`. The Chrome journey verifies the chat-header icon, immutable queued snapshots, cancellation/retry, queued and abandoned-running reload recovery, actual ZIP downloads, Markdown/JSON contents, session switching and mobile bounds at both hosting bases. Chat export is a user-owned download boundary and adds no assistant editing operation. Native rendering/transcription paths are unchanged.

## Dialog opening checks

For on-demand dialog code, loading focus or command-palette preparation, run `pnpm test:ui --grep 'first dialog opening|dialog loading shell|commands load metadata|simple dialogs keep heavy|failed dialog chunks|retained speech dialog'`. The production Chrome cases cover both hosting bases, full motion, pre-imported first openings versus repeats, slow/failed chunks, dismissal before completion, focus return across retained speech reopenings, parallel command preparation, heavy-body isolation and inert bare startup. The pre-import probe retains a 250 ms mount budget to catch the former roughly 300 ms Suspense retry floor; diagnostic timing attachments distinguish shell and resolved dialog mounts.

Run affected existing consumer journeys as well, including `project switcher dialog`, `error stack trace`, `task queue table`, `workspace settings`, `screen recording`, `searchable fonts`, `speed rounding` and relevant speech/backup cases. Keep engine, transcription, storage and native export gates separate; changing only UI-module loading does not change their owners.

## Requested chat execution checks

Run `pnpm test tests/unit/assistant.test.ts`, then `pnpm test:ui --grep 'chat indexing requested execution|text clarification|conversation cancellation|rate-limit errors|chat executes atomic edits|conversation proposes and applies'`. Requested mode covers sequential receipts/fresh revisions, scoped indexing and explicit retry after failure, response/service cancellation and plain text clarification. Existing headless approval/privacy regressions remain in the same assistant suite. Native media processing is unchanged; these deterministic providers establish execution and transport, without paid inference.

## Creative effect checks

Use `pnpm test tests/unit/audio-effects-window.test.ts tests/unit/creative-effects.test.ts tests/unit/assistant.test.ts tests/unit/core.test.ts tests/unit/timeline-features.test.ts` for keep-pitch effect continuity, LUT validation/interpolation, spectral/EQ/balance processing, chroma, mask path split/timing, discovery and approved effects/tracking. Then `pnpm test:ui --grep 'creative effects|creative clip|local mask tracking|black transitions keep'` covers both production bases, responsive controls, local import failure, persisted settings/history/backup, actual MP4/WebM pixels/PCM and native video tracking with cached replay/approved assistant persistence. Shared composition changes also require the serial `pnpm test:performance` gate. Transcription preparation/model paths are unchanged.

## Media folder checks

For named OPFS folders, library revisions and assistant scope, start with `pnpm test tests/unit/media-library.test.ts tests/unit/assistant.test.ts`. Run `pnpm test:ui --grep 'workspace media folders upload|folder drop traversal|media select-all'` for directory picker hierarchy, empty directory drop, folder navigation, pointer moves, focused media select-all/clearing and native input guards, rename, folder download, Trash/Restore, narrow layout, reload and independence from timeline references at both bases. After current production builds, run `pnpm test:browser tests/browser/media-folders.spec.ts tests/browser/project-media-roots.spec.ts` for project isolation/migration and actual OPFS readback, recursive copy/move/rename, collisions/invalid paths, stale/concurrent changes, journal recovery and retained native preview/MP4 sources. These checks exercise local organization; no provider/native computer-folder access is involved.

## OpenRouter context checks

For connection terms, automatic context sharing and legacy chat migration:

```sh
pnpm test tests/unit/providers.test.ts tests/unit/chat-persistence.test.ts
pnpm test:ui --grep 'OpenRouter connection shares all context|provider empty state reveals OpenRouter'
```

The production Chrome journey reads project/media names, overlay/storyboard text and frame names, attached source transcript text and imported EXIF dates/GPS through real assistant tools before and after reload. It migrates all 48 older sharing/indexing scope variants in native IndexedDB while preserving canonical selection, drafts, titles, archives and project/model/provider isolation. Intercepted replies establish transport and persistence, not paid inference quality. The connector layout journey covers desktop/phone terms and both connection choices without provider requests.

For library-only upload and mixed Apple Photos folders, run `pnpm test tests/unit/media-library.test.ts`, then `pnpm test:ui --grep 'mixed photo folder upload|unsupported import format|asset drop'`. These cover visible metadata skips, native worker errors, queued siblings, initiating-project ownership, unchanged timeline/history and reload. Editing journeys use `closeMediaImportAndPlace` to explicitly seed their timeline through canonical commands; upload/attachment/indexing journeys retain `closeMediaImport` and inspect Media IDs directly.
