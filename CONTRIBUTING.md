# Contributing to LocalCut

Thank you for helping improve LocalCut. Documentation, bug reproduction, accessibility feedback, tests and code are all useful contributions. Follow the [Code of Conduct](CODE_OF_CONDUCT.md) in issues, reviews and other project spaces.

## Find a useful starting point

Read the [README](README.md), try the [first-edit guide](docs/getting-started.md), and search [existing issues](https://github.com/WilsonLe/LocalCut/issues) and [pull requests](https://github.com/WilsonLe/LocalCut/pulls) before starting. An issue is not assigned work unless a maintainer agrees; ask on the issue before investing in a substantial change. Small documentation fixes and focused reproductions are good first contributions. Do not assume an unlabelled issue is beginner-friendly.

Open or reuse a tracking issue before implementation. Describe the user problem, expected result and acceptance evidence. For new features, agree on scope and the existing module that should own the behavior. Keep unrelated refactors out of that change. See the [roadmap](docs/roadmap.md) for priorities, and [SUPPORT.md](SUPPORT.md) for what makes a useful report. Report security concerns through [SECURITY.md](SECURITY.md).

## Set up your checkout

Fork the repository if you cannot push branches here. Follow [README setup](README.md#setup) using your fork's clone URL, Node 24 and pnpm 11.25.0. Use `pnpm install --frozen-lockfile`; keep dependency versions and the lockfile pinned. Local editing needs no runtime secrets. Stable Google Chrome is needed for the complete native browser acceptance target; Playwright Chromium/WebKit are not substitutes for Chrome/native Safari evidence.

Work on a focused branch in an isolated worktree, leaving your regular checkout intact. For example, from a clean fork clone after fetching its current `main`:

```sh
git fetch origin main
git worktree add -b codex/short-description ../LocalCut.worktrees/short-description origin/main
cd ../LocalCut.worktrees/short-description
pnpm install --frozen-lockfile
```

This creates a new worktree; do not reuse another contributor's worktree or reset unrelated changes. Install dependencies inside it. Follow the [development guide](docs/development.md) for resource isolation and failure recovery.

Read [AGENTS.md](AGENTS.md), [user preferences](docs/user-preferences.md), and each ancestor/module `AGENTS.md` before changing files. These guides apply to coding agents and document the shared engineering contracts for humans too.

## Engineering expectations

- Keep project edits in the shared engine. UI and assistant controls call its public APIs; do not duplicate editing state or provider logic in components.
- Preserve stable IDs, transactional edits, revisions, Undo/Redo, cancellation and owned storage cleanup. Treat saved-project and backup compatibility as public contracts.
- Keep local workflows local. Remote data sharing and paid provider requests require the existing explicit consent/action boundaries; never bundle credentials or log tokens/callbacks.
- Use existing shadcn/Base UI primitives and semantic styling. Preserve keyboard interaction, focus, text entry, accessible names and reduced-motion behavior.
- Preserve both `/` and `/LocalCut/` hosting. Keep native codec, local inference and export evidence real; mocks may isolate transport behavior but do not prove native acceptance.
- Keep dependencies and model/runtime revisions exact. Include license/provenance and artifact hashes for bundled assets. Do not add personal media, tokens, private logs or local environment files to Git.

The [development ownership map](docs/development.md#find-the-owner) points to the module responsible for each change. [Architecture](docs/architecture.md), [API](docs/api.md), [storage](docs/storage.md), [AI](docs/ai.md) and [transcription](docs/transcription.md) remain the detailed contracts.

## Coding rules

| Rule                              | Apply it in a change                                                                                                                                                                                                     | Evidence                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| One behavior, one owner           | Workspace event handlers use the editor facade; assistant services use the same engine. Derive view state from snapshots rather than maintaining another editable document.                                              | A UI/assistant operation produces the same persisted result and receipt.                |
| Validate at trust boundaries      | Parse imported documents, provider replies and tool arguments at their existing schema owners. Use `unknown` until validated; derive types/options from canonical schemas.                                               | Malformed input fails before mutation; valid optional fields survive.                   |
| Capture mutation identity         | Keep project ID, authored revision and request ID across asynchronous work. A stale form refreshes for retry instead of silently applying to another revision.                                                           | Conflict, idempotent retry and committed-result regressions.                            |
| Own every asynchronous lifetime   | Await or return work. At a synchronous event boundary, use `void` only when the called owner handles rejection and exposes failure. Dispose listeners/resources in `finally` or effect cleanup.                          | Cancellation, supersession, failure and late-commit behavior at the owning consumer.    |
| Extract cohesive responsibilities | Move a service dispatcher, interaction controller or lifecycle owner with explicit typed inputs. Keep the same state owner, hook order and lazy imports; avoid arbitrary file-size limits or generic context containers. | Existing behavioral tests, public declarations and production bundle checks stay valid. |
| Test observable contracts         | Assert resulting state, output, receipts and cleanup, including a relevant failure path. Prefer deterministic barriers over sleeps.                                                                                      | A plausible wrong implementation fails the regression; mocks remain scoped evidence.    |
| Keep contracts discoverable       | Update the existing contract and nearest module guide in the same change. Link shared rules; retain historical evidence with its revision.                                                                               | `pnpm check:docs`, formatting and validated command/test selectors.                     |

For example, a timeline gesture calls the existing revision-aware `apply` owner:

```ts
void action(async () => {
  await apply([{ type: 'removeClip', clipId }]);
  setSelection([]); // Update view state only after the command succeeds.
});
```

Here `action` owns visible errors and busy-state cleanup. Writing `void` before an arbitrary rejecting promise does not handle its failure. Prefer `try/finally` around subscriptions; cancellation stops unpublished work, while an already committed receipt remains authoritative. See [publication semantics](docs/storage.md) for the exact boundary.

ESLint enforces strict Promise use and dependency direction through static imports/re-exports and literal dynamic UI imports. Pure core code also rejects dynamic imports and browser globals. Computed runtime import targets and the meaning of `void` still require review; these checks do not establish authorization, race safety or semantic quality.

## Verify your change

During iteration, choose the smallest meaningful check from [development recipes](docs/development.md#one-edit-one-focused-check). Run builds sequentially when they share output directories, and use isolated storage namespaces/ports for independent browser runs.

For documentation-only changes, run `pnpm format:check`, check local links/anchors, and validate new commands against their implementation. Full media workloads add no evidence when runtime inputs are unchanged.

Before a draft code, configuration or dependency handoff, run the affected behavior checks, static checks, documentation checks and required builds/native gates from [development](docs/development.md#expand-verification-at-the-boundary). Run the complete `pnpm check` and required transcription/performance acceptance when merging is requested. Safari and paid-provider acceptance are separately scoped. State what ran, what passed and what remains deferred. Do not claim a mocked provider request proves account entitlement or natural speech quality.

Hosted validation CI is disabled by project choice. Do not add or re-enable it; the Pages workflow packages and releases static files. Local quality evidence belongs in the PR. Documentation-only PRs use documentation checks rather than a runtime suite rerun.

## Open a pull request

Push your feature branch to your fork (or this repository if authorized) and open a **draft PR against `main`**. Use the PR template:

- Explain the problem and resulting behavior, and link every tracking issue. Use `Closes #number` only when the PR fully delivers it; otherwise use `Refs #number`.
- Link the PR back from each issue. Keep the issue scope current when findings change it.
- List exact check commands/results and the tested commit; distinguish local author evidence, independent review and external/live outcomes. Add screenshots for UI changes, using generated or shareable test data.
- Update affected documentation/contracts in the same change, or explain why no update is warranted. Include storage compatibility and rollback implications where relevant. For notable changes, add a brief end-user/executive outcome under Unreleased in [CHANGELOG.md](CHANGELOG.md) and link the complete diff; propose the release impact using [SemVer rules](docs/releasing.md#semantic-versioning). Maintainers choose the combined release version; do not bump the manifest for every PR.

A maintainer arranges one independent review-and-address cycle on a frozen candidate, then records the reviewed and resulting heads. Address actionable in-scope findings and rerun affected checks; do not automatically launch a second independent review. Explain unresolved feedback and limitations. See [review and delivery](docs/development.md#review-and-delivery).

Maintainers authorize merges. Merging to `main` automatically triggers Pages deployment; local checks and merge/release approval remain distinct. Keep your branch available for review until the change is accepted or closed.

## Licensing contributions

Submit only work you have the right to contribute. Original contributions are provided under this project's [MIT License](LICENSE); third-party content retains its own compatible license and attribution. Identify the source and license of added dependencies, fonts, models, fixtures and copied examples, and update [third-party notices](THIRD_PARTY_NOTICES.md) when needed. AI-assisted contributions have the same correctness, provenance and privacy requirements as any other contribution. Do not submit generated code or documentation you cannot explain and verify.
