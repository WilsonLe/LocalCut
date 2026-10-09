# Development loop

Start with the [contributor contract](../AGENTS.md) and, for workspace changes, [user preferences](user-preferences.md). Use the pinned setup and [command table](../README.md#setup). Work in an issue-linked isolated feature worktree; reuse the task's existing worktree and draft PR when continuing a change.

Verify Node 24, pnpm 11.25.0, and installed stable Google Chrome once, then reuse that setup throughout the iteration. Run `pnpm install --frozen-lockfile` when dependencies are missing or the lockfile changes; do not reinstall or download a browser after every edit. The [CI Chrome installer](../scripts/install-chrome.mjs) provisions signed desktop Chrome. Generic Playwright Chromium does not satisfy the native codec acceptance gate.

## Find the owner

| Directory                                          | Responsibility                                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/workspace/`                                   | Conversation, preview, timeline, settings, and their UI state; editing goes through the shared APIs. |
| `src/components/ui/`, `src/styles.css`, `src/lib/` | Shared shadcn/Base UI primitives, semantic styling, and utilities.                                   |
| `src/core/`                                        | Pure documents, commands, identity, captions, timing, and resampling.                                |
| `src/editor/`                                      | Public editor facade, lifecycle, jobs, and events exposed to consumers.                              |
| `src/storage/`                                     | IndexedDB transactions, OPFS originals, journals, recovery, and quota.                               |
| `src/media/`                                       | Import/decode, derivatives, composition, and streaming export.                                       |
| `src/services/`, `src/workers/`                    | Preview clock, job/worker transport, and local media/transcription execution.                        |
| `src/ai/`                                          | Optional OpenRouter authentication, transport, context policy, and proposed edits.                   |
| `tests/unit/`, `tests/browser/`, `tests/live/`     | Pure/service tests, production Chrome acceptance, and opt-in paid-provider acceptance.               |
| `scripts/`, `.github/workflows/`                   | Builds, verified build reuse, test server, artifact checks, and CI.                                  |

See [architecture](architecture.md) and [API contracts](api.md) before crossing a boundary. Preserve the existing owner instead of duplicating project state in a control or transport.

## One edit, one focused check

Choose the smallest test that exercises the changed behavior, then run the cheap static checks. For a preview scheduling change:

```sh
pnpm test tests/unit/preview-latency.test.ts
pnpm typecheck
pnpm lint
pnpm format:check
```

For workspace changes, use `pnpm dev` for interactive work, then run the matching production UI scenario:

```sh
pnpm test:ui --grep 'speed rounding'
```

This example selects the existing speed regression at both `/` and `/LocalCut/`. Replace the filter with the relevant test title, or omit it to run all workspace specs. The command verifies source/configuration/dependency fingerprints and every output file, rebuilding only stale targets. It reuses current assets after test-only or documentation changes. Build stamps live in ignored `.cache/build-state/`; `dist` and `dist-root` remain deployable output only.

For a non-UI Chrome regression, build both targets after changing production code, then select its spec:

```sh
pnpm build
pnpm build:root
pnpm test:browser tests/browser/recovery.spec.ts
```

When only that test changed and the production builds are still current, reuse them and run the last command. Direct `test:browser` does not validate or rebuild assets. Use `--list` with that command to check selection without launching Chrome. Do not replace native codec or inference evidence with unit mocks.

For documentation-only edits, check formatting and the referenced files/commands. Reuse existing code evidence when the code and tests are unchanged; a full build or browser rerun adds no evidence for a prose correction.

## Expand verification at the boundary

Run `pnpm check` before handing off code changes and after changes to shared contracts, dependencies, build configuration, or the test pipeline. It always runs formatting, lint, types, units, both production builds, bundle budgets, and the complete normal Chrome suite. Focused checks make the iteration fast; they do not replace this integration gate.

Follow [validation](validation.md) for real transcription/cached replay and the five-minute export gate before implementation handoff, and whenever changes affect those capabilities. They are explicit `pnpm test:transcription` and `pnpm test:performance` commands, outside normal `check`. Real-provider testing is separately opt-in; read [AI privacy and live-test requirements](ai.md) before `pnpm test:ai:live`. Report missing capabilities or failed gates directly.

Normal Chrome tests use two workers. Set `LOCALCUT_BROWSER_WORKERS=1` for serial diagnosis; the supported override is 1–4. Heavy transcription/performance and live-provider tests remain serial. Keep those resource measurements separate from other browser workloads.

## Isolate runs and resume from evidence

- Give engine tests unique namespaces, following `test-` plus `crypto.randomUUID()` in existing browser specs. Dispose sessions, engines, and returned artifacts. Follow [storage ownership](storage.md); never clear an origin's unrelated data.
- Coordinate one owner for each test server and output directory. The default test port is 4178; for a separate run, use an available port, for example `LOCALCUT_TEST_PORT=4185 pnpm test:browser tests/browser/recovery.spec.ts`. A different port does not isolate `dist`, `dist-root`, or reports.
- Finish builds before starting browser acceptance. Do not write either production output directory while another test is using it. Distinct worktrees or serialized runs avoid that conflict; evidence belongs to the build tested.
- Read the failing assertion and retained trace in `test-results/`, plus the HTML report in `playwright-report/`, before retrying. CI archives failure artifacts. Preserve the command, revision, base path, and observed values; timing failures need actual clock values, not just a boolean result.
- Fix the identified cause and rerun the affected scenario. Broaden only when the change reaches another owner or a remaining failure needs it. Resume successful work from its artifacts instead of restarting the complete suite after every edit.

## Review and delivery

Keep the issue, draft PR, implementation, and evidence aligned. Run exactly one automatic independent review cycle for the candidate. Address its findings and run targeted revalidation plus any affected integration gates; do not automatically start another review of those fixes. Record remaining limitations and the checks actually run.

Merge and deployment require separate authorization. Follow [deployment and rollback](../DEPLOY.md) for the release gate; a local pass or review approval does not prove hosted CI, merge, or deployment succeeded.
