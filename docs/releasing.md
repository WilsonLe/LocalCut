# Releasing LocalCut

LocalCut uses [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html) for named application releases. The current version is **0.1.0-alpha.1**, an unreleased alpha in initial development. `package.json.version` is the version source; the package remains private and is not published to npm. There is no fixed release schedule or maintained historical patch branch.

## Semantic versioning

The compatibility surface includes the documented `editor.js`/`ai.js` APIs, project/backup import formats and supported editing workflows. Assess the whole candidate against the previous named release and select the highest required bump.

| Release impact                                                           | During initial development (`0.y.z`)                                           | From stable `1.0.0` onward    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ----------------------------- |
| Compatible bug fixes; maintenance or documentation included in a release | PATCH, e.g. `0.1.0` → `0.1.1`                                                  | PATCH, e.g. `1.0.0` → `1.0.1` |
| New compatible functionality                                             | MINOR, e.g. `0.1.1` → `0.2.0`                                                  | MINOR, e.g. `1.0.1` → `1.1.0` |
| Incompatible API, saved-data or supported-workflow change                | MINOR with an explicit breaking-change/recovery notice, e.g. `0.1.1` → `0.2.0` | MAJOR, e.g. `1.1.1` → `2.0.0` |

The `0.y.z` bump rules are LocalCut's initial-development policy; SemVer does not consider that API stable. A MINOR bump resets PATCH to zero, and a MAJOR bump resets MINOR/PATCH to zero. `1.0.0` marks the explicit commitment to a stable compatibility surface, not an automatic milestone after a fixed number of releases. An incompatible data change still needs an authorized, tested transition; a version bump cannot justify losing local projects.

### Alpha, beta and release candidates

While preparing the same target version, increment the prerelease counter: `0.1.0-alpha.1` → `0.1.0-alpha.2`. When ready for broader evaluation or final verification, move to `0.1.0-beta.1`, then `0.1.0-rc.1`, and finally `0.1.0` when approved for a final release. Each new build published as a named prerelease needs its own version; do not replace the contents of an already published `alpha.1`. Readiness determines promotion; a counter does not prove stability. The final `0.1.0` is still initial development, not the stable `1.0.0` API commitment.

If release scope changes the target core version, choose that version under the table above and start its own prerelease sequence, for example `0.2.0-alpha.1`. Preview versions have lower SemVer precedence than their final version. Named releases/prereleases use immutable `v`-prefixed Git tags matching the manifest, such as `v0.1.0-alpha.1`. Never move or reuse a published version/tag to replace its contents.

There are currently no release tags. [The changelog](../CHANGELOG.md) identifies `0.1.0-alpha.1` as an unreleased alpha candidate, not a retroactively published release. Main's automatic Pages deploys can include untagged development revisions: always report the exact commit and do not call them a newly published SemVer release merely because deployment succeeded.

## Short changelog, full Git diff

Group [CHANGELOG.md](../CHANGELOG.md) by SemVer version, newest first, with an Unreleased section for work not yet assigned a candidate version. A versioned candidate uses its full version and an explicit Unreleased alpha/beta/rc status. For each published release use `vX.Y.Z[-prerelease] — YYYY-MM-DD` and two to five brief bullets explaining user/business outcomes in plain language. Omit empty categories, commit-by-commit lists, internal filenames and validation transcripts. State required user action or compatibility risk plainly when present.

