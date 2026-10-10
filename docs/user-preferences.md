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
- Keep OpenRouter connection and model controls in the chat interface. The selected provider remains visible there. Connection requires the user's credentials/consent; save credentials locally as specified below and do not initiate paid requests automatically.
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

## OpenRouter and chat controls — 10 October 2026

- Keep the AI connection dialog compact. Show a clear connected status and disconnect action; remove explanatory filler from the default view.
- Use one shadcn searchable single-select model dropdown. Search names and IDs inside its popup; place refresh as an icon at the far right of the search row.
- Reveal optional OpenRouter sharing through a Data & analytics popover, with all choices off initially. Keep credentials in their separate local record and source media local.
- Put the model/provider information behind a small icon in the composer footer, revealing configuration progressively. Use the CYOBot instructor chat's searchable session switcher, transcript, and rounded composer structure.

## Chat controls — 10 October 2026

- Match the new-chat plus button height to its search field. Reuse an unused chat on repeated clicks while preserving conversations and drafts.
- Keep the composer squarer, using the same design-system corner token as other controls and respecting appearance customization.

## Appearance customization — 10 October 2026

- Provide an appearance section inspired by shadcn Create. The actual workspace is the live preview, and appearance preferences survive reload locally in the browser.
- Keep the existing Base UI and Lucide foundations. System font stacks provide body/heading choices without downloading fonts. Appearance changes must preserve the active editing session and conversation.

## Local user preferences — 10 October 2026

- Persist chat sidebar width as a local browser user preference; restore the preferred width across reloads and temporary responsive/layout constraints.
- Audit all configurable UI state and use judgement to remember durable choices. Save chat collapse, deliberate media visibility, export format and preferred AI model alongside appearance. Keep authored project data in its existing storage and temporary navigation/operation state in the session.
- Keep preferences local to the browser/origin. Remembering a model does not authorize reconnecting, paid requests or sharing content; credentials use their separate persistent local record; text/name/transcript sharing consent remains session-only. The newer asset-indexing choice below is remembered separately.

## Project versions — 10 October 2026

- Autosave a project version after one second without a committed edit; keep working edits immediately durable in local storage.
- Browse historical versions by recreating the complete project in the real editor, timeline and playback preview in read-only mode. Do not use screenshots as version previews.
- Past versions are immutable. Restoring a version appends a new version containing that saved state and advances the current revision; it never rewrites or removes later versions.

## Workspace commands and uncluttered controls — 10 October 2026

- Hide scrollbars while retaining scrolling throughout the workspace and popups.
- Remove the local-storage information tooltip/icon and the duplicate New project header button. Keep project creation in settings.
- Render buttons only when they can be clicked, including Versions and Export. Keep actual progress and actionable errors visible while an action is unavailable. Keep keyboard shortcut help in settings.
- Provide a shadcn Base Command palette for workspace operations, opened from the header or Mod+K. Show available actions for the current project, selection and version. Reuse existing workflows for values, files and AI approval.

## Workspace portability and app identity — 10 October 2026

- Provide a favicon and PWA install manifest/icons that work at both hosting bases.
- Export/import the workspace with all user settings/preferences and saved projects. Allow the user to select the preference groups, projects, versions and individual source files in either direction; originals are optional ZIP content.
- Provide project-level export/import through the same flow, including asset checkboxes. Preserve existing projects by importing new copies and keep credentials/AI consent outside portable backups.

## Text library — 10 October 2026

- Offer searchable font names and style labels, including cute, minimal, script, serif, mono and display looks.
- Offer editable placeholder text templates with a chosen font and formatting, including bold, curved, shadowed and highlighted text. Insert them as real timeline clips.
- Keep workspace appearance fonts separate from authored text styles. Use local system font stacks under the existing no-download font policy; show that availability depends on the device.

## Timeline editing and transition templates — 10 October 2026

- Provide audio separation from video, clip group/ungroup, and transition controls for overlapping visual clips on one video track.
- Treat transitions as editable templates built from base attributes. A user can request a template in chat and the assistant can inspect and fine-tune its ordinary keyframes for a better result. Keep the resulting edits inspectable through the shared engine.

## Text to speech — 10 October 2026

- Generate natural speech through the existing OpenRouter connection. Let users edit the script, select a voice, declare multiple languages, and set delivery directions.
- Provide both a speaking-speed control and a total-length control. Preserve voice pitch when adjusting generated audio, and preview the result before adding it to the timeline.
- Explicit Generate shares the authored script and speech choices only. Reuse the saved OpenRouter connection and retain local ownership of the resulting audio; never upload source media.

## Project navigation — 10 October 2026

