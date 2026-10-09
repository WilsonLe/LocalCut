# Transcription and privacy

The dedicated worker uses Transformers.js 4.3.1, Xenova/whisper-tiny at revision 5332fcc35e32a33b86612b9a57a89be7906102b1, q8 weights, and single-thread WASM. The matching runtime is onnxruntime-web 1.31.0-dev.20260914-8d85527a0 from its version-pinned jsDelivr dist path.

Call transcription.prepare().completion explicitly. Nothing downloads at page load, editor opening, or when a missing-model transcription request is rejected. Preparation reports download, initialization/verification, and completion. Downloads are read-only HTTPS requests with omitted credentials. Media and decoded PCM stay in the browser.

Transformers.js's browser and WASM caches share the named LocalCut cache. Internal tokenizer metadata requests to main are redirected to the pinned revision. Weight checksums are verified before readiness. Runtime blobs are loaded from the named cache after reload; no multithread isolation headers are needed. Weights and large WASM binaries are absent from dist.

Preparation needs roughly 41 MB of model weights, 27 MB of runtime, and configuration/tokenizer files. Progress totals can vary with cache hits. Keep app hosting available for cached inference; full offline navigation is deferred.

Transcribe requires an imported audio-capable asset and optional language/startUs/endUs. Audio becomes mono 16 kHz with anti-alias resampling. Whisper transcribes the source language with 30-second windows and 5-second overlap, returning segment timestamps. Successful transcripts alone are persisted, with source asset ID and model/revision provenance. A clip's transcriptId links these source cues through trim, speed, and timeline placement.

Cancellation terminates the inference worker. A later request opens a fresh worker. clearModelCache preserves committed transcripts, media, and edits.

The engine never posts audio/media to remote services. Allowed app network traffic consists of static assets and explicitly prepared model/runtime downloads. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for model/library and speech-fixture attribution.
