---
name: localcut-audio-editing
description: Restore and mix dialogue, music and effects in LocalCut using reversible clip processing, shared timing and honest listening evidence.
license: MIT
metadata:
  author: LocalCut
  source: Agentic Workflows 0.2.0+codex.20261018000000
---

# Edit and mix audio in LocalCut

Inspect the intended project and audio assets. Establish the audible problem, language, duration, channel intent and any supplied loudness/peak target. Listen before choosing processing when playback is available; waveforms and transcripts cannot prove intelligibility or a clean splice.

LocalCut's timeline owns placement. Use discovered canonical edit schemas for gain, fades, mute, EQ/denoise, audio separation, speed and pitch preservation. Do not assume a full DAW, plugin suite, loudness meter or arbitrary filter is exposed. For unavailable treatment, state the limit and use a separately available authorized audio tool only if needed; import its new processed stem without replacing the original.

Work from dialogue outward to music and effects. Preserve exact source endpoints when changing only gain/speed. Use short level-matched comparisons; avoid stacking noise reduction until speech sounds metallic. Keep breaths and room tone coherent, fade exposed joins and leave space around speech. A transcript locates an edit but does not prove a clean audio boundary. Preserve original assets, processed-stem lineage and reversible settings.

Submit edits through `localcut_apply_edits` with the inspected revision and unique request ID; preserve unrelated properties. Reinspect on conflicts and retry identical lost-response batches without changing their payload. Music and narration follow this timeline's cue times rather than moving independently.

Play and listen to the affected range, including joins, pauses and endings. Check clipping, clicks, intelligibility, balance and loop seams. If the host exposes suitable decoding/metering for a downloaded export, measure the actual candidate against the supplied target; do not invent LUFS, true-peak, channel or mono-compatibility evidence from a waveform. State unmeasured dimensions.

Export with `localcut_export_video`, wait/download with `localcut_job`, and check sync and sound in that encoded video. Silent frame previews do not verify audio. Report settings, affected source ranges, technical measurements actually made and listening coverage. Keep prior masters; fix a specific timestamped problem and repeat the affected stage. No provider upload, paid processing or publishing follows from local mixing authority.

Adapted for LocalCut from Agentic Workflows (audio-editing; references/restoration-and-mixing.md). Copyright (c) 2026 Wilson Le. Distributed under the [MIT License](LICENSE.txt). All required workflow guidance is contained in this file.
