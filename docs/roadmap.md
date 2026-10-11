# Roadmap and proposals

This is a statement of direction, not a dated release promise or a complete task backlog. [Open issues](https://github.com/WilsonLe/LocalCut/issues) track proposed/in-progress work; merged PRs and verified releases establish delivery. Review a feature's implementation and evidence before treating an issue as shipped.

## Priorities

- **Reliable local editing:** preserve projects/originals, make recovery and portable backups understandable, and keep preview/export aligned through the shared engine.
- **Useful editing workflows:** improve timeline, text, captions, transitions, audio and keyboard/touch interaction using existing APIs and accessible controls.
- **Explicit AI choices:** keep editing proposals reviewable, disclose every remote service/data recipient, and preserve cancellation and credential lifecycle boundaries.
- **Browser quality:** retain actual Chrome codec/inference/export acceptance; expand native Safari coverage with measured evidence rather than assuming parity.
- **Fast contributor feedback:** maintain focused checks, verified build reuse, isolated test state and readable ownership documentation while keeping release gates intact.
- **Open-source readiness:** maintain contributor/support/security guidance, provenance/notices, issue/PR templates and a clear maintainer process.

The current capabilities and limits are in the [README](../README.md), [workspace contract](workspace.md) and [validation guide](validation.md). Propose improvements against those contracts, using a concrete editing scenario and a smallest useful outcome.

## Deferred or outside the current contract

There is no cloud account/project sync, application backend, service worker/full offline navigation, or published npm package. Mobile/browser codec parity and every provider/account's live acceptance are not established by the current desktop Chrome target. These are boundaries to discuss explicitly, not hidden tasks promised for the next release.

A new persistence model, framework, backend, public interface or deployment mechanism needs a separate scoped proposal with migration, consent, resource and validation implications. Enabling remote CI conflicts with the current local-validation preference.

## Propose a feature

Use the [feature template](https://github.com/WilsonLe/LocalCut/issues/new/choose). Explain who needs it, the present failure or missing workflow, desired result, alternatives and acceptance checks. Identify privacy/storage/accessibility impacts and any native browser/provider prerequisites. Link related issues and avoid bundles of unrelated features.

Maintainers may accept, narrow, defer or decline the proposal with a reason. An accepted issue still needs a reviewed implementation and release evidence. Update this document only when project direction changes; keep task status in issues to avoid two competing backlogs.
