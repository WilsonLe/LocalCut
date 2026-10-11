# Project governance

LocalCut currently uses a maintainer-led process. The repository owner, [WilsonLe](https://github.com/WilsonLe), has final responsibility for project direction, repository settings and merge/release decisions. This document does not appoint additional maintainers or promise a formal voting process.

## Decisions and scope

Use a public issue to describe a proposal, its users, acceptance criteria and effects on privacy, storage, accessibility, performance and browser support. Maintainers select a focused scope and the existing behavior owner before implementation. Record durable choices in the relevant contract and [user preferences](user-preferences.md); issues/PRs record the reasoning and evidence for the specific change.

Local media processing, explicit remote-service consent, inspectable shared engine edits, saved-data compatibility and real native-browser validation are core project boundaries. The [roadmap](roadmap.md) describes priorities. A prototype, issue comment or passing check does not establish product approval, merge authority or a delivered feature.

For disagreements, give a concrete reproduction or user scenario, identify the contract at issue and propose alternatives. Keep technical criticism respectful. Maintainers decide whether to revise the scope, defer the proposal or close it with an explanation. Use the [Code of Conduct](../CODE_OF_CONDUCT.md) for conduct concerns.

## Responsibilities

Contributors own the correctness, provenance and focused validation of submitted work, keep issues/PRs linked and address actionable review findings. Reviewers examine the frozen candidate against the request and contracts, record exact base/head revisions and distinguish observed facts from missing evidence.

Maintainers own triage, review coordination, merge authorization, local release gates, live release verification and the documentation needed to operate the project. They should explain rejected/deferred proposals, preserve attribution and avoid promises they cannot maintain. See the [maintainer guide](maintaining.md).

Commit access does not grant automatic authority to merge every branch or deploy arbitrary targets. A reviewed draft PR remains a candidate until a maintainer authorizes merge. Pushing/merging to `main` triggers the configured Pages release, so the release implications must be known before acting.

## Becoming a maintainer

Sustained, well-reviewed contributions, helpful triage, careful handling of privacy/data integrity and reliable review/validation are evidence for a maintainer invitation. The owner decides and documents any invitation, responsibilities and access. No number of contributions automatically grants access. Prefer the smallest repository permissions needed, and review access when responsibilities change.

## Project status

LocalCut is at `0.1.0-alpha.1`, an unreleased alpha in initial development, following the [SemVer release policy](releasing.md#semantic-versioning), with no published npm package or long-term support branch. Named versions, immutable tags and exact deployed revisions are recorded separately. API/storage changes must be documented and preserve compatibility or include an explicit tested transition; users must not discover data incompatibility through an unsafe rollback.