- Provide a workspace screen for navigating saved projects, alongside the existing editor.
- Keep the current project in the URL so reload, direct project links and browser Back/Forward restore the intended local project. Use a pinned router package where useful; routes must work on root and GitHub Pages hosting.
- Keep route, project loading and catalog state in focused React hooks consumed by components. The engine remains the canonical project owner. Explicit project URLs may reopen local editing on startup; the bare app URL remains inert. This supersedes the earlier session-only active-project navigation choice.

## Keyboard and mouse editing — 10 October 2026

- Audit common keyboard and mouse combinations across supported video-editing workflows. Ctrl/Command+wheel and trackpad pinch zoom the editing surface under the cursor with its content anchored there; timeline and preview views stay independent.
- Use familiar selection, clipboard, navigation, trim, history and view shortcuts with discoverable help. Preserve text entry, native controls and modal/menu interaction, and route edits through the shared engine.

## Speed editing — 10 October 2026

- Provide speed adjustments with either preserved audio pitch or pitch changing with speed.
- Provide customizable speed ramps that curve, rise/fall linearly, or step up/down. Allow direction changes and editable points.

## Mobile media — 11 October 2026

- Open the mobile Media tab as a full-screen page or sheet, with a clear close control, rather than a small floating dialog.

## Media cards — 11 October 2026

- Show local thumbnails for uploaded images and videos. Keep asset names and actions visible; disclose dimensions, duration and other metadata, including AI indexing guidance and labels, through accessible asset tooltips instead of inline text.

## Delivery and validation

- Pull and rebase onto current `main`, including the OpenRouter integration, before completing the workspace.
- Benchmark and profile test scheduling when optimizing it. Scale normal test concurrency dynamically with the machine’s available CPU and memory; use measured throughput and preserve resource isolation.
- Optimize tests for fast feedback. Prefer targeted tests while iterating and bounded parallelism where isolation allows it; retain required full acceptance before delivery. Do not trade away real Chrome, codec, transcription, privacy or export evidence for speed.
- Combine compatible Playwright user stories into a single named journey that reuses the already-open app and tab. Batch related journeys into one invocation and minimize browser instances. Reuse an existing secondary tab before opening another; when multiple tabs are necessary, operate on independent tabs in parallel within the resource budget and synchronize any shared-state operations explicitly. Keep fresh-state and heavyweight acceptance boundaries intact; see [the consolidation inventory](playwright-journeys.md).
- Target no more than two minutes for the complete normal `pnpm check` run. Reuse one Chrome process with resource-bounded concurrent isolated contexts/tabs rather than making browser-instance minimization force sequential execution. Preserve all assertions and real native gates; record actual timings and machine/load conditions. Unit allocation stays adaptive, and heavyweight transcription/performance remain separate serial gates.
- Add native Safari regression coverage alongside the Chrome acceptance target. Minimize duplicate builds/checks and unnecessary sequential waits; determine safe resource allocation dynamically from the machine and isolate shared outputs and heavyweight measurements.
- Keep agent instructions and developer documentation useful and current. Make one development cycle fast with clear module ownership, focused checks, verified build reuse, failure recovery, and one automatic review-and-address cycle; avoid redundant full checks or repeated reviews when the relevant inputs have not changed.
- Nest `AGENTS.md` files at directory and subdirectory ownership boundaries so instructions stay scoped to the code being changed. Keep the root brief and shared rules in parent guides; do not duplicate a full global guide in each module.
- Disable remote CI and run quality checks, browser acceptance, transcription and performance checks locally. Deploy GitHub Pages automatically on every push to `main`; do not re-enable hosted validation workflows.
- Keep these preferences recorded here and preserve merge approval. Automatic Pages deployment on `main` pushes is authorized by the user's 10 October 2026 request; manual redeployments retain their confirmation control.

## Assistant skills — 10 October 2026

- Start AI turns with a small tool surface. Instruct the agent to select skills by request domain and load guidance/tools incrementally as the workflow needs them. Do not expose every tool or service action up front. Preserve explicit user approval, context-sharing consent and supported-service checks when skills are loaded.

## Asset indexing and Klip — 10 October 2026

- Import never triggers indexing. Offer manual Index, progress, Cancel, explicit Retry, and Reindex for ready audio, video and image assets. The latest request includes audio-only indexing.
- A separate versioned consent choice in AI connection setup authorizes generated stills, audio excerpts and video excerpts with sound, to OpenRouter and saved labels in chat. Remember this choice locally; denial hides indexing and revocation aborts work and retires conversations containing labels. Retain saved outputs until explicit deletion. This newer choice permits derived evidence sharing while original files remain local.
- Detect every sampled shot locally without an LLM, at four samples per second using versioned pixel metrics. Cover representative visuals and motion peaks; process whole images with quality, colors and perceptual similarity. Region extraction, crop suggestions and OCR are deferred.
- Use the selected compatible chat model, with no fallback, dropped audio or automatic paid retry. Keep deterministic discovery distinct from nondeterministic model descriptions.
- Save all analysis, generated evidence, safe request manifests, returned text, normalized labels and previous runs on this browser/origin. Project JSON backups remain unchanged; index transfer is deferred.
- The latest choice is Klip (replacing the proposed Clippy name); name the assistant Klip and use an original film-cell mascot and matching LocalCut logo. Saved labels are untrusted observations; existing edit approvals remain required.

