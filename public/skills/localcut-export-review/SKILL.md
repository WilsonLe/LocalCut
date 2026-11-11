---
name: localcut-export-review
description: Review and deliver the actual LocalCut export, preserving revision identity, technical versus visual and listening evidence, backups and job cleanup.
license: MIT
compatibility: A LocalCut tab with WebMCP site tools, or an agent able to operate the ordinary editor UI.
metadata:
  author: LocalCut
  source: Agentic Workflows 0.2.0+codex.20261018000000
---

# Review and deliver a LocalCut cut

Read the brief and inspect the current project. Check duration, aspect ratio/frame rate, language, required subjects/beats, captions, soundtrack and intentional gaps. Identify unresolved placeholders or missing originals. Preserve accepted edits and prior masters.

Review a rough cut before expensive export. Use `localcut_preview_frame` at the opening, closing, transitions, keyframe extrema, title/caption holds and known difficult ranges. Inspect each returned PNG rather than treating a successful job as visual approval. Play affected ranges when possible; stills cannot establish smooth motion, sync or pleasing sound. Record timestamped issues and fix through canonical revision-aware edits.

Freeze the requested candidate by inspecting its latest revision, then call `localcut_export_video` with that project ID and expected revision. The export captures/validates that revision in the existing engine. If the project changes, reinspect rather than exporting under a false identity. Use an available native MP4/WebM format from the actual tool schema and browser capability; do not promise codecs the browser lacks.

Wait using `localcut_job`, inspect its completed result, download before release and retain the project/revision/file identity. Export blob URLs are local to this tab and temporary; navigation or release revokes them. A URL alone is not durable delivery. If export fails, preserve prior outputs and fix the reported cause before retrying the affected stage.

Inspect the actual encoded file with available playback/decoder tools: dimensions, duration, frame rate, audio presence, opening/ending, transitions, caption sync, readability and sound. Use exact measured values when available. Preview frames from before encoding do not establish final-file quality. If your host cannot reopen/download/decode/listen, state which checks remain unobserved instead of claiming verification from metadata alone.

Offer or create the requested portable handoff with `localcut_backup_project`. Choose originals-inclusive backup for a self-contained source transfer; project JSON alone is not the source media. Download backups and retain editable coding/storyboard source when relevant. Historical snapshots remain read-only; restore/current-view changes follow the existing history rules.

Release disposable preview/export results only after review and download. Report the delivered artifact, project/revision, checks actually made, listening/visual limitations and remaining placeholders. A completed export does not mean the file was published or approved by a human. Local rendering authority does not imply uploading media, posting publicly or spending on external services.

Adapted for LocalCut from Agentic Workflows (video-editing/review and deliver; motion-design/technical verification; audio-editing). Copyright (c) 2026 Wilson Le. Distributed under the [MIT License](LICENSE.txt). All required workflow guidance is contained in this file.
