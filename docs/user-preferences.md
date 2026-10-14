# LocalCut user preferences

This is the project record of the user's durable product and workflow choices. Update it when the user adds or changes a preference; newer explicit choices take precedence over earlier ones.

## Single-base browser testing — 14 October 2026

- Do not repeat browser scenarios at both `/` and `/LocalCut/`. Run normal browser checks once at the deployed `/LocalCut/` base, including routing, callback and worker/asset-loading tests. This supersedes the older paired-path testing preference.
- Preserve genuinely different themes, viewports, provider failures, keyboard paths and cancellation/recording-stop cases as named fixture variants. Keep both build artifacts and configuration checks; a manually selected two-base diagnostic is optional and not a routine gate.

## Browser coding and original music — 14 October 2026

- Give the editing agent generic read, write, edit, glob, grep, shell and code-execution tools with access to a persistent project-owned directory. Keep execution entirely in the browser; no local companion or native computer-folder access.
- Allow arbitrary code-authored music composition, synthesis and DSP rather than a fixed musical preset schema. Retain source scripts and generated output for iteration, and import music through the shared Media/editor APIs. Describe actual runtime compatibility accurately.

## Browser-managed application updates — 14 October 2026

- Remove LocalCut's Check for update feature, including its header control, update prompt and deployment-check requests. Use Chrome's installed-app update controls. This supersedes the application-update control and prompt preferences below.

## Plain text goals, to-dos and reviews — 14 October 2026

- Return and retain goals, to-dos and completion assessments as ordinary text values. Do not enforce headings, checkbox syntax, JSON shapes, completion keywords or extract meaning from their content in application code. Formatting belongs in agent instructions and is advisory.
- Pass those texts verbatim into the main agent runtime. Let the main agent use them to decide what to do or whether to finish; keep action authority, cancellation, caller budgets and receipt preservation in their existing owners.
- Display the text in session popovers, history and completion details. Markdown rendering belongs only to the client; ordinary prose and literal markup must remain readable. Preserve the same strings through reload, forks and exports.
- This supersedes cleared-checklist gating, the FULFILLED completion marker and format-specific validation/repair. Retain the bounded completion-review lifecycle, without claiming a code-verified verdict from text.

## Persistent session goals, to-dos and quiet activity — 14 October 2026

- Maintain one goal per chat session. Before each submitted message, a separate read-only agent updates the existing goal with the newest information; retain prior intent unless the user changes it. This supersedes defining a new goal for every request.
- Suggest Markdown sections Goal, Success conditions and Stop conditions. Generate task notes after the first goal, refresh it asynchronously after every execution iteration, and revisit both at the next iteration and before stopping. Pursue the goal and required tasks while retaining cancellation, real blockers and the existing completion-check safeguard.
- Persist current goal/checklist and historical snapshots with the chat, including reload and forks. Render Markdown when supplied, and otherwise display ordinary text, in the history and in two icon-only chat-header popovers.
- Keep activity compact: defer sharing and action diagnostics to details, show loading with an icon and playful tooltip/accessibility wording, and retain cancellation and actionable errors.

## Immutable chat continuity — 13 October 2026

- Keep conversation messages, supplied context snapshots and returned tool results immutable. Retain stale results rather than deleting, redacting or rewriting them; never clear conversation history because media scope or saved indexes changed.
- Recompute fresh context for each turn. The assistant calls tools again when it needs current data. Historical results are observations at their captured state; current tool declarations, permissions and revision checks govern new actions.
- Preserve this history through cancellation, reload and forks within the same project/model/sharing scope. This supersedes automatic retirement of index-bearing narration and text-only restoration. Explicit new chats, branches, clear-history actions and connection/scope isolation retain their existing ownership.

## Proactive goal execution — 13 October 2026

- The main editing agent should proactively perform the supported work it judges necessary to fulfill the user's request. Use the independent goal/success/stop-condition session to keep execution focused; suggestions and offers cannot replace requested actions.
- Choose reasonable routine details within the goal and continue supported portions in the same turn. Ask only for missing information or material ambiguity that prevents a safe choice. Verify already satisfied work without rebuilding; optional improvements remain outside the goal.
- Retain the completion-check safeguard and existing approval, sharing, cancellation, paid-action retry and user-owned file/Save boundaries. These preferences govern a submitted editing request, not background work.

## Request completion checks — 13 October 2026

- Keep reviewer goal definitions and completion assessments as plain strings. Do not require JSON or a reviewer output schema. Preserve the text in the local trace; this supersedes structured reviewer output requirements.

- Maintain the persistent session goal, observable success conditions and stop conditions as described above. When execution proposes to stop, use a separate read-only LLM session through the selected provider/model to check fulfillment against current state and authoritative receipts.
- If unfinished, continue the same turn without replaying completed actions. Return after fulfillment, or report remaining work after three unsuccessful completion checks. Explicit cancellation, refusals and caller budgets still stop work; completion feedback does not authorize failed paid-action retries or bypass user-owned actions.
- Show the review session subtly through an expandable goal/check trace, outside normal tool activity. Retain the trace locally with the chat.

## Silent chat retries — 13 October 2026

- When a chat error escalates, show a play-icon Retry response button in the primary Send position. Retry the captured request without retyping; preserve completed actions. A new draft takes precedence as Send, and clearing it restores Retry.

- Automatically retry empty provider replies and other transient chat inference failures silently within the submitted turn. Keep the same model/provider, completed tool receipts and cancellation control; show an error only when recovery fails.
- Use a bounded retry policy. Do not replay already visible responses, permanent errors, refusals or failed paid tool/service actions. This supersedes manual-only retry for retriable chat inference failures.

