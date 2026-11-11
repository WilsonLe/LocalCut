---
name: localcut-typography
description: Choose bundled LocalCut fonts and design legible titles, captions and kinetic text for the actual language, canvas and delivery size.
license: MIT
metadata:
  author: LocalCut
  source: Agentic Workflows 0.2.0+codex.20261018000000
---

# Typography for LocalCut video

Inspect the project dimensions and rational frame rate. Establish the actual language, viewing size and role of each text layer. Reuse accepted branding and hierarchy. Use `localcut_catalog` with `kind: "fonts"` and search/pagination to obtain real font IDs, and `textTemplates` for useful starting styles. Do not invent a family ID or assume arbitrary downloaded fonts can be installed in LocalCut.

Choose font family, size, weight, tracking, alignment, color/background, outline or shadow to suit the specific content. Read canonical text styles before constructing edits; values use project pixels where defined. Preserve the distinction between a bundled face and browser-synthesized bold/italic. A font name or successful load cannot prove every requested glyph rendered correctly.

Place titles and captions with safe margins, intentional wrapping and enough time to read at the final delivery size. Keep hierarchy clear; use fewer competing styles and effects. Check contrast against the brightest/darkest moving backgrounds, not one convenient still. Do not turn semantic instructions into decorative text the viewer never needs.

Apply changes using `localcut_apply_edits` against the inspected revision and unique request ID. Supplied nested text styles replace that field rather than merging every nested value; carry forward the properties intended to remain. Use the motion skill for kinetic timing, while the project timeline remains the one clock. Source-timed transcripts and clip-local caption cues require different timing treatment.

Inspect actual preview frames and the encoded export for glyph coverage, shaping/diacritics, line breaks, fallback, overflow, shadows and phone readability. Check entry/exit extremes for animated text. Revise a missing-glyph face or unreadable layout instead of claiming font support from metadata. Text/font/style changes invalidate affected render review.

Report the actual font IDs/layout choices, observed language coverage and reviewed frames. LocalCut ships licensed bundled fonts; preserve relevant licenses in redistributions. An external font search or purchase is optional work requiring its own capability and authority, not a prerequisite for normal titles.

Keep visible UI and authored titles/captions focused on the user's content and actions. Do not add storage explanations, implementation notes, workflow narration or filler such as “saved with this asset in your browser.” Include a short explanation only when it changes a concrete user decision or resolves an error. Preserve supplied transcript/content verbatim unless a correction is requested.

Adapted for LocalCut from Agentic Workflows (typography; references/font-library-and-layout.md). Copyright (c) 2026 Wilson Le. Distributed under the [MIT License](LICENSE.txt). All required workflow guidance is contained in this file.