End each entry with **Full changelog — Git diff** linking the previous release to this release using [GitHub compare](https://docs.github.com/en/pull-requests/how-tos/commit-changes/comparing-commits). For example, the next alpha after `v0.1.0-alpha.1` links to `https://github.com/WilsonLe/LocalCut/compare/v0.1.0-alpha.1..v0.1.0-alpha.2`; replace these example refs with actual published tags, or immutable commit SHAs if a baseline is untagged. For the first baseline, identify the repository-initialization commit as the start. Do not invent nonexistent tags or release dates.

Pending changes can link to their PR's Files changed view while unmerged. When combining multiple PRs, link a comparison covering the entire candidate from the preceding release/baseline, not one representative PR. Verify that every diff link resolves to the intended base/head before publishing. Pending branch links must be replaced with immutable published tags/commit SHAs at release. GitHub can truncate large comparisons; `git diff <previous-ref> <release-ref>` in a local clone provides the complete repository diff when the hosted view is limited.

Keep detailed checks, exact revisions, reviewer identity, provider/browser limits and deployment evidence in the linked PR/release record. They remain required; the public changelog is the short outcome summary.

## Prepare a candidate

1. Resolve the tracking issues and draft PRs, the current `main` base, the candidate head and the final diff. Choose the SemVer bump from the whole release scope, update `package.json.version` in the release PR and keep the lockfile consistent if that operation changes it. Confirm that scope, notices and affected documentation describe the resulting behavior. This adoption PR corrects the current manifest to the explicitly selected `0.1.0-alpha.1`; it does not publish a release.
2. Complete the local checks required for the change. Documentation-only changes use formatting/link/command checks; runtime/configuration/dependency changes use `pnpm check` and applicable real transcription/performance/native-browser gates from [validation](validation.md). Live-provider acceptance is separately authorized. Record the exact revision, commands, results, environment and gaps.
3. Complete the single independent review-and-address cycle and record reviewed versus resulting heads. Accepted fixes need affected revalidation; no automatic second review.
4. Confirm maintainer merge authorization, repository rules and release prerequisites. The Pages workflow automatically deploys pushes to `main`; a merge is therefore deployment-triggering. Check the actual workflow, Pages publishing source and output/base path before merging.
5. Merge the approved candidate and record the merge commit. Close only fully delivered issues, and fast-forward the clean canonical checkout without discarding unrelated work.

Do not interpret local checks, a draft PR, review approval or an earlier release's results as proof of merge/live availability. See [maintainer responsibilities](maintaining.md) for evidence and review handling.

## Deploy and verify

Follow [DEPLOY.md](../DEPLOY.md) for automatic Pages publishing, confirmed manual redeployment, self-hosting and the live acceptance checklist. Record the Pages run/artifact and exact deployed commit, then verify the application and relevant editing flow in a fresh Chrome context using generated media. A successful workflow job alone is not live user-flow evidence.

Keep packaging separate from validation. Once a named release is authorized and its merged target is verified, publish the matching `vX.Y.Z` tag at that exact commit; record the manifest version, tag and commit together. Publish a GitHub Release using the same concise changelog summary and full-diff link when release publication is authorized. Release tags/entries, custom-host uploads and npm artifacts are separate publishing actions; this guide does not introduce an automatic tagging/npm workflow. A manual Pages redeploy must target reviewed `main` and use its confirmation input.

Draft the next version summary in the release PR, keeping its status visibly pending. Once verified and authorized for publication, finalize the dated SemVer entry and its actual base/head diff link. Include that finalized changelog in the immutable release commit before tagging; if finalization needs another commit, validate/deploy that commit before publishing its tag. Never edit a tagged release to append its own notes. Keep later pending work under Unreleased.

## Detailed release evidence

In the linked PR/release evidence record, include:

- The exact commit and release/deployment URL, with the verified date.
- User-visible additions/fixes and their linked issues/PRs.
- Browser/OS and provider limits, external verification gaps and known regressions.
- Saved-project/API compatibility, backup/recovery steps and required user actions.
- Local author checks, independent reviewed head, resulting head, and live verification results as separate evidence.
- Attribution for contributors and any new third-party assets.

Do not advertise full offline support, universal mobile/codec parity, cloud sync or live provider acceptance unless the implemented behavior and current evidence establish it.

## Recovery

Prefer a compatible forward fix. Before a static rollback, verify the earlier reader supports current project/backup/receipt/font formats and preserve compatible backups/originals. Follow [rollback and local data compatibility](../DEPLOY.md#rollback-and-local-data-compatibility); a reverted app cannot repair data by itself.

A rollback/recovery has its own exact target, authorization, local checks and deployed-revision readback. Preserve the incident evidence and explain remaining data or provider limitations; do not erase browser storage to make a release appear healthy.
