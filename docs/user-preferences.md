# LocalCut user preferences

This is the project record of the user's durable product and workflow choices. Update it when the user adds or changes a preference; newer explicit choices take precedence over earlier ones.

## Product foundation

- LocalCut is a client-only web video editor that builds into thin static assets, including deployment under `/LocalCut/` on GitHub Pages.
- Use React, TypeScript, Vite, shadcn components built on Base UI, the neutral Vega foundation, and Tailwind CSS. Use system fonts.
- Keep media processing, original files, editing data and speech transcription local. Optional OpenRouter reasoning can receive explicitly shared text and metadata; it must not upload source media.
- Target current stable desktop Chrome first. Default to 1920 × 1080 at 30 fps and 48 kHz stereo; support MP4/H.264/AAC and WebM/VP9/Opus only after actual browser capability checks.
- Use IndexedDB and OPFS for local persistence. Local editing needs no account or server, and transcription model downloads require explicit preparation.
- People and browser agents should use the same inspectable editing engine, stable document IDs, commands, revisions and errors.
- The original blank application boundary ended when the user approved building the AI-first workspace from the collaborative mockup. Keep the editing conversation easy to reach alongside the preview and timeline.

## Workspace refinements — 10 October 2026

- Put less-frequent header settings in a dropdown. Organize them into named groups that progressively unfold, rather than showing every setting at once.
- Keep OpenRouter connection and model controls in the chat interface. The selected provider remains visible there. Connection requires the user's credentials/consent; keep keys in memory and do not initiate paid requests automatically.
- Make chat narrower and collapsible. Animate the chat moving out/in and the main editing area expanding/contracting together. Preserve the conversation when collapsed, support keyboard control, and respect reduced-motion preferences.
- Keep a usable stacked layout on narrow screens, with the editing area before the conversation.
- Use real editing, progress and export results in production. Illustrative clips and simulated replies belong only in explicitly labelled prototypes.

## Workspace cleanup and editing access — 10 October 2026

- Keep the workspace free of explanatory filler and repeated status text. Remove redundant empty-state copy, device/privacy labels, preview metadata and frame-rate labels from the default view; disclose useful details through accessible shadcn tooltips or expandable settings. Keep actionable errors and operation progress visible.
- Match the CYOBot instructor dashboard chat's structure and interactions, using LocalCut's styling. Use its compact conversation header, transcript, tool/approval disclosures and composer instead of a separate invented chat layout.
- Keep one OpenRouter configuration entry point in chat. Remove the long duplicate provider bar.
- Give the new-project dialog comfortable field spacing and padding. Remove the visible “Save your edits on this device” explanation there as well.
- Keep media in its own right-side panel with an always-reachable edge toggle, independent of chat. Remove the header Media action.
- Provide useful video-editing keyboard shortcuts and discoverable help. Preserve normal typing, native control activation, menu/dialog keyboard handling and assistive interaction.
- Give the assistant the tools needed to inspect, plan and perform supported video-editing workflows. Continue requiring explicit approval for edits and consequential local service actions, and keep source media local.

## Appearance customization — 10 October 2026

- Provide an appearance section inspired by shadcn Create. The actual workspace is the live preview, and appearance preferences survive reload locally in the browser.
- Keep the existing Base UI and Lucide foundations. System font stacks provide body/heading choices without downloading fonts. Appearance changes must preserve the active editing session and conversation.

## Project versions — 10 October 2026

- Autosave a project version after one second without a committed edit; keep working edits immediately durable in local storage.
- Browse historical versions by recreating the complete project in the real editor, timeline and playback preview in read-only mode. Do not use screenshots as version previews.
- Past versions are immutable. Restoring a version appends a new version containing that saved state and advances the current revision; it never rewrites or removes later versions.

## Delivery and validation

- Pull and rebase onto current `main`, including the OpenRouter integration, before completing the workspace.
- Optimize tests for fast feedback. Prefer targeted tests while iterating and bounded parallelism where isolation allows it; retain required full acceptance before delivery. Do not trade away real Chrome, codec, transcription, privacy or export evidence for speed.
- Keep agent instructions and developer documentation useful and current. Make one development cycle fast with clear module ownership, focused checks, verified build reuse, failure recovery, and one automatic review-and-address cycle; avoid redundant full checks or repeated reviews when the relevant inputs have not changed.
- Nest `AGENTS.md` files at directory and subdirectory ownership boundaries so instructions stay scoped to the code being changed. Keep the root brief and shared rules in parent guides; do not duplicate a full global guide in each module.
- Disable remote CI and run quality checks, browser acceptance, transcription and performance checks locally. Keep the manually approved Pages release separate; do not re-enable hosted validation workflows.
- Keep these preferences recorded here and preserve the user's separate merge/deployment authorization boundaries.
