# Native Safari regressions

- Use the installed Safari through `/usr/bin/safaridriver`, not Playwright WebKit. Run `pnpm test:safari` on macOS after enabling Safari Remote Automation once.
- Keep this focused suite serial: Safari permits one automation session on the host. Never close another session or enable settings automatically.
- Import production entries at both static base paths. Fail when required storage or H.264/AAC capabilities are unavailable.
- Use generated fixtures, isolated `test-safari-*` namespaces, and dispose engines, frames, artifacts and AudioContexts. Delete only that namespace on failure as well as success.
- Retain Safari version, measured codec/audio/pixel results and failure screenshots in ignored `test-results/safari/`. This coverage complements the complete Chrome gates; it does not claim WebM or inference parity.
