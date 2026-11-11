---
name: localcut-captions
description: Transcribe local project audio with explicit Whisper preparation and create or revise accurately timed LocalCut captions without inventing speech.
license: MIT
metadata:
  author: LocalCut
  source: Agentic Workflows 0.2.0+codex.20261018000000
---

# Local transcription and captions

Each `asset.clips` entry has editable transcript text and source bounds. Read the selected clip when useful, but distinguish supplied/corrected words from canonical timed transcripts. Use `localcut-asset-clips` to read, preview or edit source clips. For requested transcription, use its actual source range and attach returned words and their actual source times in `transcriptCues` to that clip without inventing timing or rewriting caption tracks implicitly.

Inspect the project and source audio asset ID, duration and language. Use `localcut_transcription` with `action: "status"` to inspect readiness. Prepare the local model only for explicitly requested transcription/model preparation; preparation downloads model/runtime assets. Bare startup or reading skills must not start it. LocalCut has local Whisper, not a cloud transcription provider.

Read the current transcription schema. Prepare and transcribe return jobs; use `localcut_job` to wait, inspect or cancel, then read the returned transcript ID. Select the actual source range with integer-microsecond endpoints. Preserve the original asset identity and language. Do not invent a transcript when the source/model is unavailable, and do not infer word timestamps, confidence, diarization or speaker identities unless the result supplies them.

Keep source transcript timing distinct from final timeline timing. A linked media transcript follows trims, speed and placement through LocalCut's source-to-timeline mapping. Authored caption clips/cues follow their canonical local timing. Inspect the schemas and existing document before choosing either representation; do not manually shift source cues twice. If the cut changes, recheck caption sync and coverage at those boundaries.

Review uncertain names, numbers, language switches, silence and overlapping voices against audio when possible. Preserve recognized original-language text unless translation is requested; keep translation separate from original wording. Do not turn uncertain recognition into a factual quote. A lexical correction does not prove timing accuracy.

Use `localcut_apply_edits` for editable caption cues/styles, with the current revision and unique request ID. Preserve unrelated cue/style values and unique identities. Use real bundled font IDs from `localcut_catalog`; inspect wrapping, contrast, safe placement and readable holds at delivery size. Caption text must match the delivered cut rather than include removed speech.

Review rendered caption frames, transition boundaries and playback sync, then inspect the exported candidate. An STT job alone does not certify speech accuracy. Report the source/ranges, language, model status, corrections and listening coverage. Keep media local; a missing local capability does not authorize uploading audio to a provider.

Keep visible UI and authored titles/captions focused on the user's content and actions. Do not add storage explanations, implementation notes, workflow narration or filler such as “saved with this asset in your browser.” Include a short explanation only when it changes a concrete user decision or resolves an error. Preserve supplied transcript/content verbatim unless a correction is requested.

Adapted for LocalCut from Agentic Workflows (speech-to-text; typography). Copyright (c) 2026 Wilson Le. Distributed under the [MIT License](LICENSE.txt). All required workflow guidance is contained in this file.