## Provider-specific speech options — 13 October 2026

- Hide options unavailable to the selected speech provider instead of rendering disabled controls. Fish reference synthesis has no stock voice, language hint or delivery-directions control; keep supported local speed and length controls.

## Voice configuration management — 13 October 2026

- Make reusable voice management polished and usable, persisting model, voice, delivery, languages and timing/speed settings. Voice configuration is independent of transcript/script text; saving settings must not require or store a transcript.
- Keep explicitly saved speaker-reference recordings and their matching transcript in the separate reference owner; generation history retains its own scripts and takes.

## Speech phrase timing — 13 October 2026

- Always use the STT route configured in AI settings for generated-speech phrase timing. Remove the separate Phrase timing options section, including its heading, selector and explanatory/metadata text.
- Keep local model preparation explicit and preserve actionable timing recovery; never silently switch STT services.

## Speech generation form — 13 October 2026

- Default the voice preset picker to New voice preset and show its name field immediately beneath it. Keep Script as the last form input, align Speech model and Voice, and show descriptive voice labels alongside their names.
- Put a single searchable previous-generation picker in the dialog header, using persistent local generations. Offer Save to assets separately from Add to timeline.
- Show minimum/maximum length guidance from the script word count and a reasonable narration pace; distinguish estimates from the measured take's exact timing limits.

## Whiteboard images — 13 October 2026

- Support actual images in the Excalidraw whiteboard through both the interface and agent. Source asset IDs in text notes are insufficient; keep the images local and reusable across reloads and exports.

## Storyboard exports and agent workflows — 13 October 2026

- Enable local whiteboard exports and storing reusable renders as project Media assets. Provide comprehensive agent guidance for supported Excalidraw vector/text authoring, layout, grouping, layering, export and combinations with editing, evidence, transcripts, history and document handoff.
- Keep UI and agent workflows on the same shared editor owners, with local immutable assets and explicit user-owned file downloads.

## Timeline overlaps — 13 October 2026

- Indicate overlapping assets visually at the actual overlap span, without inline overlap/template text. Keep useful names and duration accessible on demand.
- Right-click or press and hold an overlap to open an options menu including Add transition. Preserve ordinary selection and provide keyboard access; transition templates remain explicit edits through the shared engine.

## Media folder breadcrumbs — 13 October 2026

- Keep Media's title and actions in the main header. When browsing subfolders, show the path in a separate breadcrumb subheader below it, with clickable ancestors and the current folder marked. Hide the breadcrumb row at the root.

## Single OpenRouter connection — 13 October 2026

- Allow only OpenRouter for remote AI. Remove OpenAI-compatible endpoints, ChatGPT sign-in and multiple provider accounts. The connection is binary: connected to OpenRouter or disconnected.
- Remove all backup service routes and provider priority controls for LLM, TTS and STT. A failed request stops without switching services. Preserve local Whisper as the default local transcription choice; an explicitly chosen remote transcription service uses only OpenRouter.
- Migrate old configuration to one retained OpenRouter account and its selections, preserving its credential namespace. Retire removed accounts' saved credentials and pending authentication; portable imports cannot revive them. These choices supersede prior multiple-provider, ChatGPT and fallback preferences.

## OpenRouter request management — 13 October 2026

- Pass session IDs into OpenRouter requests for better management, and follow applicable official integration best practices. Keep related conversation/tool requests grouped under the saved chat identity and audit the transport beyond chat alone.

## Mobile tab headers and scrolling — 13 October 2026

- Use a shared header pattern in Edit, Chat and Media: title inline with one horizontally scrollable button row, with standalone chevrons over shaded gray theme gradients where more actions exist. Do not wrap header buttons onto a second row.
- Put active tab headers at the top of the screen and keep them reachable while content scrolls. Make each tab easy to scroll from its broad content surface.
- Do not render mobile Media close or Chat collapse buttons; use the bottom tabs. Remove Media's Home icon; retain textual root navigation inside folders and Trash. This supersedes the earlier mobile Media close action and wrapped unified-header choice.
- Keep the Chat header still during composer focus and keyboard changes; resize content without changing the workspace positioning mode.

## Dialog structure and AI settings — 13 October 2026

- Separate visible dialog headers and action footers from their contents with horizontal dividers across the application.
- Select Providers, LLM - Chat, TTS - Speech and STT - Transcription from one dropdown inline with the AI connection heading, displaying the active section. This supersedes the earlier tab strip.
- Hide OpenRouter connection terms behind an inline information tooltip beside its account name, accessible by keyboard and touch.
- Confirm Disconnect before removing an account’s credentials or forgetting a disconnected account.

## Mobile tools — 13 October 2026

- Put the clip picker inline in the horizontal timeline toolbar with Undo and Redo, removing its separate row.
- Press and hold mobile tools to reveal their tooltips. A hold must not activate the tool; ordinary taps retain their actions.

## Media interaction — 12 October 2026

- Keep the asset drag preview close to the cursor.
- Support Cmd+A / Ctrl+A to select all assets in the focused media library, while retaining native text selection and timeline clip selection.

## AI settings tabs — 12 October 2026

- Divide AI settings into Providers, LLM - Chat, TTS - Speech and STT - Transcription tabs. Manage connections in Providers; expose a primary provider and ordered backup providers in LLM - Chat.

## Test coverage without duplicate work — 13 October 2026

