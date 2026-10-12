# Set up LocalCut from source

For editing without a source checkout, [open LocalCut](https://wilsonle.github.io/LocalCut/) and follow the [first-edit guide](getting-started.md).

## Prerequisites

Install Node 24 LTS and check that `node --version` reports `v24.x`. Use the pinned pnpm 11.25.0. Current stable desktop Google Chrome is the native codec, OPFS, Web Locks and production integration acceptance target; see [browser support](browser-support.md).

Local editing requires no runtime environment variables, accounts, backend servers or secrets. Browser storage requires HTTPS or localhost. Optional remote AI uses one explicitly connected OpenRouter account. Read [privacy and data flows](privacy.md) before connecting.

## Clone, install and start

```sh
npm install --global pnpm@11.25.0
git clone https://github.com/WilsonLe/LocalCut.git
cd LocalCut
pnpm install --frozen-lockfile
pnpm dev
```

Open the localhost URL printed by Vite. Contributors using a fork should substitute their fork's clone URL and follow [CONTRIBUTING.md](../CONTRIBUTING.md) to create an isolated feature worktree. Keep dependency versions and the lockfile pinned.

## Next steps

Use the [development command reference](development.md#commands) and [focused check recipes](development.md#one-edit-one-focused-check) for local validation. Coding agents must read [AGENTS.md](../AGENTS.md) and the relevant nested guides before changing files.

Validation runs locally; hosted CI is disabled. GitHub Pages builds and publishes automatically on every push to `main`; release packaging is separate from local validation. Confirmed manual redeployment is also available. See [deployment and rollback](../DEPLOY.md).

For install, storage, codec or provider failures, start with [troubleshooting](troubleshooting.md).
