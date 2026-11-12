# Development loop

Read [CONTRIBUTING.md](../CONTRIBUTING.md), the [agent guide](../AGENTS.md) and [current preferences](current-preferences.md). Reuse the task’s isolated feature worktree and tracking issue. Node 24, pnpm 11.25.0 and installed stable Google Chrome are required. Keep dependencies exact and install with `pnpm install --frozen-lockfile`. Product agent AI was removed on 11 November 2026; no editor feature requires an assistant path.

## Commands

| Command                               | Purpose                                           |
| ------------------------------------- | ------------------------------------------------- |
| `pnpm dev`                            | Local workspace                                   |
| `pnpm typecheck`                      | Strict source, worker, config and test checks     |
| `pnpm lint`                           | Promise and import boundaries                     |
| `pnpm format:check`                   | Formatting                                        |
| `pnpm test`                           | Unit regressions                                  |
| `pnpm build`                          | Pages app, editor entry, workers and declarations |
| `pnpm build:root`                     | Root-path production build                        |
| `pnpm test:browser`                   | Production stable Chrome integration              |
| `pnpm test:ui`                        | Focused UI checks with verified build reuse       |
| `pnpm test:tooling`                   | Local scheduling/build/check tooling              |
| `pnpm test:performance`               | Native two/five-minute export acceptance          |
| `pnpm test:safari`                    | Native Safari checks                              |
| `pnpm check:bundle`                   | Entry graph and artifact budgets                  |
| `pnpm check:docs`                     | Local Markdown references                         |
| `pnpm check`                          | Complete normal local gate                        |
| `pnpm test:profile <label> <command>` | CPU/RSS/wall-time profile                         |

## Read guidance at the file's scope

Read each ancestor `AGENTS.md` before editing. The root guide applies everywhere; the nearest module guide adds its local contract. Keep new rules narrow and link shared ownership rather than copying it.

## Find the owner

[Workspace](../src/workspace/AGENTS.md) owns UI state and calls the [editor facade](../src/editor/AGENTS.md). [Core](../src/core/AGENTS.md) owns pure documents/commands, [storage](../src/storage/AGENTS.md) owns persistence, [media](../src/media/AGENTS.md) owns native processing, [services](../src/services/AGENTS.md) and [workers](../src/workers/AGENTS.md) own runtime lifetimes. [Tests](../tests/AGENTS.md) and [scripts](../scripts/AGENTS.md) own validation. Consult [architecture](architecture.md), [API](api.md) and [storage](storage.md) when crossing boundaries.

## Persist reusable computation

