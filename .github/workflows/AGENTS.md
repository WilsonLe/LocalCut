# Pages release workflow

- Remote CI is disabled by explicit user preference. Do not restore hosted tests, quality checks, performance workflows or validation push/PR triggers. Run those gates locally using [validation](../../docs/validation.md).
- Deploy Pages automatically on every push to `main`, as explicitly requested by the user. Retain manual dispatch restricted to `main` with its confirmation input. Do not deploy PRs or feature branches; follow [DEPLOY.md](../../DEPLOY.md).
- The Pages workflow packages and publishes the static site after local validation. Do not add test or benchmark jobs to that release workflow.
- Keep deployment permissions minimal, publish only `dist`, and exclude test fixtures, model weights, caches and user media.

For workflow edits, inspect trigger, permissions, artifact and package commands locally. After an authorized deployment, read back its exact revision and verify the live site. Workflow configuration alone does not prove deployment succeeded.
