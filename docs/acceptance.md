# Local acceptance evidence

## Conversation-led workspace

The workspace on top of OpenRouter integration commit `4c1ef4c6d62023df01e685a4919aff2597aa3dcd` passed `pnpm check`: formatting, lint, four TypeScript scopes, 295 unit tests, both production builds, bundle budgets, and 33 production-browser tests in installed Google Chrome 155.0.8059.40. These are local checks; hosted checks and deployment are separate.

Browser coverage includes inert startup, both hosting paths, local image/audio/video import, real preview/playback/seek, properties and history, reload/reopen, actual MP4/WebM download and decoding, cancellation, and responsive layouts down to 320 px. Controlled OpenRouter responses verify explicit sharing, reviewed proposal application, stale-proposal rejection, cancelled streaming, retry, and both OAuth callback paths. No paid provider inference or interactive account consent was exercised.

The final root build measured 152,331 bytes initial JavaScript, 9,736 bytes initial CSS, and 540,116 bytes aggregate JavaScript/CSS (all gzip). The `/LocalCut/` build measured 152,336, 9,736, and 540,128 bytes respectively. The initial JavaScript budget is 153,600 bytes, so additions need careful measurement. No model weights or large inference runtime binaries are deployed.

Real Whisper preparation/inference and a fresh-worker cached replay with remote hosts blocked passed. The repeated-source five-minute 1080p30 MP4 workload completed in 34.13 seconds after warmup; the two-minute workload took 14.06 seconds. The steady total browser/worker RSS difference was 71.4 MiB, below the 128 MiB gate. Both outputs reopened at the expected durations and a preview seek completed during export. Raw measurements are retained in [workspace-performance-evidence.json](workspace-performance-evidence.json); this generated workload does not prove performance for every source or effect combination.

## Earlier headless foundation

The following foundation measurements describe the earlier headless release. Current workspace delivery is tracked in issue #16 and its linked PR.

Validated in installed Google Chrome 155.0.8059.40 on macOS arm64, Node 24.21.0 and pnpm 11.25.0. These are local checks; hosted CI and deployed behavior need separate readback.

- pnpm check passed formatting, lint, four strict TypeScript scopes, 128 unit tests, both production builds, artifact budgets, and 16 Chrome integration tests.
- Real quantized Whisper inference passed against the attributed speech fixture and a 33-second repeated fixture crossing a window boundary. Active inference cancellation saved no transcript; a fresh worker performed automatic language detection with exact source bounds and backup linkage. Reloaded inference used a fresh worker with remote hosts blocked. Preparation/readiness verified pinned model and WASM checksums.
- Both MP4/H.264/AAC and WebM/VP9/Opus exports reopened and decoded in Chrome. Tests checked scheduled duration, color frames, audio pitch/onset, transitions, effects, and burned captions.
- Root and /LocalCut/ shells remained empty and inert; engine imports, media workers, inference workers, and dynamic chunks resolved at both hosting bases.
- Initial JavaScript: 67,822 bytes gzip. Initial CSS: 3,339 bytes gzip. Aggregate JS/CSS: 436,113 bytes gzip. No model weights, large runtime binaries, downloaded fonts, fixtures, or test harnesses shipped.
- Five-minute 1080p30 MP4 export used 600 sequential video/text clips, repeating an actual H.264/AAC source with animated gradient and stereo tones. It completed in about 34.1 seconds after warmup; the two-minute workload completed in about 14.1 seconds. Both reopened at their scheduled durations, and preview seeking stayed below the five-second gate during export.
- Steady browser/worker RSS in an isolated disk-backed Chrome profile: 1296.6 MiB for two minutes and 1371.0 MiB for five minutes, a 74.4 MiB difference under the unchanged 128 MiB gate. Per-clip sequential cursors release ended decoded samples and avoid restarting the decoder on every frame. This bounded generated workload does not establish performance for every source/container/effect combination. Raw measurements, per-process RSS, the incognito-versus-disk storage probe, and machine details are in [performance-evidence.json](performance-evidence.json).

Tests also cover atomic rollback, request conflicts/replays, 100-step history, revisions after reload, two-tab conflicts, split continuity including gain fades, source bounds, subtitle round trips/retiming, anti-alias resampling, waveform/proxy/contact sheets, import recovery, missing media, preserved foreign storage, job cancellation/terminal ordering, and worker crash recovery.

Completion regressions cover legacy import reference validation, partial updates without default resets, stable nested identities, delayed preview audio, empty-MIME image imports, visual transitions, independently calculated stereo output, exact source transcript bounds, pure-core import boundaries, and cancellation on both sides of publication. The performance harness uses a temporary disk-backed profile because default incognito OPFS retains output file bytes in RAM; the write-only probe reproduced that storage cost without decoding or encoding.

Upgrade regressions seed actual base-release receipts and project/history records into production Chrome. They verify exact old request replay despite changed defaults/ID generation, conflict rejection for changed fields, persistent raw fingerprints for new receipts, and atomic two-tab migration without revision changes. Original caption cue ownership survives reordered undo/redo and backup round trips. Unmarked legacy import repair is explicit; marked invalid backups and cross-kind collisions remain rejected.

GitHub Pages is configured for the manual Actions workflow; the release issue records dispatch and live verification separately. That foundation release had no product UI. The subsequent approved workspace adds controls without an automatic editor instance, router, or browser Pilot panel.

The independent review findings and author corrections are documented in [review.md](review.md). Additional regressions verify fresh-namespace backup restoration and source-caption pixels, remapped missing-asset metadata, interrupted and concurrent relinking, cancellation while waiting on an asset lock, playback failure reporting and successful play/pause/seek, height changes, checksum tampering, bounded quota retry, and original/active-reader preservation.