## Service providers — 10 October 2026

- Support named OpenAI-compatible endpoints alongside OpenRouter, with independent ordered provider/model routes for LLM, TTS and STT. Configured fallbacks authorize forwarding the same request to the listed providers in order; stop chat fallback after any visible output, and preserve edit approval.
- Offer Continue with ChatGPT, then ask the user to copy the full loopback redirect URL and paste it into LocalCut. Exchange the one-use authorization code for tokens; save tokens separately from portable preferences and use them for LLM calls. Disconnect removes the saved tokens. Compatible-endpoint API keys retain session-only behavior; OpenRouter keys follow the persistent credential choice below.
- Remember non-secret endpoints, capabilities, models, voices and routing choices locally and include them in the workspace preference backup group. Sharing consent and credentials stay outside backups. Indexing retains its dedicated OpenRouter evidence consent and no fallback.
- Local Whisper remains the default STT provider. Configured OpenAI-compatible STT endpoints join the ordered route; each transcription proposal discloses possible source-audio recipients before approval. Transcript-text sharing stays a separate opt-in.

## Persistent OpenRouter credentials — 10 October 2026

- Save pasted and OAuth-issued OpenRouter credentials locally in this browser/origin and restore the connection after refresh or navigation. This supersedes the earlier memory-only credential choices.
- Keep credentials separate from preferences, project data and all portable backups. Disconnect removes the saved credential; ordinary cleanup preserves it. Removing or replacing it in another tab retires the old connection.
- Restoring a connection may refresh the model catalog, but never sends chat, generates speech or indexes media automatically. Text/name/transcript sharing remains off after reload; conversations remain session-only. Active project restoration follows the newer project-routing choice above.

## Mobile usability — 10 October 2026

- Make the workspace look good and accessible on mobile, retaining the existing editor capabilities and local media ownership. Keep narrow-screen editing and conversation easy to reach with comfortable touch controls.

## Interface size and page zoom — 10 October 2026

- Keep the desktop timeline against the bottom of its editor at every interface size and browser zoom.
- Offer Default (100%), Small (75%) and Large (125%) under Settings → Appearance, remembered locally and included with appearance backups. Scale the complete interface, including popups and dialogs, while retaining editing/chat state and authored media geometry.
- Intercept page-delivered browser zoom shortcuts and gestures. Browser-menu zoom, saved site zoom and OS controls remain outside a static web app's authority; keep the layout correct when they change. Independent timeline and preview editing zoom remains available. This supersedes the older choice to leave browser zoom gestures active outside editing surfaces.

## AI settings and disclosures — 10 October 2026

- Keep AI settings in a larger dialog with more space between configuration sections; no separate routed settings page is requested.
- Adopt the configured shadcn Base UI Accordion and Collapsible components for expandable content. Animate expansion, collapse and indicators; respect reduced motion and preserve input, keyboard and focus behavior.

## Workspace resizing — 10 October 2026

- Use the shadcn Base Resizable component for chat, media, the central editor and the preview/timeline split. Keep dragging immediate and smooth; save deliberate sizes after the gesture, preserving responsive layouts and mounted editing/chat sessions.

## Workspace layout and identity — 11 October 2026

- Put search/Commands and Settings at the far right of the header. Move the AI connection dialog trigger into Settings → AI settings and remove the composer information button and intermediate provider popover. This supersedes the earlier composer entry-point preference.
- Put Media on the left, the editor in the middle and AI Chat on the right. Preserve the editing-first stacked layout on narrow screens. This supersedes the earlier right-side media preference.
- Dragging either sidebar below its collapse threshold collapses it to its edge rail. Preserve its expanded width and mounted content, remember deliberate collapse and keep reopening accessible.
- Keep a clean scissors logo for LocalCut and use a four-point star for Klip that follows the appearance palette/theme. Remove the film-cell mascot identity from the workspace and app icons.

## Loading and cached screens — 11 October 2026

- Use polished loading indicators that match the workspace layout and appearance, with accessible status labels and reduced-motion support.
- Render available cached results immediately and refresh them in the background. Retain visible content and usable navigation during refresh; use skeletons only when no content is available. Display caches never replace authoritative saved editing data.
