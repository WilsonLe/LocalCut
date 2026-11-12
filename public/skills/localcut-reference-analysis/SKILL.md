---
name: localcut-reference-analysis
description: Study supplied video, audio or image references and translate observed pacing, framing, type and sound into an original LocalCut edit.
license: MIT
metadata:
  author: LocalCut
  source: Agentic Workflows 0.2.0+codex.20261018000000
---

# Learn from a reference

Use the agent host's built-in browser first. Open Chrome or another external browser only when the user explicitly requests it, the built-in browser is unavailable, or a required capability fails there. State the fallback reason before switching. Missing WebMCP alone is not a reason to switch when the ordinary UI can complete the task. Before switching, back up existing work including originals, restore it in the destination and verify the intended project and media. Browser profiles do not share local data; if transfer is blocked, keep the original tab intact and report it.

Resolve the exact user-supplied file, URL and time range. Use available browser playback, frames and audio; import an authorized local reference through LocalCut's browser file chooser when useful. LocalCut does not download a remote video from a URL or bypass site access. If your host has a suitable authorized retrieval capability, use it separately and retain provenance. A thumbnail, transcript or description only establishes that surface.

Record what you actually watched, saw or heard and which ranges remain unavailable. Do not claim to have inspected inaccessible media. A transcript cannot establish camera movement, and a silent frame cannot establish music. Continue independent editing with a stated assumption if the missing detail is optional.

Make a timestamped breakdown of the hook, shot lengths, framing, subject continuity, movement, transitions, color, text hierarchy, readable holds and ending. For sound, note pauses, speech/music balance, layer entrances and accents. Distinguish measured durations from rough estimates and inferred font/easing choices.

Translate each useful observation into an original decision for this brief: which technique helps, where it belongs, how it changes for the user's assets/audience and how to review it. Preserve accepted style; do not import every effect from a reference. Prototype a representative segment in the existing LocalCut project, using `localcut_apply_edits` against an inspected revision. Use `localcut_preview_frame` and playback to compare the result with the intended principle.

Store a concise reference breakdown beside the beat list or in the project's storyboard text if useful. Keep original or authorized assets and soundtrack provenance. Access to a reference does not grant redistribution rights or voice-cloning permission. Reinspect after timing changes and hand the accepted observations back to the one project timeline.

Keep visible UI and authored titles/captions focused on the user's content and actions. Do not add storage explanations, implementation notes, workflow narration or filler such as “saved with this asset in your browser.” Include a short explanation only when it changes a concrete user decision or resolves an error. Preserve supplied transcript/content verbatim unless a correction is requested.

Adapted for LocalCut from Agentic Workflows (video-editing/references/learn-from-reference.md). Copyright (c) 2026 Wilson Le. Distributed under the [MIT License](LICENSE.txt). All required workflow guidance is contained in this file.
