# LocalCut agent guide

## Start here

- Read [user preferences](docs/user-preferences.md); update that record when the user states a durable preference. Newer explicit choices take precedence.
- Use [README setup and commands](README.md#setup), then the [development guide](docs/development.md) for module ownership, focused checks, and failure recovery. Read the relevant API, storage, AI, or deployment contract only when the change touches it.
- Before editing a file, read the `AGENTS.md` files in its ancestor directories, including the nearest module guide. Root guidance applies everywhere; nested guidance adds the local contract. Keep instructions at their narrowest useful scope and link shared rules instead of copying them.
- Inspect the current branch, dirty files, base, and linked issue/PR before editing. Reuse the task's isolated feature worktree and existing tracking issue; preserve unrelated work. Keep the issue's scope current before implementation.

## Keep one development cycle short

- Change the existing owner of a behavior. UI controls call the shared engine/assistant APIs; do not duplicate editing or provider logic in components.
- During iteration, run the smallest meaningful test for the changed behavior. `pnpm test:ui --grep 'speed rounding'` is an example of a focused production-UI check that verifies and reuses both static builds. Use the [check-selection recipes](docs/development.md) for other layers.
- Keep builds and tests in sequence when they share `dist` or `dist-root`. Parallelize isolated tests/read-only investigation; use separate ports and storage namespaces for independent browser runs.
- Before a code, configuration, or dependency handoff, run `pnpm check` plus the affected real Chrome transcription/performance gates. For documentation-only changes, validate formatting, links, and any new commands, and retain clearly scoped evidence for unchanged runtime code. Do not repeat successful expensive checks without changed inputs, a failure, or an unresolved concern.
- Run validation locally. The user has disabled remote CI; do not add or re-enable hosted check/performance workflows. Pages deploys automatically on pushes to `main`; release packaging is separate from validation.
- Freeze the candidate and run one independent draft-PR review-and-address cycle. Fix accepted findings and rerun affected checks; do not automatically start another independent review. Record the reviewed and resulting heads and distinguish author validation from independent review.
- Keep the issue and PR linked both ways. Report the exact head/base, checks, limitations, and release state. Merge requires authorization. Pushes to `main` automatically deploy Pages under the recorded user preference.

## Scoped entry points

- [Application and runtime](src/AGENTS.md): shared source constraints, with module guides below it.
- [Tests](tests/AGENTS.md): isolation and evidence, with separate unit, browser, and live-provider guides.
- [Build and tooling](scripts/AGENTS.md), [release workflow](.github/workflows/AGENTS.md), and [documentation](docs/AGENTS.md).
- Keep dependencies and the lockfile pinned. Model/runtime revisions and artifact hashes are contracts. Required native codec and inference evidence cannot be replaced by mocks or a different browser channel.
