# Releasing LocalCut

LocalCut releases a static application from `main`. The manifest version (`0.1.0` today) is not a deployed-revision identifier and the package is not published to npm. There is no fixed release schedule or maintained historical patch branch.

## Prepare a candidate

1. Resolve the tracking issues and draft PRs, the current `main` base, the candidate head and the final diff. Confirm that scope, notices and affected documentation describe the resulting behavior.
2. Complete the local checks required for the change. Documentation-only changes use formatting/link/command checks; runtime/configuration/dependency changes use `pnpm check` and applicable real transcription/performance/native-browser gates from [validation](validation.md). Live-provider acceptance is separately authorized. Record the exact revision, commands, results, environment and gaps.
3. Complete the single independent review-and-address cycle and record reviewed versus resulting heads. Accepted fixes need affected revalidation; no automatic second review.
4. Confirm maintainer merge authorization, repository rules and release prerequisites. The Pages workflow automatically deploys pushes to `main`; a merge is therefore deployment-triggering. Check the actual workflow, Pages publishing source and output/base path before merging.
5. Merge the approved candidate and record the merge commit. Close only fully delivered issues, and fast-forward the clean canonical checkout without discarding unrelated work.

Do not interpret local checks, a draft PR, review approval or an earlier release's results as proof of merge/live availability. See [maintainer responsibilities](maintaining.md) for evidence and review handling.

## Deploy and verify

Follow [DEPLOY.md](../DEPLOY.md) for automatic Pages publishing, confirmed manual redeployment, self-hosting and the live acceptance checklist. Record the Pages run/artifact and exact deployed commit, then verify the application and relevant editing flow in a fresh Chrome context using generated media. A successful workflow job alone is not live user-flow evidence.

Keep packaging separate from validation. Publishing release tags, GitHub Release entries, custom-host uploads or npm artifacts are separate actions; this guide does not introduce an automatic tagging/npm workflow. A manual Pages redeploy must target reviewed `main` and use its confirmation input.

Update [CHANGELOG.md](../CHANGELOG.md) with notable user-facing changes. Keep pending entries under Unreleased; move them into a dated revision/release entry only after the corresponding release is verified.

## Release note contents

If publishing a release entry or summary, include:

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