- Remove repeated test setup, resource use and executions that add no distinct coverage. Keep deployment-sensitive paths and genuinely different fixtures, native media, privacy, fresh-start/reload, failure and cross-tab assertions.
- Run identical path-independent behavior once, reuse fixture-owned engines and valid immutable assets, and retain explicit diagnostics for the full deployment matrix. Measure affected cases and state the limits of timing evidence.

## Test allocation and runtime — 12 October 2026

- Target under five minutes for the full normal local test run using broadly applicable improvements and best practices. Preserve correctness, production Chrome codecs, privacy, transcription and export acceptance.
- Be generous with dynamic worker allocation, with no fixed worker ceilings. Follow current CPU/memory and container limits; avoid routinely narrowing healthy runs to a small worker count. Keep separate native transcription/performance measurements serial.

## Chat execution — 12 October 2026

- Preserve conversation continuity across interruption and reload for any follow-up message. Use retained context and the user's latest intent; do not special-case particular continuation phrases.
- Infer authorization from the user's request and context. Execute requested editing, history, indexing, export and transcription work without Apply/Approve/Discard cards or a second confirmation.
- Use best judgement to ask an ordinary text question only when information is missing or the intended outcome is ambiguous. Do not double-confirm already requested work because it has cost or consequences.
- Keep sharing choices, original-media boundaries, cancellation, authoritative results and explicit file Save. A failed paid action needs a new user retry request; it must not retry silently.
- This supersedes earlier workspace chat approval-card and explicit edit/service proposal-approval preferences. Headless integrations retain their default reviewed proposal API.

## Header navigation — 12 October 2026

- Put Editor and Storyboard (whiteboard) tab triggers at the far right of the project header, after the global actions, retaining left-aligned contents and their existing order.
- Remove the chevron from the active project name; the name still opens the project-switcher dialog.
- Render the LocalCut logo as static branding without a navigation link. This supersedes earlier LocalCut home navigation; Settings → Project → Open project and Mod+O retain access to the Projects screen.

## Storyboard toolbar — 12 October 2026

- Replace the plain whiteboard loading message with a theme-aware canvas/toolbar skeleton, retaining an accessible status and reduced-motion support.
- Remove the separate Storyboard heading row. Place icon-only Undo and Redo in Excalidraw's main drawing toolbar, with accessible labels and tooltips; retain shared project history.

## Chat agent capability discovery — 12 October 2026

- Fix premature refusals at the shared capability-discovery layer across every domain, rather than special-casing an indexing symptom. Keep a complete, current capability map and actionable recovery when a skill is unloaded, sharing is disabled or a host service is missing. Continue supported portions of compound requests. Maintain scoped agent guides and AI documentation alongside runtime prompts and skills.
- Make chat indexing and other supported workflows discoverable through accurate agent guidance. Distinguish supported features from disabled sharing, missing connections and pending approval; explain the concrete next step instead of denying a feature because its domain tools are not loaded. Keep existing consent and approval boundaries.

## Chat export — 12 October 2026

- Provide chat-session export as an icon in the chat UI header, outside the primary application header. Use the existing task queue for local archive generation and saved downloads.

## Dialog sizing — 12 October 2026

- Size every dialog to its task and content: compact forms and confirmations should not leave large empty areas, and richer editors need enough room. Keep all dialogs bounded by the viewport with internal scrolling; the project browser retains a stable browsing height. This supersedes the earlier blanket fixed-height dialog choice.

## Product foundation

- LocalCut is a client-only web video editor that builds into thin static assets, including deployment under `/LocalCut/` on GitHub Pages.
- Use React, TypeScript, Vite, shadcn components built on Base UI, the neutral Vega foundation, and Tailwind CSS. Use system fonts by default; the appearance font choice below shares the locally served text catalog.
- Keep media processing, original files, editing data and speech transcription local. Optional OpenRouter reasoning can receive explicitly shared text and metadata; it must not upload source media.
- Target current stable desktop Chrome first. Default to 1920 × 1080 at 30 fps and 48 kHz stereo; support MP4/H.264/AAC and WebM/VP9/Opus only after actual browser capability checks.
- Use IndexedDB and OPFS for local persistence. Local editing needs no account or server, and transcription model downloads require explicit preparation.
- People and browser agents should use the same inspectable editing engine, stable document IDs, commands, revisions and errors.
- The original blank application boundary ended when the user approved building the AI-first workspace from the collaborative mockup. Keep the editing conversation easy to reach alongside the preview and timeline.

## Workspace refinements — 10 October 2026

- Put less-frequent header settings in a dropdown. Organize them into named groups that progressively unfold, rather than showing every setting at once.
- Keep OpenRouter connection and model controls in the chat interface. The selected provider remains visible there. Connection requires the user's credentials/consent; save credentials locally as specified below and do not initiate paid requests automatically.
- Make chat narrower and collapsible. Animate the chat moving out/in and the main editing area expanding/contracting together. Preserve the conversation when collapsed, support keyboard control, and respect reduced-motion preferences.
- The newer mobile tab choice below supersedes the earlier stacked narrow-screen layout.
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
- Reveal optional OpenRouter sharing through a Data & analytics popover, with all choices off initially. Keep credentials in their separate local record and source media local. The OpenRouter context terms choice below supersedes the separate sharing controls and reload reset.
- Put the model/provider information behind a small icon in the composer footer, revealing configuration progressively. Use the CYOBot instructor chat's searchable session switcher, transcript, and rounded composer structure.

## Chat controls — 10 October 2026

- Match the new-chat plus button height to its search field. Reuse an unused chat on repeated clicks while preserving conversations and drafts.
- Keep the composer squarer, using the same design-system corner token as other controls and respecting appearance customization.

