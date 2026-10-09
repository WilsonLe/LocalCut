# CI and release workflows

- Keep required checks aligned with [validation](../../docs/validation.md): quality, unit tests, both production builds/budgets, stable desktop Chrome integration, and real transcription/cached replay.
- Browser jobs consume the exact build artifact from the build job. Preserve hidden manifests and signed Chrome provisioning; do not substitute a browser channel or turn missing capability evidence into a skip.
- Cache only verified dependency/model assets by their pinned versions and checksums. Do not cache user media or browser storage between jobs; retain failure traces/reports.
- Keep the Pages workflow manually dispatched, restricted to `main`, and guarded by its explicit confirmation input. Merge and deployment are separate approvals; follow [DEPLOY.md](../../DEPLOY.md).
- Keep the long performance workload manual and serial. Do not remove short real export coverage from normal checks to reduce CI time.

For workflow edits, inspect trigger, permission, artifact and command changes against `package.json` and the referenced scripts; run the affected local checks before pushing. Read back the resulting hosted jobs on the exact head. Workflow configuration alone does not prove a successful deployment.
