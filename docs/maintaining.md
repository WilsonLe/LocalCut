# Maintainer guide

Use this guide alongside [governance](governance.md), [contributing](../CONTRIBUTING.md), [releasing](releasing.md) and [deployment](../DEPLOY.md). It describes responsibilities and repository-readiness checks; it does not claim repository settings have been changed.

## Triage

Check duplicates, scope and reproduction. Ask for the smallest missing detail: affected revision/URL, browser/OS, exact steps and safely shareable media. Preserve user data and keep secrets/private attachments out of public threads. Redirect suspected vulnerabilities to [SECURITY.md](../SECURITY.md).

Confirm whether the report concerns the current implementation, a historical revision, a provider account or a live deployment. For accepted work, keep one tracking issue with explicit outcome/acceptance, dependencies and exclusions. Mark beginner-friendly work only after confirming its scope and prerequisites. If a proposal is deferred or declined, explain why; do not leave a roadmap promise in its place.

Do not require paid-provider credentials for ordinary contributions. Live-provider evidence is an explicit separate boundary. A deterministic provider interception is useful transport evidence, not account/billing acceptance.

## Review and merge

Read the request, every linked issue, all ancestor/module instructions, changed contracts and full diff. Require linked issue/PR references in both directions, exact tested head, local check results and honest limitations. Keep runtime, dependency, generated asset and documentation changes coherent.

Run one independent draft-PR review-and-address cycle on a frozen candidate. Record reviewed base/head, reviewer, findings, disposition, resulting head and affected revalidation. Author self-review is not independent review, and a post-fix head is not independently reviewed solely because its predecessor was. Do not automatically repeat the cycle.

For documentation-only changes verify formatting, links/anchors and new commands. For code/configuration/dependencies follow the [development integration gate](development.md#expand-verification-at-the-boundary) and [validation](validation.md). Preserve real native codec/inference evidence; do not relax gates to hide an environment failure.

Merge only with authorization after required local checks and current-candidate review evidence are ready. Squash is the ordinary default. Keep remote CI disabled; the Pages workflow packages/releases the app after local validation. Merging `main` triggers deployment. Use [releasing](releasing.md) for release identity and live verification, and close fully delivered issues only after their acceptance PRs merge.

## Security and community readiness

Private vulnerability reporting is currently disabled and no dedicated confidential conduct/security contact is published. The fallback in [SECURITY.md](../SECURITY.md) and [Code of Conduct](../CODE_OF_CONDUCT.md) is intentionally explicit. The owner should establish a monitored private channel and, if chosen, enable GitHub private vulnerability reporting; update both policies after verifying it works. These are repository/contact administration steps, not changes made by this documentation PR.

Review branch protection/rulesets and write access with the owner. Protect `main` against accidental direct changes while allowing the documented local evidence workflow. Do not require nonexistent hosted checks or enable hosted validation. Confirm GitHub Actions publishing, least-privilege Pages permissions and the release trigger before a deployment-affecting merge.

Review dependency update PRs with lockfile, patches, native browser compatibility and attribution evidence. Avoid automatically merging dependency updates or assuming a security alert implies an exploitable path. Sensitive reports/fixes require a private handling plan and agreed disclosure.

## Documentation and asset hygiene

Keep [the docs index](README.md) useful. Update the owning API/storage/AI/transcription/deployment contract when behavior changes; link it from onboarding rather than copying evolving lists. Verify screenshots against their described state and remove private content before publishing. Dated acceptance/review records remain historical, with exact revisions.

Keep exact dependency/model/runtime revisions and generated font provenance. Review licenses/notices before adding assets, preserve font-family licenses, and follow [font maintenance](development.md#font-catalog-maintenance). Font imports are explicit maintenance operations, never startup/build side effects.

Before publishing downloadable release archives, include the project license and [third-party notices](../THIRD_PARTY_NOTICES.md), bundled notices and fonts. Source-only attribution files outside `dist` need to accompany distribution; the static build does not automatically copy every root document.

## Release notes and follow-through

Use the [SemVer policy](releasing.md#semantic-versioning) to choose the release version and keep the manifest, changelog heading and published tag aligned. Keep the public changelog to two to five short user/executive outcome bullets per version and link the full Git diff. Put browser/provider limits, backup implications, exact commit and validation scope in the linked release evidence; surface essential user actions in the short summary. Verify diff endpoints and compare notes against the final candidate. Do not advertise an unverified outcome or reuse a published tag.

After a merge, fast-forward the clean canonical checkout without discarding unrelated work. Clean only task-owned worktrees, branches and processes when safe; do not prune shared caches or browser data. A release incident needs a verified compatible recovery path, not indiscriminate storage clearing.
