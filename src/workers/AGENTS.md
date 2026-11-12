# Worker execution

- `media.worker.ts` dispatches imports, derivatives, composition, audio windows, deterministic indexing, and exports. No speech inference worker is shipped.
- Keep request IDs and the `progress`/`result`/`error` protocol aligned with [WorkerClient](../services/worker-client.ts). Return structured `EditorError` codes.
- Media work is queued per worker; keep interactive and background instances independent. Check cancellation around async boundaries and release temporary stores, renderers, files, and undelivered bitmaps.
- An import's successful atomic commit is its publication point. Export/frame cancellation before delivery still removes or closes the result; preserve the [storage contract](../../docs/storage.md).
- Build worker URLs through Vite's module-worker mechanism in the facade; do not hard-code deployed asset paths or move worker startup into module imports.
- Focused checks: `pnpm test tests/unit/worker-publication.test.ts tests/unit/services.test.ts tests/unit/publication.test.ts` and `pnpm typecheck` (includes worker scope).
- Protocol/media changes also need current-build Chrome coverage; speech data changes need saved-transcript/asset-clip compatibility checks. Use the [validation guide](../../docs/validation.md) for preparation and evidence.