## Appearance customization — 10 October 2026

- Provide an appearance section inspired by shadcn Create. The actual workspace is the live preview, and appearance preferences survive reload locally in the browser.
- Keep the existing Base UI and Lucide foundations. System font stacks provide body/heading choices without downloading fonts. Appearance changes must preserve the active editing session and conversation.

## Appearance font choices — 12 October 2026

- Offer the complete text-editor font catalog for body and heading appearance, including the fonts already served locally. Search names and style/language tags; load only the selected families from the application origin. Preserve heading inheritance and browser-local persistence. This supersedes the earlier system-only appearance restriction; appearance and authored text keep independent selections.
- Remove the “Your workspace is the preview.” subtitle from appearance settings.

## Local user preferences — 10 October 2026

- Persist chat sidebar width as a local browser user preference; restore the preferred width across reloads and temporary responsive/layout constraints.
- Audit all configurable UI state and use judgement to remember durable choices. Save chat collapse, deliberate media visibility, export format and preferred AI model alongside appearance. Keep authored project data in its existing storage and temporary navigation/operation state in the session.
- Keep preferences local to the browser/origin. Remembering a model does not authorize reconnecting, paid requests or sharing content; credentials use their separate persistent local record; the later OpenRouter context terms choice supersedes session-only sharing consent. Indexing authorization follows its later connection choice.

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
- Keep workspace appearance fonts separate from authored text styles. The 11 October bundled-font choice below supersedes the original system-only text-library restriction.

## Timeline editing and transition templates — 10 October 2026

- Provide audio separation from video, clip group/ungroup, and transition controls for overlapping visual clips on one video track.
- Treat transitions as editable templates built from base attributes. A user can request a template in chat and the assistant can inspect and fine-tune its ordinary keyframes for a better result. Keep the resulting edits inspectable through the shared engine.

## Timeline tracks — 11 October 2026

- Put an icon-only plus control beneath the last timeline track. Clicking it reveals side-by-side plus-and-audio and plus-and-video buttons. Allow additional empty tracks without media or AI, and let users drag tracks vertically to reorganize layers.

## Track operations — 11 October 2026

- Put common track operations, including disable and rename, behind a compact per-track menu. Provide enable/disable, rename, mute, solo, lock, duplicate, move, clear clips and delete, and make all authored operations available through the assistant's editing tools/skill.

## Text to speech — 10 October 2026

- Generate natural speech through the existing OpenRouter connection. Let users edit the script, select a voice, declare multiple languages, and set delivery directions.
- Provide both a speaking-speed control and a total-length control. Preserve voice pitch when adjusting generated audio, and preview the result before adding it to the timeline.
- Explicit Generate shares the authored script and speech choices only. Reuse the saved OpenRouter connection and retain local ownership of the resulting audio; never upload source media.

## Project navigation — 10 October 2026

- Provide a workspace screen for navigating saved projects, alongside the existing editor.
- Keep the current project in the URL so reload, direct project links and browser Back/Forward restore the intended local project. Use a pinned router package where useful; routes must work on root and GitHub Pages hosting.
- Keep route, project loading and catalog state in focused React hooks consumed by components. The engine remains the canonical project owner. Explicit project URLs may reopen local editing on startup. The 12 October recent-project choice below supersedes the inert bare-URL behavior when a recent project is saved. This supersedes the earlier session-only active-project navigation choice.

## Project creation format — 11 October 2026

- Let users configure project dimensions, aspect ratio, resolution and frame rate when starting a project. Retain 1920 × 1080 at 30 fps as the default; provide presets and editable pixel dimensions through the shared project creation API.

## Project cards — 11 October 2026

- Present saved projects as a responsive card list with thumbnails and accessible contextual actions for rename, thumbnail adjustment, archive/restore and backup export.
- Keep the Active/Archived switch beside the Projects title in the page header, wrapping within that header on narrow screens.
- Archive reversibly, retaining edits, versions and originals. Keep custom thumbnails local and support framing adjustments.

## Keyboard and mouse editing — 10 October 2026

- Audit common keyboard and mouse combinations across supported video-editing workflows. Ctrl/Command+wheel and trackpad pinch zoom the editing surface under the cursor with its content anchored there; timeline and preview views stay independent.
- Use familiar selection, clipboard, navigation, trim, history and view shortcuts with discoverable help. Preserve text entry, native controls and modal/menu interaction, and route edits through the shared engine.

## Speed editing — 10 October 2026

- Provide speed adjustments with either preserved audio pitch or pitch changing with speed.
- Provide customizable speed ramps that curve, rise/fall linearly, or step up/down. Allow direction changes and editable points.

## Timeline drag feedback — 11 October 2026

- Drag clip ends to shorten or extend them. Timed media repeats from its selected source beginning after reaching the end, with clear loop-back markers.
- Drag imported media onto compatible timeline tracks; show its prospective position and duration as a placeholder before release.
- Show a compact asset preview beside the cursor throughout the app during an active media drag, including outside timeline tracks. Retain the timeline placement placeholder as well. (12 October 2026)
- When reordering tracks, move the entire track, including its title, with the cursor. Animate the destination placeholder and surrounding tracks into their proposed positions; respect reduced motion and commit only on release.

## Timeline seeking — 11 October 2026

- Remove the separate scrub bar below the timeline tracks. Seek by dragging the top of the playhead, with a comfortable touch target and keyboard access.

## Timeline snapping and editing feedback — 11 October 2026

