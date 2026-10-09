# Local acceptance evidence

Validated in installed Google Chrome 155.0.8059.40 on macOS arm64, Node 24.21.0 and pnpm 11.25.0. These are local checks; hosted CI and deployed behavior need separate readback.

- pnpm check passed formatting, lint, four strict TypeScript scopes, 32 unit tests, both production builds, artifact budgets, and nine Chrome integration tests.
- Real quantized Whisper inference passed against the attributed speech fixture and a 33-second repeated fixture crossing a window boundary. Reloaded inference used a fresh worker with remote hosts blocked. Preparation/readiness verified pinned model and WASM checksums.
- Both MP4/H.264/AAC and WebM/VP9/Opus exports reopened and decoded in Chrome. Tests checked scheduled duration, color frames, audio pitch/onset, transitions, effects, and burned captions.
- Root and /LocalCut/ shells remained empty and inert; engine imports, media workers, inference workers, and dynamic chunks resolved at both hosting bases.
- Initial JavaScript: 67,822 bytes gzip. Initial CSS: 3,330 bytes gzip. Aggregate JS/CSS: 431,884 bytes gzip. No model weights, large runtime binaries, downloaded fonts, fixtures, or test harnesses shipped.
- Five-minute 1080p30 MP4 export used 600 sequential image/text clips and completed in about 34.2 seconds after warmup. The two-minute workload completed in about 14.1 seconds. Both reopened at their scheduled durations, and preview seeking stayed below the five-second gate during export.
- Steady browser/worker RSS: 1148.3 MiB for two minutes and 1194.2 MiB for five minutes, a 45.9 MiB difference under the 128 MiB gate. The compositor releases ended clip surfaces and decoded sources; this bounded generated workload does not establish performance for every source/container/effect combination. Raw measurements and machine details are in [performance-evidence.json](performance-evidence.json).

Tests also cover atomic rollback, request conflicts/replays, 100-step history, revisions after reload, two-tab conflicts, split continuity including gain fades, source bounds, subtitle round trips/retiming, anti-alias resampling, waveform/proxy/contact sheets, import recovery, missing media, preserved foreign storage, job cancellation/terminal ordering, and worker crash recovery.

The manual Pages workflow is configured but has not been enabled or dispatched. The production page has no product UI, mockups, router, Pilot panel, or automatic editor instance.

The independent review findings and author corrections are documented in [review.md](review.md). Additional regressions verify fresh-namespace backup restoration and source-caption pixels, remapped missing-asset metadata, interrupted and concurrent relinking, cancellation while waiting on an asset lock, playback failure reporting and successful play/pause/seek, height changes, checksum tampering, bounded quota retry, and original/active-reader preservation.
