# Transcription and privacy

The dedicated worker uses Transformers.js 4.3.1, Xenova/whisper-tiny at revision 5332fcc35e32a33b86612b9a57a89be7906102b1, q8 weights, and single-thread WASM. The matching runtime is onnxruntime-web 1.31.0-dev.20260914-8d85527a0 from its version-pinned jsDelivr dist path.

Call transcription.prepare().completion explicitly. Nothing downloads at page load, editor opening, or when a missing-model transcription request is rejected. Preparation reports download, initialization/verification, and completion. Downloads are read-only HTTPS requests with omitted credentials. Media and decoded PCM stay in the browser.

Transformers.js's browser and WASM caches share the named LocalCut cache. Internal tokenizer metadata requests to main are redirected to the pinned revision. Weight checksums are verified before readiness. Runtime blobs are loaded from the named cache after reload; no multithread isolation headers are needed. Weights and large WASM binaries are absent from dist.

Preparation needs roughly 41 MB of model weights, 27 MB of runtime, and configuration/tokenizer files. Progress totals can vary with cache hits. Keep app hosting available for cached inference; full offline navigation is deferred.

Transcribe requires an imported audio-capable asset and optional language/startUs/endUs. The selected source interval is half-open and must satisfy integer microseconds 0 ≤ startUs < endUs ≤ asset duration; defaults are zero and the asset duration. Audio becomes mono 16 kHz with anti-alias resampling. Whisper transcribes the source language with 30-second windows and 5-second overlap, returning segment timestamps. These timestamps are rounded to microseconds, offset into source time, and clamped to the exact requested bounds. A missing segment end uses the requested end; missing or non-finite starts and empty intervals are discarded. Final-sample padding cannot extend a saved cue past endUs.

Successful transcripts alone are persisted, with source asset ID and model/revision provenance. Storage rejects unordered or out-of-source cues and duplicate cue IDs. A clip's transcriptId links these source cues through trim, speed, and timeline placement.

Cancellation during active inference terminates its worker; a later request opens a fresh worker. Cancellation while transcript persistence is pending aborts the transaction. If the transaction already committed, the job returns that successful transcript despite a late cancellation rather than hiding saved data behind a CANCELLED result. clearModelCache preserves committed transcripts, media, and edits.

The engine never posts audio/media to remote services. Local transcription network traffic consists of static assets and explicitly prepared model/runtime downloads. The separate, optional [OpenRouter integration](ai.md) sends user-requested text and selected project metadata; transcript sharing requires an explicit context option. It never sends source files or decoded audio. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for model/library and speech-fixture attribution.