- Default timeline playhead snapping on, let users turn it off, and remember the choice locally. Snap to useful nearby clip boundaries across tracks and project edges.
- Direct editing tools rely on their visible results: avoid success toasts for cutting, trimming, property changes, history, grouping, track changes and other apparent edits. Use Sonner for errors, background/queue notifications and actions without immediate visible feedback.

## Mobile workspace tabs — 11 October 2026

- Show only the currently active Edit, Chat or Media view on mobile. Preserve editing, conversation drafts and media jobs while switching tabs.
- Give the active tab a clear indicator with smooth, polished animation and reduced-motion support. Keep mobile navigation separate from remembered desktop collapse/visibility preferences.
- Media fills the mobile content area with its close action returning to the previous tab; the header and tab bar stay reachable. This supersedes the earlier full-screen sheet presentation.

## Mobile media — 11 October 2026

- Media uses the full width and available height between the existing header and tab bar. Keep the project selector inline in that header, without a separate row.
- Allow vertical touch scrolling directly over media cards and thumbnails. Keep image/video thumbnails visible and show a passive indicator for indexed assets.
- Include videos in manual indexing. Image-input models can explicitly index representative video frames; video-input models can label generated clips with motion and sound.
- Dropdowns and other interactive popups appear above Sonner notifications.

## App and popup scrolling — 11 October 2026

- Keep the main app anchored to the viewport. Scroll workspace content inside its panels, including the active mobile view, so dialogs and dropdowns cannot move the page behind them.
- Give dialogs a fixed height bounded by the viewport and scroll overflowing content inside them. Keep dropdown scrolling contained within the popup and retain hidden scrollbars.

## Media cards — 11 October 2026

- Show local thumbnails for uploaded images and videos. Keep asset names visible; disclose dimensions, duration and other metadata, including AI indexing guidance and labels, through accessible asset tooltips instead of inline text.

- Put every asset action in an absolute top-right overflow menu revealed on hover or keyboard focus, with a visible touch trigger. Use clear indexing/results icons and offer rename, delete and missing-source relink there. This supersedes visible inline card actions.

## Asset import — 11 October 2026

- Uploaded assets belong only to the project Media library. Do not create tracks, clips or timeline edits during file/folder upload; timeline placement requires an explicit action. (12 October 2026)

- Accept asset files dropped on the Media tab or anywhere over the app, with a visible acceptance indicator while files hover.
- Show import progress and results for every asset in the batch. Enqueue all selected assets up front. The progress dialog is informational: keep it open after completion, allow dismissal while work continues, and offer only Okay and the top-right X as buttons.

## Timeline media previews — 11 October 2026

- Show image/video thumbnails inside visual timeline clips and real waveforms inside audio clips. Keep clip names, selection and touch/keyboard editing readable and usable. Generate these previews locally through the shared editor APIs.

## Screen recording guidance — 11 October 2026

- Show browser-specific shared-audio limitations when users enable shared audio, before choosing a capture source. Explain silent recording and a supported browser-tab audio workaround when audio is unavailable; keep microphone permission separate.

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
- Restoring a connection may refresh the model catalog, but never sends chat, generates speech or indexes media automatically. Text/name/transcript sharing remains off after reload; the newer persistent chat choice below supersedes the original session-only conversation lifetime. Active project restoration follows the newer project-routing choice above. The OpenRouter context terms choice below supersedes the separate sharing controls and reload reset.

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

## Screen recording — 11 October 2026

- Create new local media by recording screens and app windows, with browser tabs available through the browser's source picker. Keep explicit source permission and use the existing local import, editing and persistence workflow.

## Bundled fonts and animated text — 11 October 2026

- Expand authored text with as many redistributable fonts as practical, bundle the assets, and tag them for search by name and style/language. Keep the old text styles compatible and application appearance separate.
- Remove “Local system fonts; the available typeface depends on your device.” from the Add text dialog.
- Offer editable animated text templates, including typing and cute handcrafted loops that cycle through three, four or five variations. Preview and exported video must share the same animation.

## AI Connector — 11 October 2026

- Allow removing OpenRouter from configured providers, remember that removal, and offer an explicit way to add it again.
- Retain deliberately configured service routes and models. The newer AI provider settings choice below supersedes the earlier connected reconnect/key-replacement controls.

## Compact editor controls — 11 October 2026

- Reserve space for the editing workspace: compact the header and use an icon-only Add text control with accessible labels/tooltips. Move Versions into Settings → Project and video export into Settings → Export; remove their separate header buttons.
- Remove the media import helper sentence and the separate import/backup button row. Use the shadcn Empty component for the outlined, icon-only import card in the media grid, including its empty state. Give upload a distinct raised icon tile, tinted surface and stronger dashed border; keep the whole card clickable. Keep backup under the grouped settings menu. Arrange media left-to-right, top-to-bottom, with the import card last. Place screen recording alongside the Media title and add a horizontal divider beneath the header.
- When no configured chat provider is available, use the shadcn Empty component with a centered provider icon, a framed surface and a Connect provider button instead of the composer and unavailable send/media controls. Remove the “Connect provider first” sentence. Apply this to all supported providers, including OpenRouter and compatible endpoints.

## Open-source documentation — 11 October 2026

- Keep README sections short, including setup and browser support. Link to longer setup instructions and the relevant detailed guides instead of embedding command tables or extended compatibility notes.
- Maintain newcomer-facing README, contributor, deployment, support, security, community and maintainer guidance so LocalCut is approachable as an open-source project. Keep the technical contracts accurate and connected through a documentation index.
- License LocalCut's original code and documentation under MIT. Preserve separate third-party, font, model and fixture licenses/notices.

