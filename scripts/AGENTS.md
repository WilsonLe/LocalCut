# Build and development tooling

- These scripts run as Node 24 ESM from the repository root. Reuse `build-state.mjs` for process/build handling; preserve the public package commands documented in [README](../README.md#setup).
- Build both `/LocalCut/` and `/` outputs with stable engine entry names, declarations and a manifest. Keep fixtures, harnesses, weights and inference binaries out of deployed output.
- `test-ui.mjs` may reuse output only after checking all production inputs, relevant environment and every output file. Changes to build semantics need matching cache invalidation; a stamp is evidence of content identity, not permission to skip an unrelated gate.
- The test server stays loopback-only. Preserve safe path resolution, base-path routing and test-only fixtures; do not turn it into a production dependency.
- Chrome provisioning preserves and verifies the signed desktop app and native helpers. A generic Chromium download is not interchangeable with native codec acceptance.
- Keep pinned transcription downloads checksum-verified and separate from user data. Never print credentials or cache user media.

For build/cache changes, run `pnpm build`, `pnpm build:root` and `pnpm check:bundle`, then the affected production browser scenario. Validate cache reuse and invalidation when touching fingerprints. Serialize writes to `dist`/`dist-root` with browser runs; see [development](../docs/development.md) and [validation](../docs/validation.md).
