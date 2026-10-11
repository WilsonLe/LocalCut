# Documentation

Choose a starting point for the work you want to do. Current behavior lives in the linked contracts; dated acceptance/review records are evidence for their recorded revisions.

## Use LocalCut

| Guide                                 | What it covers                                                     |
| ------------------------------------- | ------------------------------------------------------------------ |
| [Project overview](../README.md)      | Features, browser limits, demo, setup and commands                 |
| [Getting started](getting-started.md) | First edit, AI choices, exports, versions and portable backups     |
| [Privacy and data flows](privacy.md)  | Local storage, remote actions, credentials and deletion boundaries |
| [Troubleshooting](troubleshooting.md) | Storage, codec, model, provider and setup failures                 |
| [Support](../SUPPORT.md)              | Safe bug reports, questions and proposals                          |
| [Workspace contract](workspace.md)    | Detailed user interaction and state behavior                       |

## Contribute and integrate

| Guide                                         | What it covers                                                     |
| --------------------------------------------- | ------------------------------------------------------------------ |
| [Contributing](../CONTRIBUTING.md)            | Issue-first changes, setup, validation, PRs and licensing          |
| [Development](development.md)                 | Module ownership, focused checks, build reuse and failure recovery |
| [Architecture](architecture.md)               | Runtime boundaries and state ownership                             |
| [API](api.md)                                 | Headless editor contracts, commands and lifecycle                  |
| [Storage](storage.md)                         | IndexedDB/OPFS, recovery, versions and backup compatibility        |
| [AI providers](ai.md)                         | Connections, routing, approvals and provider-specific disclosures  |
| [Transcription](transcription.md)             | Pinned local model/runtime preparation and audio processing        |
| [Validation](validation.md)                   | Native codec/inference/export requirements and scoped results      |
| [Playwright journeys](playwright-journeys.md) | Compatible browser journeys and isolation boundaries               |
| [Agent guide](../AGENTS.md)                   | Root instructions; read the relevant nested module guides too      |

## Maintain and release

| Guide                                                                    | What it covers                                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| [Governance](governance.md)                                              | Decisions, maintainers and contributor responsibilities       |
| [Roadmap](roadmap.md)                                                    | Priorities, non-goals and proposal criteria                   |
| [Maintainer guide](maintaining.md)                                       | Triage, review, repository readiness and documentation upkeep |
| [Releasing](releasing.md)                                                | SemVer, short changelog/full diffs, approval and evidence     |
| [Deployment](../DEPLOY.md)                                               | Pages, self-hosting, live checks and compatible rollback      |
| [Security](../SECURITY.md)                                               | Private reporting limitations and vulnerability handling      |
| [Code of Conduct](../CODE_OF_CONDUCT.md)                                 | Community expectations and moderation                         |
| [License](../LICENSE) / [third-party notices](../THIRD_PARTY_NOTICES.md) | MIT project terms and separately licensed content             |
| [User preferences](user-preferences.md)                                  | Maintained product and delivery choices                       |

See the [changelog](../CHANGELOG.md) for notable changes; Unreleased entries are not live release claims.

## Historical evidence

[Engine acceptance](acceptance.md), [engine review](review.md), [workspace review](workspace-review.md), and performance evidence linked from [validation](validation.md) document specific candidates and environments. They do not certify a later commit, a new browser/device, a provider account or the current live deployment. Record new evidence with its exact revision and scope.

Update the relevant guide when behavior changes. Link the contract owner rather than copying evolving setup, command, model or data-format lists into multiple guides.