Treat refresh and reopening as cache consumers. For every new or changed expensive derived computation, inspect its existing owner and enumerate its UI, editor, worker consumers before implementing it. Reuse a valid persisted result before decoding, analyzing or encoding again. Keep the [computation inventory](storage.md#reusable-computation-inventory) current; an in-memory map alone does not satisfy reuse across refreshes.

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

## One edit, one focused check

Start with the changed owner's narrowest unit or production Chrome scenario. `pnpm test:ui --grep 'speed rounding'` checks/reuses both production builds. Direct browser commands require `pnpm build` followed by `pnpm build:root` first. Builds and browsers sharing `dist`/`dist-root` run sequentially. Verify selectors with `--list` before expensive runs.

Use isolated contexts, namespaces and ports. Normal journeys execute once at `/LocalCut/`; `LOCALCUT_TEST_BASES=both` is diagnostic only. Keep native codec/storage assertions real and do not substitute generic Chromium for stable Chrome.

## Expand verification at the boundary

For draft PR handoff, run formatting, lint, types, `pnpm check:docs`, the affected tooling/unit regressions and the production Chrome scenarios for changed consumers. Source/entry/build changes require both production builds and bundle checks. Record exact commands, candidate identity and deferred coverage; passing focused checks is not full CI.

When merging is requested, run full `pnpm check` locally. It runs formatting, documentation references, lint, types, tooling regressions, units, both verified production builds, bundle budgets and the complete normal Chrome suite. Independent static checks overlap, then unit tests can overlap with the sequential build stage; browser consumers wait for verified outputs and bundle validation. Hosted CI stays disabled.

Follow [validation](validation.md) for the five-minute export gate at merge, and during development whenever changes affect export algorithms or native capabilities. `pnpm test:performance` runs outside normal `check`. Speech inference acceptance is retired; [speech contracts](transcription.md) own saved-transcript and agent-provided STT/TTS checks. Report missing capabilities or failed gates directly.

### Coding-rule and documentation checks

`pnpm lint` type-checks Promise usage in production source and enforces the [dependency direction](architecture.md#enforced-dependency-direction). Use a handled event wrapper when a DOM callback expects `void`; `void` marks an intentional detached call but does not provide rejection handling. The [coding rules](../CONTRIBUTING.md#coding-rules) explain ownership and review obligations.

`pnpm check:docs` parses tracked and non-ignored new Markdown, checking local relative/root-relative files, images and Markdown heading fragments, including reference-style links, encoded paths and duplicate headings. Fenced/inline code and external URLs are inert. It does not validate external sites, commands, test-title selection, raw HTML links or computed runtime imports. Validate a new browser selector with `pnpm test:browser <spec> --list`. New parser dependencies are pinned development-only packages already used by the Markdown stack; they never enter the browser graph.

When changing these checks, run `pnpm exec node --test tests/tooling/docs.test.mjs tests/tooling/lint-rules.test.mjs tests/tooling/resources.test.mjs`, then `pnpm check:docs`, lint and formatting. The fixtures prove broken references, import boundaries and Promise violations fail; the repository check proves the actual docs resolve. The full local runner waits for documentation checks before admitting builds or browser tests.

The shared CPU/memory policy scales unit pools and caps explicit Chrome parallelism with available capacity, without fixed machine-size ceilings. Normal Chrome shares one browser process across concurrent workers with isolated contexts and tabs. `LOCALCUT_BROWSER_WORKERS` caps that context pool, including through `pnpm check`. Unit allocation stays adaptive. The policy accounts for CPU affinity, available memory including reclaimable file cache, and cgroup quotas. Normal shared-browser pools reserve 0.5 GiB per slot, without a fixed worker ceiling; other pools retain 0.75 GiB per slot and a separately launched browser worker reserves two. One GiB stays available for the OS and shared browser parent. Overrides accept positive safe integers and never exceed live headroom: `LOCALCUT_TEST_SLOTS=1` serializes `check`; `LOCALCUT_UNIT_WORKERS=1` narrows the unit pool. Raw Playwright `--workers` remains available for controlled profiling. The `test:browser` runner owns the loopback-only shared browser, closes it after success/failure/interruption, and skips launching it for `--list`. `test:ui` uses the same runner. Functional checks use reduced motion; explicit animation and modal-focus regressions restore full motion.

`check` retains the 0.75-GiB ordinary slot budget for static checks, units and builds, then admits Chrome using the 0.5-GiB shared-context budget after that phase passes. Each phase refreshes capacity at gate boundaries and every second while waiting. Recent CPU-time deltas replace the startup one-minute load estimate; running reservations are counted once. Elastic pools receive the slots available when they launch. Child runners receive the measured slot grant and still apply CPU/quota/RAM caps, avoiding a second subtraction of the parent’s historical load. Already-running pools drain normally under pressure, and worker counts stay fixed for that invocation. Units overlap the sequential builds; Chrome waits for units and bundle validation so a failed unit gate never starts browser acceptance. Direct Vitest commands sample capacity at startup. The Chrome runner and `check` first sample current CPU utilization for 100 ms, avoiding stale one-minute load after earlier work finishes. The Chrome runner forwards that measured grant to its child configuration, which rechecks CPU/quota/RAM without deducting historical load again. Runner logs disclose the allocation and any explicit worker limit. Native Safari and performance gates remain serial and separate so native measurements do not compete.

Use automatic allocation for routine runs: `pnpm check` or `pnpm test:ui --grep '<title>'`. Do not routinely set `LOCALCUT_BROWSER_WORKERS=2`; this deliberate narrowing override can serialize hundreds of cases despite available capacity. Use it only to reproduce a measured contention problem. A five-minute budget is a target for normal `check`, not a guarantee under host pressure; performance remains a separate serial gate.

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

## Resizable panel compatibility

Workspace splits use the shadcn Base Resizable wrappers over pinned `react-resizable-panels` 4.14.3. Its browser ESM pointer calculation is patched through pnpm to translate visual pointer deltas into layout pixels under CSS zoom; keep the patch and lockfile together. This preserves the saved 75%/100%/125% interface sizes. Verify any dependency upgrade with `pnpm test:ui --grep 'workspace resizable|interface size'`, covering horizontal and vertical dividers at the deployed base. Save sizes from completed layouts, not stale imperative reads or per-move callbacks.

## Font catalog maintenance

`node scripts/import-fonts.mjs` is an explicit maintenance operation for the pinned Fontsource metadata snapshot. It imports all licensed upright families and every available regular subset, preserves source URLs/copyright/license notices, and records exclusions. Existing assets are reused only when their checksum matches the family manifest. It does not run during install or build. Update source pins deliberately before adding another snapshot. `pnpm check:bundle` verifies both output catalogs, every WOFF2 hash/license, and the separate 512 MiB font budget while retaining the normal JS/CSS budgets.

Production packaging moves the catalog to `fonts/<snapshot-sha256>/` and embeds that identity in UI/worker font loading. Do not edit files beneath a published snapshot URL. After font/build/cache changes, select `tests/unit/font-cache.test.ts`, `tests/tooling/font-snapshot.test.mjs`, `tests/tooling/build-state.test.mjs`, and `tests/browser/workspace-release.spec.ts` alongside the affected font/media cases. The release browser scenarios exercise missing engine/panel chunks, explicit fresh-HTML recovery with saved project/route retention, and headless discovery that bypasses stale public aliases at the deployed base.

For font or animation changes, run `pnpm test tests/unit/text-library.test.ts tests/unit/text-animation.test.ts`, `pnpm test:ui --grep 'searchable fonts|bundled font pages'`, then (using the same verified builds) `pnpm test:browser tests/browser/text-fonts.spec.ts tests/browser/text-rendering.spec.ts`. The Chrome cases cover real worker glyphs, typewriter and handmade frames, native MP4/WebM reopening, integrity failures, tag search, pagination, editing and persistence at the deployed base. `pnpm test:safari` additionally covers native Safari fonts/animation through real MP4 reopening at the deployed base. Renderer changes retain the separate performance gate.

## Application lifecycle checks

Run `pnpm test:ui --grep 'browser-managed updates|deployment recovery|missing optional UI chunk'` to verify absent update controls/requests, desktop/mobile headers, saved-project reload and missing-asset recovery at the deployed base. Build identity remains available for error diagnostics and deployment inspection; changes to revision generation also require `node --test tests/tooling/build-state.test.mjs`, both builds and `pnpm check:bundle`. Lifecycle reload remains user-owned, outside the editing-feature access inventory.

## Notification history checks

For error diagnostics and notification history, run `pnpm test tests/unit/error-diagnostics.test.ts tests/unit/notification-history.test.ts tests/unit/services.test.ts tests/unit/task-queue.test.ts tests/unit/worker-publication.test.ts`, then `pnpm test:ui --grep 'notification history|concurrent notification reports|saved task failures stay quiet'`. The Chrome scenario covers the deployed base, original stack/session capture, clipboard success/check/reset and denial, dismissal, persisted reopening, informational notifications, unread dots, clear history, narrow layouts and simultaneous reports under a shared write lock. The saved-task journey additionally verifies quiet startup/reopening, fresh polling/retry failures, unchanged original reports and read flags across reload, clear-history persistence and no inference requests. Notification history is user-owned lifecycle UI; it changes no editing operation.

## Dialog opening checks

For on-demand dialog code, loading focus or command-palette preparation, run `pnpm test:ui --grep 'first dialog opening|dialog loading shell|commands load metadata|simple dialogs keep heavy|failed dialog chunks'`. The production Chrome cases cover the deployed base, full motion, pre-imported first openings versus repeats, slow/failed chunks, dismissal before completion, focus return after reopening, parallel command preparation, heavy-body isolation and inert bare startup. The pre-import probe retains a 250 ms mount budget to catch the former roughly 300 ms Suspense retry floor; diagnostic timing attachments distinguish shell and resolved dialog mounts.

Run affected existing consumer journeys as well, including `project switcher dialog`, `error stack trace`, `task queue table`, `workspace settings`, `screen recording`, `searchable fonts`, `speed rounding` and relevant backup cases. Keep engine, storage and native export gates separate; changing only UI-module loading does not change their owners.

## Clip properties and instance menu checks

Run `pnpm test tests/unit/timeline-features.test.ts`, then `pnpm test:ui --grep 'timeline clip action menus|creative clip controls|speed rounding|stale property|object keyframes|custom speed ramps|searchable fonts|bundled font pages|existing text font sizes|workspace commands discover|timeline overlap context menu|mobile touch editing|timeline clip movement|timeline narrow clips|editor combinations.*native clip activation'`. The targeted stable Chrome journeys cover the deployed base, exact repeated-asset instance ownership, tabs/drafts/invalid-field recovery, mouse/keyboard/touch and cancellation, read-only/stale menus, shared history/reload, timing, animation, text styles and retained overlap/drag controls. Tabs and menu state use the existing canonical editing schemas. Native media and performance owners are unchanged.

## Playback scheduling and FPS checks

For preview scheduling, bitmap ownership and audio underrun changes, start with `pnpm test tests/unit/preview-latency.test.ts tests/unit/services.test.ts tests/unit/worker-publication.test.ts tests/unit/publication.test.ts`. After both production builds, run the affected native facade/lifecycle, media, saved-version and workspace playback/keyboard/timeline scenarios. The shared renderer retains `pnpm test:performance`; saved transcript compatibility remains covered separately.

Measure editor playback serially with no competing browser workloads:

```sh
LOCALCUT_MEASURE_PLAYBACK=1 LOCALCUT_BROWSER_WORKERS=1 pnpm test:browser tests/browser/workspace-playback-performance.spec.ts
# Optional acceptance threshold after collecting the baseline:
LOCALCUT_MEASURE_PLAYBACK=1 LOCALCUT_PLAYBACK_MIN_FPS=27 LOCALCUT_BROWSER_WORKERS=1 pnpm test:browser tests/browser/workspace-playback-performance.spec.ts
```

The opt-in production Chrome benchmark uses the same generated 1080p30 native MP4, bounded native PCM, 60 timeline labels, and plain/color-graded variants. Each variant runs three five-second windows after warmup. A 64×36 content fingerprint sampled at repaint boundaries distinguishes repeated source frames from actual visible changes; it also reports canvas writes, p95/maximum distinct-frame gaps, timeline advancement and transferred bitmap dimensions. Both sides of a comparison must use the identical benchmark instrumentation and browser/viewport. The attached `playback-fps.json` and logged raw trials establish synthetic local frame delivery, not arbitrary user-project performance or monitor-level presentation. Sampling overhead is included on both sides. Ordinary browser checks skip this timing benchmark.

## Audio sample boundary checks

Run `pnpm test tests/unit/audio-effects-window.test.ts tests/unit/core.test.ts tests/unit/speed.test.ts tests/unit/timeline-features.test.ts`, then both builds and `pnpm test:browser tests/browser/media-acceptance.spec.ts --grep 'audio mixer|trimmed audio'`. The generated-source regressions check exact starts/ends, zero gain, fades, EQ/denoise, keep-pitch and loops; native Chrome verifies finite decoded AAC with a non-silent bounded tone at an affected endpoint. The negative control must fail for the old floating-microsecond subtraction. These checks establish finite sample membership and native encoding, not subjective sound quality. Shared mixer changes retain the performance gate.

## Chrome behavior and deployment coverage

Normal Chrome acceptance uses the deployed base once. Keep explicit fixture variants and production asset/worker coverage; see [journey policy](playwright-journeys.md). Both static builds remain required. Hosted validation is disabled; pushes to `main` deploy Pages after authorized merge.

## Durable task queue checks

Run `pnpm test tests/unit/task-queue.test.ts tests/unit/task-cache.test.ts`, then the production `tests/browser/task-queue.spec.ts` and affected editor/UI scenarios. Queue persistence, cancellation and committed results remain independent of the removed agent runtime.

## Project header and workspace path checks

Run `pnpm test tests/unit/project-route.test.ts`, then `pnpm test:ui --grep 'project routing|project navigation'`. The root shows the catalog; fresh empty startup stays inert and explicit workspace paths restore authoritative local snapshots. Use `LOCALCUT_TEST_BASES=both` for the route/deep-link hosting diagnostic.

## Storyboard checks

Run the storyboard unit files and `pnpm test:ui --grep 'workspace storyboard|storyboard export'`. Keep canvas edits, shared history, reload, export and Media persistence on the public editor facade. See [storyboard workflows](storyboard-workflows.md).

## Capture metadata checks

Run `pnpm test tests/unit/capture-metadata.test.ts tests/unit/workspace-backup.test.ts`, then `pnpm test:browser tests/browser/capture-metadata.spec.ts`. Capture dates/GPS stay local and readable in existing projects/backups.

## Creative effect checks

Run affected effects/tracking unit files and `pnpm test:ui --grep 'creative effects|creative clip|black transitions'`. Preview/export output remains native. No assistant access inventory is maintained after removal.

## Sound library checks

Run `pnpm test tests/unit/sound-library.test.ts tests/unit/media-import.test.ts`, `node --test tests/tooling/build-state.test.mjs`, and `node scripts/check-sounds.mjs`. Then use `pnpm test:ui --grep 'sound library'` for lazy browsing, filtering, native preview/import/export, timeline placement/reload, failure/cancellation and responsive access. Both builds and bundle checks inspect every shipped sound and source notice. See [research and reproducible preparation](sound-effects.md). These checks establish file integrity and native behavior, not comprehensive listening approval.

## Media folder checks

Run `pnpm test tests/unit/media-library.test.ts tests/unit/media-import.test.ts`, then `pnpm test:browser tests/browser/media-folders.spec.ts` and affected workspace import/folder scenarios. Preserve library revision, source retention, late commits and folder focus recovery.

## Browser coding checks

The local coding API remains an independent headless engine capability. Run `pnpm test tests/unit/coding.test.ts tests/unit/coding-runtime.test.ts` for sandbox, filesystem and cancellation changes. It has no assistant, provider or network bindings.

## Agent removal checks

Run `pnpm test tests/unit/workspace-preferences.test.ts tests/unit/workspace-settings.test.ts tests/unit/error-diagnostics.test.ts tests/unit/task-queue.test.ts`, both production builds and `pnpm check:bundle`. Then run `pnpm test:browser tests/browser/workspace-agent-removal.spec.ts tests/browser/workspace-resizable.spec.ts tests/browser/editor.spec.ts tests/browser/lifecycle.spec.ts`. These cover inert upgrade/startup, removed provider controls/module, manual edits, mobile tabs, resize persistence and engine lifetime. Historical chat/reference data stays inert; original media remains intact.

## WebMCP checks

For connection status and manual refresh, run `pnpm test tests/unit/webmcp-connection.test.ts tests/unit/webmcp.test.ts tests/unit/webmcp-skills.test.ts`, then `pnpm test:ui --grep 'browser agent|workspace WebMCP'`. The connection journeys cover late browser API injection, registration failure/retry, inert startup, request timestamps, mobile/focus behavior, retained jobs/results across refresh and route disposal.

Run `pnpm test tests/unit/webmcp.test.ts tests/unit/receipt-content.test.ts`, then `pnpm test:ui --grep "workspace WebMCP"`. The production Chrome journeys cover complete-schema edits, canonical receipts/retries, visible/persisted changes, Undo/Redo, selection/seek, historical read-only snapshots, navigation/reload, local Media import/relink, real preview pixels, native MP4 encode/decode and released URLs. The controlled registration harness isolates transport from browser availability; native discovery separately uses the actual browser API and explicitly skips when unavailable. Neither proves every agent’s interoperability or model quality. Both static builds and existing bundle caps remain required; media algorithms are unchanged. Use `LOCALCUT_TEST_BASES=both` only for hosting-path diagnostics.

## Skills and asset text checks

After skill edits, run `node scripts/skills-index.mjs --write`, then `node scripts/skills-index.mjs`. Run `pnpm exec node --test tests/tooling/skills.test.mjs`, `pnpm test tests/unit/webmcp-skills.test.ts tests/unit/asset-clips.test.ts tests/unit/workspace-backup.test.ts`, then `pnpm test:ui --grep "workspace WebMCP"`. The Chrome harness covers metadata-first discovery, exact static/runtime guidance, inert storage, navigation/historical availability, editable source clips, conflict recovery, reload, per-clip previews and narrow layouts. Native WebMCP discovery remains a separate availability check, not proof of agent adherence.

For asset persistence/API changes, also run `pnpm test:browser tests/browser/asset-clips.spec.ts tests/browser/asset-metadata.spec.ts tests/browser/editor.spec.ts tests/browser/lifecycle.spec.ts tests/browser/recovery.spec.ts` after both production builds. The source-clip journey covers real cross-editor conflicts/events, unchanged originals/revisions, close/reopen, backup remapping and relink retention. Both static builds and bundle checks validate published skill bytes/hashes against source. Rendering algorithms are unchanged by these metadata and static-guidance features.

## Asset viewing and content checks

Run `pnpm test:ui --grep 'asset viewing|workspace asset menus|media select-all|workspace media thumbnails'`, then `pnpm test:browser tests/browser/asset-clips.spec.ts` against the same current builds. The viewer journey covers original image pixels, native audio/video play and seek, manual context/transcript saves for all three kinds, fresh reads/reload/mobile, absent Index controls and no analysis tasks, missing-source recovery and browser-Back/URL cleanup. Source-clip cases retain range, timed transcript, read-only and conflict coverage. Internal analysis is unchanged; its native evidence remains separate from this UI.