## SemVer and changelog — 11 October 2026

- Adopt Semantic Versioning with the current application at `0.1.0-alpha.1` (the latest alpha correction). Use version-based changelog entries and the release policy for future bumps.
- Keep changelog summaries short and understandable to executives and end users. Link each summary to its full changelog: the Git diff for that version/candidate.

## Object animation and asset instances — 11 October 2026

- Keep source assets immutable editing inputs. Each timeline placement is a separate instance with its own authored properties and keyframes; editing one placement must not change other placements of the same asset. Commands create new document snapshots and preserve earlier snapshots.
- Provide keyframe animation for individual timeline objects through the shared engine, with the same result in preview and export.

## Complete agent editing access — 11 October 2026

- Every new editing feature must be accessible to the assistant when delivered. Keep discovery, inspection, domain guidance, canonical validation/proposals, explicit approval and regression coverage aligned with the UI/shared engine. Audit existing features exhaustively and maintain the [feature-access inventory](ai.md#editing-feature-access-inventory) and [development requirement](development.md#keep-agent-access-complete) with future changes. Preserve immutable asset/instance ownership, sharing consent and the existing user-owned file/service boundaries.

## Chat and durable tasks — 11 October 2026

- Move text-to-speech generation into Media and explain the action through a tooltip.
- Show collapsible tool activity above assistant text. Reveal copy, branch and response-details tooltip actions on hover/focus, with reachable touch controls. Branch through the selected completed response into a separate chat; preserve the original conversation and require fresh edit approval.
- Remove the composer context pointer, align send/stop at the far right, and provide explicit dictation plus dragging local image references into the draft. Source pixels stay local.
- Keep assistant replies short and concise. For broad requests, lead with a brief high-level answer; expand into details when asked.
- Remove the speech-dialog provider metatext. Use one persistent local queue for long-running work, with a public status-polling API, bounded safe retries and visible error escalation. Closing the speech dialog keeps generation running. Persist submitted requests and completed takes across refresh; interrupted remote submissions need explicit retry to avoid duplicate charges. The user selected this local approach over a hosted job service.
- Retain completed speech audio so identical takes can be reused and retimed locally. Do not imply that a preset voice or unavailable provider seed guarantees identical regeneration.

- Let users save an auditioned favorite voice for future scripts and manage it through selection, rename, archive and restore. A saved voice retains its original recording and matching transcript locally, then explicitly sends that reference through a supported OpenRouter cloning model on Generate. Saving settings alone does not satisfy this choice. Do not imply that a seed locks voice identity or guarantees identical generated output.

- Store measured word or phrase timestamps with generated speech so later chat agents can use that context to edit. Retain the authored script and synthesis identity alongside the timing; keep transcript sharing separately controlled. Provide modest editing padding around phrases, with no overlapping ranges; continuous boundaries are acceptable.

## Timeline movement and playback controls — 11 October 2026

- Drag existing clips within a track and across compatible tracks with mouse or touch, with placement feedback before release.
- Use different icons for enabled and disabled control states, including snapping and multiple selection.
- Put first-frame and last-frame navigation in the same row as previous frame, Play/Pause and next frame.

## Mobile chat and speech placement — 11 October 2026

- Hide bottom navigation while the mobile chat composer is focused. Keep the active tab heading at the top while the transcript/composer fit above the keyboard. Remove the duplicate LocalCut header on mobile; retain global controls in the active tab heading.
- Remove the inert pointer/context indicator; retain selected-clip context automatically.
- The original 256,000-token context cap, 192,000-token compaction threshold and minimum model-context filter are superseded by the 12 October no-cap choice below.
- Put the text-to-speech synthesis entry point in Media, reusing the shared provider connection and explicit Generate consent. This supersedes the chat-header speech entry point.

## AI provider settings — 11 October 2026

- Use searchable dropdowns for provider selection in each LLM, TTS and STT service. Offer connected providers only, state when none are connected, and retain Local Whisper as an independent STT option.
- Make provider connections collapsible like service configuration, with subtle horizontal dividers between sections.
- Keep connected provider management compact with Verify, Disconnect and Remove. Disconnect clears credentials while retaining configuration; Remove also clears its service routes. Remove reconnect, connected/key metadata and API-key replacement controls.
- Choose LLM models inside service configuration; do not ask for a duplicate model in connection setup.
- Allow multiple named accounts for each provider type, including OpenRouter and ChatGPT. Isolate each account's credentials and service routes.
- Keep ChatGPT callback instructions in an accessible tooltip. Label saved-account activation Connect.

## Compact media, provider and chat controls — 11 October 2026

- Put the task queue first in the main header's right action group. Keep speech generation inline in the media header's right action group.
- Keep provider Verify and Disconnect as icons at the right of each connection row; use a green check beside Verify for success and omit the removal icon and success prose. Open the Add provider form in a popover.
- Offer searchable provider-specific STT and TTS model choices instead of route model text fields; omit redundant STT provider/transport metadata from settings.
- Put dictation directly before Send at the right of the composer; an empty composer shows dictation in Send's position. Center useful initial guidance in an empty chat.

## Chat output policy — 11 October 2026

- Do not cap editing-chat output responses in LocalCut. Leave output token limits to each provider/model instead of imposing a fixed 4k, 16k or 32k allowance, and accept long response text and hidden reasoning. The newer no-cap choice below supersedes context compaction; retain explicit proposal approval, privacy, terminal validation and explicit retry behavior.

## Chat interruptions — 11 October 2026

- Pause unfinished assistant responses gracefully when navigating away from chat. Expected navigation interruption must not display an error; show Resume as the primary composer action on return while the draft is empty. Typing changes it to Send, and clearing the draft restores Resume. Resume explicitly restarts the paused request without requiring a follow-up message.

## Task queue and notification pagination — 12 October 2026

- Use shadcn tables for both Task queue and Notifications. Paginate with numbered controls in the form `< 1 2 … n-1 n >`.
- Use standalone left and right chevrons over a shaded gray gradient to scroll overflowing columns, with theme-aware colors, accessible targets and keyboard focus.

## Task queue table — 11 October 2026

- Render the task queue using the shadcn Base table. When columns overflow horizontally, show shaded left/right chevrons only in directions with more content; clicking moves one column in that direction. Render standalone chevrons without visible button boxes over a shaded gradient using theme colors; retain accessible click targets and keyboard focus.

## Project switcher dialog — 11 October 2026

- Open the header project-name switcher in a dialog over the current editor, including on mobile. Dismissing it preserves the current route and editing state; selecting another project updates its URL. This supersedes the earlier routed-screen choice for the project-name switcher. LocalCut home and direct catalog links retain the Projects screen.

## Application updates — 11 October 2026

- Add an icon-only Check for update control at the top right of the main header. When a later deployed commit is available, prompt the user to update; reload only after the user chooses Update now.

### Update prompt — 13 October 2026

- Show only “Update available” with the existing Later, Update now and Close controls. Remove the explanatory paragraph and keep one horizontal divider between the title and actions.

## Reusable computation — 11 October 2026

- Persist expensive reusable computed results locally once produced; refreshing or reopening must reuse valid results instead of recomputing, including audio waveforms. Audit other derived media/analysis values too.
- Enforce this principle in development documentation and agent guidance, with versioned source/parameter identity, correct invalidation and refresh regression evidence.

## Automatic chat titles — 11 October 2026

- After the first submitted message in a new chat, generate its title asynchronously through the same configured chat model and provider routes. Sending that first message authorizes this additional naming request; never name chats on startup, reconnect or navigation.
- Animate the returned title as a polished text replacement, respecting reduced motion. Keep the reply independent, retain a first-message fallback on failure and name each fresh chat only once.

## Empty provider setup — 11 October 2026

- Start AI provider settings empty, without a default OpenRouter placeholder. After adding OpenRouter, ask whether the user already has an API key or wants to log in and generate one. Reveal the key input only after choosing the existing-key path.

## Connector dropdowns — 11 October 2026

- Use a dropdown of the selected TTS model's catalog voices in AI connector settings, rather than a raw voice text field.
- Remove blank space above populated dropdown options across the app; empty-result messages retain their normal readable spacing.

## Project storyboard — 11 October 2026

- Put Editor and Storyboard tabs in the main project header. Editor contains the preview and timeline; Storyboard presents a project-owned Excalidraw diagram branded as the project's storyboard.
- Give the editing agent the ability to inspect and work on the storyboard through the same shared engine and explicit edit approval used for timeline work.

## Chat asset indexing — 11 October 2026

- Let the chat agent index assets through the existing shared indexer. Keep remembered indexing consent and explicit proposal approval, disclose derived-evidence sharing and possible cost, and reuse progress/cancellation and saved local results.

## Error details and notification history — 12 October 2026

- Every error toast offers a stack-trace icon opening the full available stack and relevant session diagnostics. Include an icon-only copy action with a temporary check mark after successful copying.
- Keep a persistent local history of all notifications, including informational toasts. Use a standalone bell icon at the top right of the main header, without a visible button box, and a dot for unread notifications. Opening history clears the dot; dismissed errors remain available with their original full report.

### Error code view — 13 October 2026

- Render the full available stack trace and session report in a selectable code view, preserving lines and scrolling. Remove the repeated task-summary subtitle and “Stack trace and session data” metatext from the details dialog.
- Display original error messages and stacks with nested causes as supplied, rather than storing hardcoded safe messages or replacing unknown messages. Keep credential/callback redaction. This supersedes the earlier safe-message allowlist; do not collect extra provider/project data for diagnostics.

## Chat skill activity — 12 October 2026

- Label skill-loading activity “Load skills” in the plural. Show the specific skill name in each tool row, such as “Load skills: Indexing · Completed”, instead of a generic completion label.

## Project header and startup — 12 October 2026

- Show Editor and Storyboard as accessible icon-only tabs in the top project header, including mobile; remove their separate subheader.
- Remember the most recently opened project locally and reopen it when the app starts at its bare URL. Explicit project/catalog links retain priority; a fresh browser without a saved recent project remains inert.

## Layered task caching — 12 October 2026

- Apply cache admission to every new task. Read valid cached results before enqueueing; on a miss, persist the cache claim and inputs before scheduling. Write newly computed results before reporting completion.
- Use multiple local layers: the existing artifact/result owner, in-memory queue lookup and durable queue claims/results. Matching reusable requests share in-flight work across tabs and reuse valid completed results after reload. Keep source/version/parameter invalidation and explicit action/consent boundaries.
- Declare each task's reuse policy or concrete fresh-work reason through the shared queue, following [the development contract](development.md#persist-reusable-computation).

## Persistent chat sessions — 12 October 2026

- Persist chat sessions locally in the existing workspace system, including titles, messages, branches, drafts and selection across refreshes and returning to a project. Preserve current sharing/approval boundaries and require explicit Send for further model work.

- Allow renaming chat titles, archiving/restoring sessions and creating independent session forks in the existing chat picker. Preserve local persistence and explicit model-request boundaries.

- Keep chat session actions subtle and icon-only, with accessible names and tooltips.

## Assistant caps — 12 October 2026

- Remove all default caps and hard application ceilings from editing chat: rounds, tool calls/payloads, operations/proposals, retained history/context, request/response size, composer attachments/typed or dictated text, chat naming and default chat duration. Do not force a final response because a LocalCut budget was reached, truncate activity details, or exclude tool-capable models by context size. The previous context-compaction preference is superseded. Providers/models determine their own capacity; retain cancellation, privacy, valid editor data, complete terminal validation, explicit proposal approval and manual retry.

## Asset capture context — 12 October 2026

- Preserve embedded photo capture/video recording dates and locations on upload. Retain them with asset metadata, give indexing that context and let the editing agent discover them through the shared inspection tools. Unknown dates/locations stay unknown; never substitute upload or file modification time.

## Dialog opening responsiveness — 12 October 2026

- Remove the first-opening delay across workspace dialogs. Show lightweight opening feedback immediately, retain an accessible loading shell while optional code arrives, load command metadata and UI together, and separate heavy text/clip editors from simple forms. Preserve on-demand engine/provider boundaries, cancellation, focus return and the startup bundle budget.

## Indexing authorization — 12 October 2026

- Remove the separate Allow asset indexing permission. Connecting OpenRouter acknowledges the indexing disclosure and authorizes generated evidence and saved labels in chat. This supersedes the remembered/revocable indexing permission recorded above.
- Keep indexing explicit through Index or an approved chat proposal; connection, import and reload never start paid indexing. Text, names, transcripts and capture dates/GPS keep their separate sharing choices. The OpenRouter context terms choice below supersedes the separate sharing controls and reload reset.
- Indexing authorization must not split or hide saved chats. Recover conversations from both legacy indexing-permission scopes, preserving drafts, titles, archives and selection while retaining the other project/model/sharing boundaries.

## Creative editing features — 12 October 2026

- Add LUTs/color presets, audio editing, video blending and masking, with UI and assistant access through the shared engine.
- Include advanced tools in this release: automatic local mask tracking with editable motion points, chroma key/spill controls and local audio noise reduction, alongside .cube import, EQ, balance, fades and geometric masks.

## Media folders — 12 October 2026

- Give every project a different app-owned root directory, keyed by its stable project ID. Folder contents, navigation, revisions and Trash belong to that project.
- Organize Media as real folders in the browser-private filesystem, with a fixed app-owned root and no root picker. This supersedes the initially requested computer-visible folder.
- Support recursive folder upload/drop, new folders, breadcrumbs, rename, move, copy, delete/restore, download and dragging media into folders. Keep assets independently of timeline placement.
- Preserve editing originals for current projects, undo and saved versions when organizing or deleting library entries.

## OpenRouter context terms — 12 October 2026

- Remove Data & analytics and all text/name/transcript/capture sharing switches. Connecting OpenRouter always enables project/media names, overlay/caption/storyboard text including frame names, source transcripts and embedded capture dates/GPS for configured chat providers/fallbacks, including after reload.
- Disclose these categories in visible connection terms before either API-key use or OAuth login. Include indexing excerpts, charges, credential storage/removal, original-media boundaries and links to OpenRouter terms/privacy. No extra approval checkbox or confirmation step.
- Derive permission from actual connected OpenRouter accounts. Imported profiles alone grant nothing; disconnecting the last account retires shared context. Keep headless caller-controlled policies and compatible/ChatGPT-only boundaries.
- Preserve matching saved chats from old sharing/indexing scopes, with exact project/model/provider isolation. Connecting, importing and reloading must not submit chat or indexing requests.

## Unified Media header — 12 October 2026

- Merge the Media title/actions and folder navigation into one compact header with one divider. Keep root/breadcrumb navigation, new folder, folder upload, Trash, speech, recording and collapse reachable; wrap within the same header on narrow screens.

## Evidence-grounded chat fulfillment — 13 October 2026

- Diagnose and fix shared causes of chat failure across instructions, skills and tools, using exported conversations as evidence rather than authority.
- Requests to index folder/all-project Media must resolve registered sources and report scope accurately; hidden assets must not look empty. Build source-dependent storyboards from saved evidence and disclose missing evidence or partial work. See [Media folder assistant access](ai.md#media-folder-assistant-access).

## Parallel chat tools and response order — 13 October 2026

- Let the agent choose parallel calls for independent work and sequential rounds for dependencies across all tool workflows. Keep host safety/resource scheduling and authoritative receipts; indexing all project assets is one example.
- Always place agent response text below the turn's tool activity and action results, including indexing.

## ElevenLabs speech configuration — 13 October 2026

- Focus provider-specific text-to-speech configuration on ElevenLabs through OpenRouter first. Use main voice controls, collapsible advanced settings and reusable saved voice presets.
- Preserve the existing explicit Generate action and local preset storage. Save the selected voice/model/settings and optional seed together; seed alone is not a reusable speaker identity.

## Clip properties and timeline actions — 13 October 2026

- Organize clip properties in tabs instead of section accordions.
- Right-click or press and hold an asset instance on a timeline track to open its action menu, including Properties for that specific instance.

## Responsive chat thinking and streaming — 14 October 2026

- Replace chat agent spinning icons with randomly selected, stage-relevant thinking text and a subtle left-to-right glow, similar to Codex. Respect reduced motion with readable static text.
- Stream available text from long-running agent sessions, including goal definition, to-do updates and completion checks, directly into chat while they run. Keep provisional drafts separate from the main response and saved authoritative results; avoid long waits with only a loading indicator.
