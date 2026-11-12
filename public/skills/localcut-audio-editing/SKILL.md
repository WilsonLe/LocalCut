---
name: localcut-audio-editing
description: Restore and mix dialogue, music and effects in LocalCut using reversible clip processing, shared timing and honest listening evidence.
license: MIT
metadata:
  author: LocalCut
  source: Agentic Workflows 0.2.0+codex.20261018000000
---

# Edit and mix audio in LocalCut

Use the agent host's built-in browser first. Open Chrome or another external browser only when the user explicitly requests it, the built-in browser is unavailable, or a required capability fails there. State the fallback reason before switching. Missing WebMCP alone is not a reason to switch when the ordinary UI can complete the task. Before switching, back up existing work including originals, restore it in the destination and verify the intended project and media. Browser profiles do not share local data; if transfer is blocked, keep the original tab intact and report it.

Inspect the intended project and audio assets. Establish the audible problem, language, duration, channel intent and any supplied loudness/peak target. Listen before choosing processing when playback is available; waveforms and transcripts cannot prove intelligibility or a clean splice.

For sound effects, search the bundled CC0 library with `localcut_catalog`, `kind: "sounds"`. Use concise action/material/style keywords, such as `query: "paper page turn"`, `"cards shuffle"`, `"retro victory"` or `"pavement walking"`; every term must match. Inspect returned tags, durationUs, category, source and licence. Refine with `category`, an array of exact `tags` (all must match), or `minDurationUs`/`maxDurationUs`. Results include total, nextOffset and category/tag counts; page with offset/limit rather than treating the first page as the whole library. Example: `{"kind":"sounds","query":"laser","tags":["retro"],"maxDurationUs":1000000,"limit":10}`. Empty results mean broaden the query or remove filters. Tags describe creator-labelled subjects and intended uses, not verified perceptual judgments or guaranteed seamless loops.

Import the chosen result's `id` with `localcut_import_media`: `{"projectId":"<inspected project>","soundId":"<catalogue item.id>"}`. Optional parentId selects a Media folder. Wait for the returned job with `localcut_job`; its result supplies the ordinary asset ID and library revision. Retrieval verifies same-origin bytes before starting the engine import. Import adds Media; place that asset on the shared timeline with `localcut_apply_edits`, using its measured duration and the inspected project revision. Inspect Media before retrying a lost import response. Do not send base64/name/mimeType/relinkAssetId with soundId. For ordinary supplied files, the existing file-selection/base64 import remains available. Without WebMCP, use Media → Sound effects, search, expand/click tags, preview and Add to Media. Preview volume changes audition loudness only; choose clip gain/fades in the edit.

LocalCut's timeline owns placement. Use discovered canonical edit schemas for gain, fades, mute, EQ/denoise, audio separation, speed and pitch preservation. Do not assume a full DAW, plugin suite, loudness meter or arbitrary filter is exposed. For unavailable treatment, state the limit and use a separately available authorized audio tool only if needed; import its new processed stem without replacing the original.

Work from dialogue outward to music and effects. Preserve exact source endpoints when changing only gain/speed. Use short level-matched comparisons; avoid stacking noise reduction until speech sounds metallic. Keep breaths and room tone coherent, fade exposed joins and leave space around speech. A transcript locates an edit but does not prove a clean audio boundary. Preserve original assets, processed-stem lineage and reversible settings.

Submit edits through `localcut_apply_edits` with the inspected revision and unique request ID; preserve unrelated properties. Reinspect on conflicts and retry identical lost-response batches without changing their payload. Music and narration follow this timeline's cue times rather than moving independently.

Play and listen to the affected range, including joins, pauses and endings. Check clipping, clicks, intelligibility, balance and loop seams. If the host exposes suitable decoding/metering for a downloaded export, measure the actual candidate against the supplied target; do not invent LUFS, true-peak, channel or mono-compatibility evidence from a waveform. State unmeasured dimensions.

Export with `localcut_export_video`, wait/download with `localcut_job`, and check sync and sound in that encoded video. Silent frame previews do not verify audio. Report settings, affected source ranges, technical measurements actually made and listening coverage. Keep prior masters; fix a specific timestamped problem and repeat the affected stage. No provider upload, paid processing or publishing follows from local mixing authority.

Keep visible UI and authored titles/captions focused on the user's content and actions. Do not add storage explanations, implementation notes, workflow narration or filler such as “saved with this asset in your browser.” Include a short explanation only when it changes a concrete user decision or resolves an error. Preserve supplied transcript/content verbatim unless a correction is requested.

Adapted for LocalCut from Agentic Workflows (audio-editing; references/restoration-and-mixing.md). Copyright (c) 2026 Wilson Le. Distributed under the [MIT License](LICENSE.txt). All required workflow guidance is contained in this file.
