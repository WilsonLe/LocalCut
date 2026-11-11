---
name: localcut-narration
description: Prepare, import and time voiceover takes in LocalCut while preserving scripts, pronunciation, measured duration and generation capability limits.
license: MIT
compatibility: A LocalCut tab with WebMCP site tools, or an agent able to operate the ordinary editor UI.
metadata:
  author: LocalCut
  source: Agentic Workflows 0.2.0+codex.20261018000000
---

# Narration for a LocalCut edit

Establish language, pronunciation, tone, pace and intended voice from the brief. Keep the accepted script and pronunciation substitutions distinct. LocalCut can import, place, trim and mix audio; it does not provide built-in speech generation or a voice-provider connection.

Use an existing recorded take when available. For requested new synthesis, check whether the agent's host supplies an appropriate speech tool or local runtime. Use it only within authorization for the script, voice and any cost/upload. Ordinary narration does not imply voice cloning. Missing synthesis capability is a named gap; continue the cut with an explicitly labeled placeholder or the supplied take, without pretending generated speech exists.

Preserve each accepted take and its script, voice/runtime/settings, provenance and listening status. Measure decoded duration rather than estimating timestamps from word counts. Check the actual take for pronunciation, names/numbers, missing/duplicated words, prosody and clipped endings. An STT transcript can help locate text, but cannot certify pronunciation or natural delivery.

Import the new audio through workspace `import_files` and the browser chooser or the supported small-file import tool, wait for completion and inspect the asset. Media import does not place a timeline clip. Insert the take with canonical edits against the current project revision; use stable instance IDs and a unique request ID. The LocalCut timeline owns the slot and all music/visual cues.

If the take exceeds its slot, revise wording/delivery or change the cut within the brief. Audition modest speed/pitch-preserving changes instead of silently rushing or truncating speech. Regenerated phrases need consistent context and checked joins. Preserve unaffected accepted takes and revisit captions after changing audio.

Listen to the mixed encoded output for pronunciation, levels, sync, breathing and ending. Keep the actual audio, editable project and script/provenance together. Report what was generated externally, what LocalCut changed and which listening checks remain unavailable. Download before releasing export jobs or navigating away.

Adapted for LocalCut from Agentic Workflows (text-to-speech; audio-editing). Copyright (c) 2026 Wilson Le. Distributed under the [MIT License](LICENSE.txt). All required workflow guidance is contained in this file.
