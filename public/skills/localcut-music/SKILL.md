---
name: localcut-music
description: Compose or arrange original music and timed sound cues for LocalCut, using its isolated JavaScript workspace or imported audio with one shared edit clock.
license: MIT
compatibility: A LocalCut tab with WebMCP site tools, or an agent able to operate the ordinary editor UI.
metadata:
  author: LocalCut
  source: Agentic Workflows 0.2.0+codex.20261018000000
---

# Music and timed sound

Establish mood, duration, instrumentation, cue points, dialogue space and ending/loop from the brief. Inspect the existing LocalCut cut first. Keep one project timeline; return audio at measured duration and explicit offsets rather than introducing another video clock.

For original instrumental material, write a motif, harmonic movement, rhythm, sections and silence. Preserve editable notes/code, seeds, synthesis settings and sample provenance. Code synthesis can use oscillators, envelopes, noise and percussion; choosing a palette is not a substitute for composing a piece.

LocalCut's `localcut_coding` exposes an isolated project filesystem, browser shell and saved JavaScript runtime. Inspect its workspace revision/runtime facts and read the actual operation schemas before running. It has no network, host filesystem, native FFmpeg/Python, arbitrary page DOM or provider bindings. A JavaScript program can generate a supported audio file such as PCM WAV; the tool does not imply a preinstalled music library or singing model. Keep sample counts finite, bound memory/output sizes and avoid clipping. Keep source and output files in the existing workspace.

Use the coding revision for write/run/import operations, then wait for their jobs. Import the generated file into Media with the canonical `import_workspace_file` operation; inspect the result and place it with revision-aware timeline edits. Coding, library and project revisions are distinct. If coding cannot produce the requested timbre or singing, state that limit and use supplied audio or an available authorized host music capability. Do not pretend instrumental synthesis produces vocals.

For reference-led music, distinguish what was heard from model-inferred or proposed choices. Create original material with authorized samples; do not claim redistribution rights or legal exclusivity from an originality label. Existing tracks can be trimmed, faded, looped and balanced through canonical audio edits. Listen across loop seams and around speech, accents and the ending.

Measure the actual generated/imported duration and inspect the decoded final export when host tools permit. Listen for harshness, clicks, clipping, musical flow and cue alignment. Statistics do not prove musical quality. Deliver audio plus editable source/cue notes and provenance; report listening limitations. Local composition does not authorize paid generation, private-media uploads or publishing.

Adapted for LocalCut from Agentic Workflows (music-composition; audio-editing). Copyright (c) 2026 Wilson Le. Distributed under the [MIT License](LICENSE.txt). All required workflow guidance is contained in this file.
