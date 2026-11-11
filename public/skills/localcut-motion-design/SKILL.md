---
name: localcut-motion-design
description: Create purposeful LocalCut clip and text animation with canonical keyframes, compositing, masks and review at actual timeline times.
license: MIT
metadata:
  author: LocalCut
  source: Agentic Workflows 0.2.0+codex.20261018000000
---

# Motion design in LocalCut

Inspect the project and supplied artwork. Establish the visual idea, duration, canvas, intended audience and sound cues. Preserve accepted artwork and style. The existing LocalCut timeline owns all placement; scene-local/keyframe times must map to that clock.

Read current edit schemas for transforms, opacity, effects, keyframes, text animation, blend modes, masks and transitions. Use `localcut_catalog` for available templates and recipes. Only use controls the schema exposes. Do not install a new rendering engine or assume that browser shell/QuickJS can render arbitrary HTML, Three.js or native video. External rendered intermediates are optional assets from an available authorized host tool.

Design movement to communicate hierarchy, anticipation, reveal, transformation or continuity. Leave readable holds. A raster picture supports camera moves, cropping and masks; independent limb/object motion needs suitable layers or geometry. Do not imply articulated animation when only the whole bitmap moved. Product demonstrations should show actual supported behavior; label recreated or simulated screens.

Use `localcut_apply_edits` with the current project revision, a unique request ID and stable clip/keyframe identities. Keyframes are clip-local integer microseconds with the schema's interpolation modes. Preserve unaffected fields and avoid substituting invented easing syntax. Transitions require explicit valid overlap and source ranges. For mask motion, inspect `localcut_track_mask` and its job output rather than treating an unverified track as correct.

Inspect stills at handoffs, extrema, overlap and end states using `localcut_preview_frame`; then play the range to judge rhythm and continuity. Look for unintended blank frames, text collisions, abrupt starts, subject drift and unreadable motion. For loops, inspect both sides and play across the seam. Download/export the candidate before claiming final rendered quality.

Return the editable project and inspected video. State which frames/ranges were reviewed and whether playback/sound was observed. Changed timing, artwork or fonts invalidates affected review evidence. Keep originals and prior exports; fix concrete timestamped issues. Optional external generation does not imply permission for paid services, media uploads or publication.

Keep visible UI and authored titles/captions focused on the user's content and actions. Do not add storage explanations, implementation notes, workflow narration or filler such as “saved with this asset in your browser.” Include a short explanation only when it changes a concrete user decision or resolves an error. Preserve supplied transcript/content verbatim unless a correction is requested.

Adapted for LocalCut from Agentic Workflows (motion-design; video-editing/references/compositing-and-keyframes.md). Copyright (c) 2026 Wilson Le. Distributed under the [MIT License](LICENSE.txt). All required workflow guidance is contained in this file.
