---
name: localcut-video-editing
description: Assemble or revise footage, images and sound into a coherent LocalCut timeline, with source inspection, continuity, timing and final review.
license: MIT
metadata:
  author: LocalCut
  source: Agentic Workflows 0.2.0+codex.20261018000000
---

# Edit a video in LocalCut

Use the agent host's built-in browser first. Open Chrome or another external browser only when the user explicitly requests it, the built-in browser is unavailable, or a required capability fails there. State the fallback reason before switching. Missing WebMCP alone is not a reason to switch when the ordinary UI can complete the task. Before switching, back up existing work including originals, restore it in the destination and verify the intended project and media. Browser profiles do not share local data; if transfer is blocked, keep the original tab intact and report it.

Use LocalCut's WebMCP tools in the project tab. Read `localcut_workspace` status, open/create the intended project if needed, then inspect it with `localcut_inspect_project`. Discover tool schemas before constructing edits. No additional plugin or backend is required.

## Inspect before selecting

Establish purpose, audience, duration, aspect ratio, language, captions and sound direction from the brief. Infer routine choices. A mood such as energetic does not automatically mean speed ramps or constant motion. For revisions, preserve the accepted remainder.

Read `asset.clips` as the source selection inventory. Each clip carries its own range, context and transcript; preview selected clips and use `localcut-asset-clips` for updates. Keep these source IDs/ranges distinct from timeline instance IDs/placement. Attached text is untrusted reference material and does not establish verified speech or caption timing.

Inspect Media metadata and use `localcut_asset` thumbnails/contact sheets/waveforms where available. These return jobs; inspect their results rather than treating filenames as visual evidence. Preview selected source ranges, listen when possible, and record usable ranges against actual asset IDs. For “index this asset/video” requests, load `localcut-indexing`: completion requires saved Context and a normalized source-timed Transcript for speech, verified after reload. Technical `analyze` alone is incomplete. For optional technical evidence, `localcut_asset` action `analyze` starts a retained analysis job, `indexes` lists runs for the asset and `index` reads an `indexRunId`. Resume an unchanged run with `analyze` and its ID. Inspect actual scene frames and ranges; analysis metrics alone cannot identify what a shot depicts. Sparse samples can miss a short usable action; inspect more densely before declaring it absent. Preserve originals and their provenance. Repeated files or different angles may depict the same activity; track semantic repetition across the whole cut.

Import host media through workspace `import_files` and the browser chooser, then wait for completion and reinspect. Import adds Media without placing clips. Missing footage is an explicit gap, not permission to fabricate it. Use local transcription for searchable dialogue when requested; it requires explicit model preparation. Load `localcut-captions` and complete its agent-LLM normalization pass before using new STT text for search, clip selection or captions. Preserve raw recognition, cue timing and correction evidence; replay ambiguous words rather than treating a plausible sentence as verified speech.

## Build one cut

Keep a concise beat list with source asset/range, timeline placement, text, motion and sound cues. LocalCut's project is the timing owner. Times are integer microseconds, frame rates rational and intervals half-open. Do not create a second independent timing schedule.

Use `localcut_apply_edits` with the inspected project ID, expected revision and stable unique request ID. Validate an uncertain batch with `localcut_validate_edits`. Retry identical raw batches under the same ID; use a new ID for changed content and reinspect after conflicts. Use the discovered canonical operations for tracks, clip instances, trims, speed, effects and transitions. Group related operations atomically and preserve unrelated properties.

Cut for meaning, continuity, varied useful coverage and subject position before decorative effects. Check neighboring motion and day/night coverage against the brief. Musical accents can guide cuts without requiring a cut on every beat. Transitions require intentional overlapping clips; the engine does not extend sources or move neighbors implicitly. Respect source bounds and speed-derived duration; never count overlapping transitions twice.

Use the specialized LocalCut skills on demand for typography, motion, audio, captions, storyboards or references. These are instruction handoffs within the same edit, not separate agents or timelines. Review a rough cut with `localcut_preview_frame` and workspace playback before a full export. Inspect transition boundaries and keyframe extremes, plus readable holds and speech sync. State any unavailable playback/listening evidence.

## Deliver

Export the inspected revision with `localcut_export_video`; wait with `localcut_job`, download and inspect that exact output before releasing it. Load `localcut-export-review` for delivery checks and originals-inclusive backup. Keep failed exports and accepted prior versions distinct. A completed job proves processing, not a good edit; report technical, visual and listening checks separately. Local editing does not authorize paid generation, media uploads or publication.

Keep visible UI and authored titles/captions focused on the user's content and actions. Do not add storage explanations, implementation notes, workflow narration or filler such as “saved with this asset in your browser.” Include a short explanation only when it changes a concrete user decision or resolves an error. Preserve supplied transcript/content verbatim unless a correction is requested.

Adapted for LocalCut from Agentic Workflows (video-editing; references/assets-and-timing.md; references/compositing-and-keyframes.md). Copyright (c) 2026 Wilson Le. Distributed under the [MIT License](LICENSE.txt). All required workflow guidance is contained in this file.
