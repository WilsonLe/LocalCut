---
name: localcut-captions
description: Transcribe local project audio with explicit Whisper preparation and create or revise accurately timed LocalCut captions without inventing speech.
license: MIT
metadata:
  author: LocalCut
  source: Agentic Workflows 0.2.0+codex.20261018000000
---

# Local transcription and captions

Attached `asset.notes.transcript` is editable reference text visible in the Media asset menu. Read it when useful, but distinguish user-supplied or corrected text from canonical timed transcripts. Use `localcut-asset-context` for plain notes; changing those notes does not change timed captions.

Inspect the project and source audio asset ID, duration and language. Use `localcut_transcription` with `action: "status"` to inspect readiness. Prepare the local model only for explicitly requested transcription/model preparation; preparation downloads model/runtime assets. Bare startup or reading skills must not start it. LocalCut has local Whisper, not a cloud transcription provider.

Read the current transcription schema. Prepare and transcribe return jobs; use `localcut_job` to wait, inspect or cancel, then read the returned transcript ID. Select the actual source range with integer-microsecond endpoints. Preserve the original asset identity and language. Do not invent a transcript when the source/model is unavailable, and do not infer word timestamps, confidence, diarization or speaker identities unless the result supplies them.

Keep source transcript timing distinct from final timeline timing. A linked media transcript follows trims, speed and placement through LocalCut's source-to-timeline mapping. Authored caption clips/cues follow their canonical local timing. Inspect the schemas and existing document before choosing either representation; do not manually shift source cues twice. If the cut changes, recheck caption sync and coverage at those boundaries.

Review uncertain names, numbers, language switches, silence and overlapping voices against audio when possible. Preserve recognized original-language text unless translation is requested; keep translation separate from original wording. Do not turn uncertain recognition into a factual quote. A lexical correction does not prove timing accuracy.

Use `localcut_apply_edits` for editable caption cues/styles, with the current revision and unique request ID. Preserve unrelated cue/style values and unique identities. Use real bundled font IDs from `localcut_catalog`; inspect wrapping, contrast, safe placement and readable holds at delivery size. Caption text must match the delivered cut rather than include removed speech.

Review rendered caption frames, transition boundaries and playback sync, then inspect the exported candidate. An STT job alone does not certify speech accuracy. Report the source/ranges, language, model status, corrections and listening coverage. Keep media local; a missing local capability does not authorize uploading audio to a provider.

Adapted for LocalCut from Agentic Workflows (speech-to-text; typography). Copyright (c) 2026 Wilson Le. Distributed under the [MIT License](LICENSE.txt). All required workflow guidance is contained in this file.
