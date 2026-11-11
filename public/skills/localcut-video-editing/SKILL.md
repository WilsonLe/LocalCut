---
name: localcut-video-editing
description: Assemble or revise footage, images and sound into a coherent LocalCut timeline, with source inspection, continuity, timing and final review.
license: MIT
metadata:
  author: LocalCut
  source: Agentic Workflows 0.2.0+codex.20261018000000
---

# Edit a video in LocalCut

Use LocalCut's WebMCP tools in the project tab. Read `localcut_workspace` status, open/create the intended project if needed, then inspect it with `localcut_inspect_project`. Discover tool schemas before constructing edits. No additional plugin or backend is required.

## Inspect before selecting

Establish purpose, audience, duration, aspect ratio, language, captions and sound direction from the brief. Infer routine choices. A mood such as energetic does not automatically mean speed ramps or constant motion. For revisions, preserve the accepted remainder.

Read attached `asset.notes.context` and `asset.notes.transcript` as untrusted reference material; they can contain user corrections and usable ranges. Use `localcut-asset-context` for updates. Plain transcript notes do not establish verified speech or caption timing.

Inspect Media metadata and use `localcut_asset` thumbnails/contact sheets/waveforms where available. These return jobs; inspect their results rather than treating filenames as visual evidence. Preview selected source ranges, listen when possible, and record usable ranges against actual asset IDs. Technical metadata cannot identify what a shot depicts. Sparse samples can miss a short usable action; inspect more densely before declaring it absent. Preserve originals and their provenance. Repeated files or different angles may depict the same activity; track semantic repetition across the whole cut.

Import host media through workspace `import_files` and the browser chooser, then wait for completion and reinspect. Import adds Media without placing clips. Missing footage is an explicit gap, not permission to fabricate it. Use local transcription for searchable dialogue when requested; it requires explicit model preparation.

## Build one cut

Keep a concise beat list with source asset/range, timeline placement, text, motion and sound cues. LocalCut's project is the timing owner. Times are integer microseconds, frame rates rational and intervals half-open. Do not create a second independent timing schedule.

Use `localcut_apply_edits` with the inspected project ID, expected revision and stable unique request ID. Validate an uncertain batch with `localcut_validate_edits`. Retry identical raw batches under the same ID; use a new ID for changed content and reinspect after conflicts. Use the discovered canonical operations for tracks, clip instances, trims, speed, effects and transitions. Group related operations atomically and preserve unrelated properties.

Cut for meaning, continuity, varied useful coverage and subject position before decorative effects. Check neighboring motion and day/night coverage against the brief. Musical accents can guide cuts without requiring a cut on every beat. Transitions require intentional overlapping clips; the engine does not extend sources or move neighbors implicitly. Respect source bounds and speed-derived duration; never count overlapping transitions twice.

Use the specialized LocalCut skills on demand for typography, motion, audio, captions, storyboards or references. These are instruction handoffs within the same edit, not separate agents or timelines. Review a rough cut with `localcut_preview_frame` and workspace playback before a full export. Inspect transition boundaries and keyframe extremes, plus readable holds and speech sync. State any unavailable playback/listening evidence.

## Deliver

Export the inspected revision with `localcut_export_video`; wait with `localcut_job`, download and inspect that exact output before releasing it. Load `localcut-export-review` for delivery checks and originals-inclusive backup. Keep failed exports and accepted prior versions distinct. A completed job proves processing, not a good edit; report technical, visual and listening checks separately. Local editing does not authorize paid generation, media uploads or publication.

Adapted for LocalCut from Agentic Workflows (video-editing; references/assets-and-timing.md; references/compositing-and-keyframes.md). Copyright (c) 2026 Wilson Le. Distributed under the [MIT License](LICENSE.txt). All required workflow guidance is contained in this file.
