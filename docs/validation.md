# Validation

Normal CI separates formatting/lint/type checking, unit tests, production builds/artifact budgets, Chrome integration, and real transcription/cached replay. Native codec support is required; missing AAC/H.264/VP9/Opus fails the gate. Browser tests use installed stable Google Chrome, never a generic Chromium-only substitute. CI passes the stable installer output through LOCALCUT_CHROME_EXECUTABLE; local runs use the installed Chrome channel.

Tests serve the real production outputs at / and /LocalCut/. All test UI/surfaces are created by page evaluation and absent from product assets. Generated PNG/WAV fixtures exercise known colors, transforms, timing, tone frequency, and waveform behavior. The attributed JFK speech fixture checks actual local inference.

Domain tests cover validation, atomic pure rollback, editing operations, split keyframes, rational timing, subtitles, fades, source caption mapping, and anti-alias resampling. Chrome integration checks storage commits/receipts/history, two-tab conflicts, both real export formats reopened and decoded, compositor transitions over lower tracks, waveform/proxy/contact sheets, audio speed and onset, recovery, missing media, cancellation, inert shell, and owned storage.

Transcription acceptance prepares the real model, checks the expected phrase and ordered segment timestamps, disposes/reloads, blocks every remote host, and invokes a fresh inference worker against persisted caches. Cache clearing must retain the transcript. Read-only remote download methods are checked.

The manual performance gate warms up, exports two and five minutes at 1080p30, reopens media, checks duration and interactive seeking during export, and measures browser/worker native RSS via CDP process IDs and ps. The steady-state five-minute RSS delta must stay below 128 MiB versus two minutes; processing must not retain full-project frames/audio. Attach raw measurements and hardware/browser versions when publishing evidence. This test is a bounded generated workload, not a claim about arbitrary media complexity.

Artifact gates walk the actual application manifest import graph: initial JS ≤150 KiB gzip; CSS ≤30 KiB; all JS/CSS ≤5 MiB. They reject model weights, WASM binaries, downloaded fonts, or fixtures/harnesses in deployed output and reject an eager engine/worker import.

Acceptance evidence must bind to the final committed candidate. Run pnpm check, pnpm test:transcription, and pnpm test:performance locally before handoff. Traces/reports are captured on failure. Hosted CI and deployment require separate live readback; local success is not proof of either.
