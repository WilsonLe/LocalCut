---
name: localcut-narration
description: Use this skill whenever creating or timing narration in LocalCut. Request TTS from the external agent, then import and review the take with measured timing.
license: MIT
metadata:
  author: LocalCut
  source: Agentic Workflows 0.2.0+codex.20261018000000
---

# Narration for a LocalCut edit

Use the agent host's built-in browser first. Open Chrome or another external browser only when the user explicitly requests it, the built-in browser is unavailable, or a required capability fails there. State the fallback reason before switching. Missing WebMCP alone is not a reason to switch when the ordinary UI can complete the task. Before switching, back up existing work including originals, restore it in the destination and verify the intended project and media. Browser profiles do not share local data; if transfer is blocked, keep the original tab intact and report it.

Establish language, pronunciation, tone, pace and intended voice from the brief. Keep the accepted script and pronunciation substitutions distinct. LocalCut can import, place, trim and mix audio; it does not provide built-in speech generation or a voice-provider connection.

Use an existing recorded take when available. For requested new synthesis, request text-to-speech (TTS) from the calling agent's available speech tools or runtime. LocalCut has no bundled TTS or STT engine. Use the host capability within authorization for the script, voice and any cost/upload. Ordinary narration does not imply voice cloning. If TTS is unavailable, report the missing capability and request an agent-provided or recorded take; continue independent editing without claiming speech was generated.

Preserve each accepted take and its script, voice/runtime/settings, provenance and listening status. Measure decoded duration rather than estimating timestamps from word counts. Check the actual take for pronunciation, names/numbers, missing/duplicated words, prosody and clipped endings. Request STT from the agent when transcript alignment is needed and follow `localcut-captions` for source timing and normalization. An STT transcript can help locate text, but cannot certify pronunciation or natural delivery.

Import the new audio through workspace `import_files` and the browser chooser or the supported small-file import tool, wait for completion and inspect the asset. Media import does not place a timeline clip. Insert the take with canonical edits against the current project revision; use stable instance IDs and a unique request ID. The LocalCut timeline owns the slot and all music/visual cues.

If the take exceeds its slot, revise wording/delivery or change the cut within the brief. Audition modest speed/pitch-preserving changes instead of silently rushing or truncating speech. Regenerated phrases need consistent context and checked joins. Preserve unaffected accepted takes and revisit captions after changing audio.

Listen to the mixed encoded output for pronunciation, levels, sync, breathing and ending. Keep the actual audio, editable project and script/provenance together. Report what was generated externally, what LocalCut changed and which listening checks remain unavailable. Download before releasing export jobs or navigating away.

Keep visible UI and authored titles/captions focused on the user's content and actions. Do not add storage explanations, implementation notes, workflow narration or filler such as “saved with this asset in your browser.” Include a short explanation only when it changes a concrete user decision or resolves an error. Preserve supplied transcript/content verbatim unless a correction is requested.

Adapted for LocalCut from Agentic Workflows (text-to-speech; audio-editing). Copyright (c) 2026 Wilson Le. Distributed under the [MIT License](LICENSE.txt). All required workflow guidance is contained in this file.
