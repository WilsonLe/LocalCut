# Runtime services

- `jobs.ts` owns job progress, completion, cancellation, and listener isolation; `worker-client.ts` owns request correlation and worker reset/recovery.
- Keep exactly one terminal job event. Suppress progress after cancellation and isolate exceptions thrown by consumer subscriptions.
- Distinguish successful persisted commits from disposable results: use `acceptCommittedResult` only at a real commit boundary and provide `discard` for undelivered native resources.
- A worker crash rejects pending requests and permits a fresh worker on the next call. Close late/unclaimed bitmaps and remove abort listeners on settlement.
- `preview.ts` owns audio-clock scheduling and seek generations. Preserve bounded PCM blocks, hold the timeline on underrun, and prevent superseded seeks from presenting stale frames.
- `transcription-config.ts` owns pinned URLs/hashes; `transcription-status.ts` verifies cached artifacts without downloading. `transcript-cues.ts` clamps source-relative cues to exact requested bounds.
- Read [API lifecycle](../../docs/api.md) and [transcription contracts](../../docs/transcription.md) before changing these behaviors.
- Focused checks: `pnpm test tests/unit/services.test.ts tests/unit/publication.test.ts tests/unit/preview-latency.test.ts tests/unit/worker-publication.test.ts`.
- For worker protocol or preview scheduling changes, also select the corresponding production Chrome scenario using the [test guide](../../docs/development.md).
