# LocalCut contributor contract

- The production page remains blank: App renders null. Do not add editor layouts, controls, timeline widgets, mockups, a router, a theme provider, sample components, or a browser Pilot panel without a new design request.
- Import the stylesheet and bootstrap React only. Page load must not start workers, initialize storage, fetch models, request permissions, or instantiate the editor.
- All future controls and agent transports must invoke the shared engine API. Keep one canonical project document and explicit revision/request contracts.
- Keep src/core pure TypeScript: no React, browser storage, media libraries, services, workers, or network operations.
- Keep media and inference local. Model/runtime downloads require explicit preparation. No user-media uploads, embedded secrets, or hosted processing services.
- Preserve microsecond integers, rational frame rates, half-open ranges, idempotent receipts, atomic history/document commits, and client-side capability preflight.
- Dispose native resources and workers. Use app-owned storage namespaces; do not clear origin-wide databases, files, or caches.
- Use pinned dependencies and the committed lockfile. Model revision, quantization, runtime CDN, and artifact hashes are contracts.
- Run pnpm check and relevant real Chrome acceptance gates. A mocked inference or Chromium-only pass does not satisfy transcription/codec acceptance. Record missing evidence as a failure, never a passing skip.
- Use an isolated feature worktree, issue-linked draft PR, and independent review. Merge and Pages deployment require separate authorization.
