---
name: localcut-storyboards
description: Plan visual beats, arrange a LocalCut storyboard and export reusable PNG, SVG or editable scene artwork through the shared project.
license: MIT
metadata:
  author: LocalCut
  source: Agentic Workflows 0.2.0+codex.20261018000000
---

# Storyboards and reusable artwork

Use the existing LocalCut project, not another editing document. Inspect it and the available Media with `localcut_inspect_project`. For each beat, identify its purpose, source asset/range, intended timeline placement, composition, text, motion and audio cue. A short beat list is enough for a small edit. Identify missing assets and label placeholders explicitly.

The Storyboard is a local whiteboard stored in the project and shared Undo/Redo. Read `localcut_apply_edits` schemas for general drawing, text, geometry and layer commands. Preserve stable element IDs and unaffected elements; use atomic, revision-aware updates. A storyboard layout does not place timeline clips or create a second playback clock.

Use `localcut_storyboard` to insert a project image/video still, export PNG/SVG/editable scene, or store a rendered PNG in Media. Inspect the current action schema for required project revision, request ID and options. Image elements reference local Media IDs; browser object URLs are temporary and must not be authored as permanent source identities. Relink missing originals rather than silently substituting them.

For reuse in a video, store the selected frame/elements as a PNG in Media, wait for the job and inspect its asset ID, then insert a timeline image clip through ordinary edits. PNG flattens the drawing; retain the editable scene/project when later revision is needed. Export files and release temporary results with `localcut_job` only after saving or inspecting them.

Inspect the actual exported artwork for clipping, missing images, font changes, alignment and legibility at delivery size. A saved scene proves editability, not correct rendering. Report the exported formats, included elements, Media placement and unresolved placeholders. Use an originals-inclusive project backup for portable source handoff.

Adapted for LocalCut from Agentic Workflows (video-editing/templates/storyboard.md; motion-design). Copyright (c) 2026 Wilson Le. Distributed under the [MIT License](LICENSE.txt). All required workflow guidance is contained in this file.
