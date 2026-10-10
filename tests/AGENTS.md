# Test ownership and selection

- Run commands from the repository root. Start with the changed owner's smallest meaningful regression; use [development](../docs/development.md) for the final verification boundary.
- `unit/` exercises pure logic and controlled service races; `browser/` exercises production entries in stable Chrome; `safari/` adds focused native Safari storage/MP4 regressions; `tooling/` covers allocation, scheduling and build identity; `live/` is separately authorized paid-provider acceptance.
- Give tests isolated browser contexts and app-owned namespaces. Reuse a namespace only inside an explicit reload/concurrency scenario; never clear unrelated origin storage.
- Dispose sessions, engines, artifacts, listeners, and native resources even on failure. Coordinate ports, reports, and production output directories across concurrent runs.
- Keep fixtures synthetic with known expected colors, times, and audio, except the attributed speech fixture. Preserve [fixture attribution](../THIRD_PARTY_NOTICES.md) and recorded checksums when updating it.
- Use deterministic barriers/fake clocks for race tests where possible. Assert observable contracts, including failure and cleanup, instead of merely mirroring implementation calls.
- Do not run builds while browser tests consume `dist`/`dist-root`. A unique `LOCALCUT_TEST_PORT` isolates the server, not shared files or reports.
- `pnpm test <unit-file>` selects unit tests. `pnpm test:ui --grep '<title>'` checks/reuses production builds for workspace tests. Direct browser commands require current builds.
- Verify a browser selector cheaply with `pnpm test:browser <spec-file> --list` before an expensive run.
- Keep normal, real-transcription, performance, and live-provider evidence distinct; see [validation](../docs/validation.md). Missing required capability evidence is a failure, not a passing skip.
