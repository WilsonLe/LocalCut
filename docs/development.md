# Development loop

Start with the [contributor contract](../AGENTS.md) and, for workspace changes, [user preferences](user-preferences.md). Use the pinned setup and [command table](../README.md#setup). Work in an issue-linked isolated feature worktree; reuse the task's existing worktree and draft PR when continuing a change.

Verify Node 24, pnpm 11.25.0, and installed stable Google Chrome once, then reuse that setup throughout the iteration. Run `pnpm install --frozen-lockfile` when dependencies are missing or the lockfile changes; do not reinstall or download a browser after every edit. Generic Playwright Chromium does not satisfy the native codec acceptance gate.

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

## One edit, one focused check

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

Keyboard and assistant service regressions have their own specs. After the same two builds are current, run `pnpm test:browser tests/browser/keyboard.spec.ts tests/browser/ai-actions.spec.ts`. The keyboard tests use real persisted edits and native playback; the assistant tests reopen native MP4/WebM artifacts. To check just the AAC configuration regression before building, use `pnpm test tests/unit/audio-config.test.ts`.

For a non-UI Chrome regression, build both targets after changing production code, then select its spec:

```sh
pnpm build
pnpm build:root
pnpm test:browser tests/browser/recovery.spec.ts
```

When only that test changed and the production builds are still current, reuse them and run the last command. Direct `test:browser` does not validate or rebuild assets. Use `--list` with that command to check selection without launching Chrome. Do not replace native codec or inference evidence with unit mocks.

For documentation-only edits, check formatting and the referenced files/commands. Reuse existing code evidence when the code and tests are unchanged; a full build or browser rerun adds no evidence for a prose correction.

For text-to-speech changes, start with `pnpm test tests/unit/speech.test.ts tests/unit/openrouter.test.ts`, then `pnpm test:ui --grep 'text to speech'`. These test live catalog/voice validation, multilingual request settings, cancellation, exact pitch-preserving timing, local import/history/reopening and native export. Provider interception is deterministic transport evidence; assess natural delivery separately with an explicitly connected account and a Generate action.

## Expand verification at the boundary

Run `pnpm check` locally before handing off code changes and after changes to shared contracts, dependencies, build configuration, or the test pipeline. It runs formatting, lint, types, tooling regressions, units, both verified production builds, bundle budgets, and the complete normal Chrome suite. Independent static checks overlap, then unit tests can overlap with the sequential build stage; browser consumers wait for verified outputs and bundle validation. Focused checks make the iteration fast; they do not replace this integration gate. Hosted CI is disabled; local results are the acceptance evidence.

Follow [validation](validation.md) for real transcription/cached replay and the five-minute export gate before implementation handoff, and whenever changes affect those capabilities. They are explicit `pnpm test:transcription` and `pnpm test:performance` commands, outside normal `check`. Real-provider testing is separately opt-in; read [AI privacy and live-test requirements](ai.md) before `pnpm test:ai:live`. Report missing capabilities or failed gates directly.

A shared CPU/memory policy selects up to eight slots/unit workers and four Chrome workers at command startup. It accounts for CPU affinity, host load, available memory including reclaimable file cache, and cgroup quotas. Each Chrome worker reserves two slots. `LOCALCUT_TEST_SLOTS=1` serializes the entire check pipeline; `LOCALCUT_UNIT_WORKERS` (1–8) and `LOCALCUT_BROWSER_WORKERS` (1–4) narrow worker pools. Capacity caps still apply. Allocation and per-gate timings are printed. Native Safari runs separately with `pnpm test:safari` on macOS; follow [Safari prerequisites and scope](../tests/safari/AGENTS.md). Heavy transcription/performance and live-provider tests remain serial. Keep those resource measurements separate from other browser workloads.

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
pnpm test tests/unit/asset-index.test.ts tests/unit/asset-index-provider.test.ts
pnpm test:ui --grep 'workspace indexing'
# After both current builds:
pnpm test:browser tests/browser/asset-index.spec.ts
pnpm test:performance
```

The native performance workload measures scanning and excerpt generation separately after its export measurements, with no provider request. Total generation/labeling work depends on detected scene count. Four-Hz discovery covers every detected shot, but can miss shots/transitions shorter than the 250 ms sample interval or visually similar cuts; lighting changes may cause extra cuts; highlight scoring describes sampled pixels rather than semantic importance. Audio uses deterministic energy/silence boundaries and bounded continuous segments, not semantic speech/music sections. LLM labels are nondeterministic. See [AI consent and live verification](ai.md#manual-asset-indexing).
