# Agent-provided speech and captions

LocalCut has no bundled Whisper model, inference worker, model/runtime downloads, speech-to-text (STT) engine or text-to-speech (TTS) service. The external agent supplies speech capabilities. Use the published [captions skill](../public/skills/localcut-captions/SKILL.md) for STT and [narration skill](../public/skills/localcut-narration/SKILL.md) for TTS.

For requested transcription, the agent obtains the authorized source file through its host or a source-clip preview/download, runs its available STT tool, and retains the raw result, language, source identity/range and tool/model provenance. Browser-local blob URLs are not remotely fetchable provider URLs. Host-side media transfer, provider processing and costs remain governed by the user's authorization and the chosen host capability. If the source or speech capability is unavailable, the agent reports the gap and requests supplied text/audio while continuing independent editing.

The captions skill requires an agent LLM normalization pass with raw recognition and correction evidence preserved. Returned extraction-relative timestamps are offset to source microseconds once; full-source timestamps need no offset. Do not invent word alignment or speaker labels. Attach text through `assets.updateClips` (or the asset site tool), using ordered, bounded `transcriptCues` and their newline-joined text. Untimed text uses null timestamps. Rendered captions use ordinary canonical caption edits and final-cut timing; source-clip text does not implicitly create a caption track or canonical transcript record.

For narration, the agent generates or obtains a take using its own TTS capability, checks pronunciation and actual duration, imports the file through the existing media importer, and places it with revision-aware edits. LocalCut keeps no provider credentials and makes no speech-provider requests.

## Saved transcript compatibility

Existing canonical transcripts, source timing, model/revision provenance, clip links, history and backups remain readable. `editor.transcription.transcript(id)` and `localcut_transcription` with `action: "read"` retrieve saved records; the site tool requires membership in the viewed project. The former status, prepare, transcribe and clearModelCache methods/actions are removed. New agent results use asset-clip text/cues and caption edits; there is no new canonical transcript import service.

On explicit editor initialization, LocalCut attempts to delete only that namespace's obsolete `-asr-v1` model cache. Cache access failure does not block editing. This cleanup never touches originals, authored projects, saved transcripts or other namespaces. Bare navigation and skill discovery remain inert. Already open older application versions retain their old implementation until reloaded.

The former real-model inference acceptance and download-fixture helper are retired with the implementation. Current regression coverage verifies saved transcript compatibility, source-clip text/timing, read-only site-tool scope, cache cleanup and published speech guidance. Historical inference results remain tied to their recorded revisions.
