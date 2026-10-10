# Workspace

The interface follows the approved conversation-led mockup: resizable conversation on the left, preview and compact timeline in the center, and an independently collapsible media library on the right. Small screens stack the preview above the conversation and open media as a right-edge drawer. Production contains no illustrative clips, simulated replies or fake export progress.

The narrower chat can collapse into a rail while the editor expands, and returns with its conversation intact. Both regions animate together and respect reduced motion. OpenRouter connection/model settings sit behind the information icon in the composer footer. It reveals the current provider/model, then Configure AI opens the connection dialog. The header settings menu reveals Project, Workspace, View and Export groups progressively and includes Appearance; media stays reachable from its right-edge toggle. Supporting metadata lives in tooltips and disclosures. Durable design choices are recorded in [user preferences](user-preferences.md).

Chat follows the CYOBot instructor workspace's interaction structure: session picker, scrolling transcript, right-aligned user bubbles, plain assistant replies, tool disclosures, approval cards, and a growing composer using the same corner radius as other controls. Tool disclosures expose each call's bounded input, result or error separately, subject to the same sharing policy as its remote context. Enter sends; Shift+Enter inserts a newline. IME composition and repeated Enter do not submit. Stop cancels the active turn, and scrolling up reveals a return-to-latest control. The header session picker searches chat titles, reuses an unused chat or creates one when every chat has messages or a draft, and restores each chat’s transcript and unsent draft. Switching is disabled while a response or approved operation is running. Sessions are local to the current connection/project/model/sharing policy and are not saved across reloads. Chat resizing is available above 900px; narrower layouts use a fixed responsive width.

## Project navigation

Select the project name in the header, LocalCut home, Settings → Project → Open project, or Mod+O to open the Projects screen. Search saved names, then select a project to open it in the editor. Projects are sorted by name and show clip count and timeline duration; the active project is marked Current. New project and Import backup reuse the existing flows. Workspace/project ZIP imports remain available through settings and Commands.

Back to editor or selecting the Current project preserves the current selection, playhead, version preview and conversation. Browsing pauses playback and hides the mounted editor from keyboard/accessibility interaction. Opening another project flushes the current project's pending version, resets selection/playhead and clears any previous video download. Project events refresh the list across windows; Refresh projects retries failed loads and picks up saved changes. Initial page navigation remains inert: project storage and editing services initialize only after an explicit create/open/import or browse action. This screen does not delete, rename or migrate projects.

## Local user preferences

The browser remembers preferred chat width, whether chat is collapsed, deliberate media-panel visibility, export format, and the last selected OpenRouter model, alongside the existing appearance choices. These choices apply before the workspace renders, without opening a project or starting editing/AI services. Root and `/LocalCut/` share preferences on the same origin, and workspace choices synchronize across tabs. Changing preferences never changes project content or exported media.

Chat width is saved in pixels between 280 and 560. Dragging or keyboard resizing updates the preference; collapse, constrained desktop/narrow screens and Appearance's temporary space constraints do not replace it with the rendered width. Expanding chat or returning to a wide layout restores the preferred width. The media toggle, View menu and keyboard shortcut save deliberate visibility changes. Importing files may temporarily reveal media without changing that saved choice; a later synchronized visibility change takes precedence. Export's menu and dialog share the remembered container, while codec checks still run for each actual export.

The model preference stores an identifier only. Reload and Disconnect still require a new explicit connection; after connecting, the preferred model is selected only if it is in the current tool-capable catalog. If unavailable, choose a model explicitly; no substitute is selected and the old preference remains available for a later reconnect. Tab synchronization does not change an active conversation's model. No paid request begins just because a model was restored. Credentials and the three sharing choices are never preferences: sharing starts off again after reload/disconnection.

Invalid or unknown preference records use safe defaults, with finite widths clamped to supported bounds. Blocked/full storage leaves controls usable for the session and reports a toast with a recovery step. A later successful change retries saving the session choices. Appearance Reset affects appearance only, preserving workspace preferences, projects and other applications' storage.

The audit covers the workspace, conversation/session picker, preview/timeline, dialogs, settings, appearance and shared UI controls:

| State                                                                                                                         | Decision                   | Reason                                                             |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| Appearance's nine choices                                                                                                     | Persist (existing)         | Durable visual customization                                       |
| Chat width and collapsed state                                                                                                | Persist                    | Deliberate workspace layout                                        |
| Media visibility                                                                                                              | Persist deliberate toggles | Import-driven opening remains temporary                            |
| MP4/WebM export format                                                                                                        | Persist                    | Repeated export choice; never skips capability checks              |
| OpenRouter model ID                                                                                                           | Persist                    | Repeated provider choice, validated after explicit connection      |
| API key, OAuth state, provider connection, sharing toggles                                                                    | Session/consent only       | Credentials and remote sharing require explicit connection/consent |
| Projects, assets, versions, clip properties, history, transcripts                                                             | Existing project storage   | Authored content has its own canonical owner and backup contract   |
| Active project/clip, playhead, playback, historical version                                                                   | Session only               | Contextual editing state; reload must retain inert startup         |
| Conversations, drafts, proposals, approval/tool disclosures                                                                   | Session only               | Content or operation state, not a user preference                  |
| Search, scroll/follow-latest, session-picker disclosure, tooltip/menu/popover/model-picker/dialog/Appearance-panel visibility | Session only               | Temporary navigation and focus state                               |
| Jobs, loading, errors, progress, rendered layout bounds, resource handles                                                     | Runtime only               | Derived or disposable state                                        |
| Project defaults, provider identity, shortcuts, codec/inference settings                                                      | Existing fixed contracts   | No configurable user choice currently exists                       |

## Appearance

Open **Workspace settings → Appearance** to customize the running app. The panel sits beside the editor on wide screens and above it on narrower screens; the editor remains usable as the preview. While the panel is open, chat can render narrower to retain preview space alongside expanded media; closing Appearance restores the preferred chat width. Phone layouts scroll through the controls, preview, timeline and conversation without overlapping them. Changes apply immediately to app colors, menus, dialogs, typography and corners without reopening the project or conversation.

Inspired by [shadcn Create](https://ui.shadcn.com/create), the panel offers light/dark/system mode, neutral base color, accent theme, system body and heading fonts, radius, density, menu color and menu accent. Base UI and Lucide remain fixed. Fonts use installed system stacks and require no network requests. Density changes preview/timeline spacing. Theme colors also adapt timeline clips while audio and text retain distinct semantic tints. Video content and exported media are unaffected.

Choices save automatically in this browser and synchronize across tabs on the same origin. They apply before the workspace renders; System follows the device color scheme. Randomize changes appearance options while retaining the chosen mode. Reset restores LocalCut's light, neutral, system-sans defaults and removes only its appearance record. If browser storage is blocked or full, changes remain usable for the current session and the panel reports that they could not be saved. Unsupported or malformed records fall back to safe defaults.

Close the panel or press Escape to return focus to Workspace settings. An open picker handles Escape first. No account, editor initialization or remote request is needed to customize appearance.

## Projects and media

Creating or opening a project explicitly initializes the existing engine. Initial navigation does not open IndexedDB, start workers, request permissions or download models. The Projects screen lists projects in this browser. Reloading closes the active session; use Open project to continue a saved project.

Import media accepts the supported video, audio and image formats described in the engine API. Each successful file import is appended to its matching track through an atomic command batch. Images begin with five seconds; video and audio use their measured source duration. Images/video are fitted inside the project dimensions without changing their aspect ratio. Files that fail validation do not create clips; files already committed earlier in the same selection remain available.

The media panel shows sources referenced by the project. Missing sources can be relinked. Settings → Project → Export project and Import project provide a scoped transfer dialog with optional saved versions and individual original-asset checkboxes. Workspace Export/Import uses the same flow for all saved projects, including closed projects, plus separate appearance and workspace preference groups. Select or clear projects, versions and originals independently. Project import chooses one project when inspecting a multi-project archive. Exports without source files are JSON; selecting originals produces ZIP. Missing or omitted originals require relinking. The dialog previews contents before importing new copies and leaves the active editing session intact.

Legacy Download project backup / Import project backup controls retain the original JSON-only format; version-one project envelopes also work in the new project import dialog. Archives exclude keys, sharing consent, conversations, receipts, undo/redo, caches and unrelated origin storage. Import never reconnects AI or starts paid requests. Complete settings groups replace only their corresponding saved preferences. Settings-only import keeps editing services inert. Imported projects commit together; settings persistence failures retain those copies, report an error and permit a settings-only retry. Cancellation is available while reading/packing/restoring; published copies survive late cancellation. The [storage contract](storage.md#workspace-and-project-transfer) describes validation and resource limits.

## Editing and preview

Select a timeline clip to open its properties, split at the playhead or delete it. Start and duration use seconds in the form and integer microseconds in the engine. Changing only speed preserves the existing source range and changes duration. Editing duration explicitly changes the source out-point; the engine rejects unavailable source time and invalid keyframe/caption/fade bounds. Undo and Redo use the canonical history and revision checks, including after reload.

Manual changes retain the revision shown in the workspace. If another window commits first, LocalCut rejects the stale change and refreshes the form. Review the latest values before retrying; concurrent edits are not silently overwritten.

Add text creates an editable three-second overlay at the playhead. The form exposes timing, speed, gain and text. Advanced effects and transitions are available through assistant proposals and the documented engine API. Local transcription and export can also be proposed by the assistant, with explicit approval before any job starts.

Preview uses the same engine compositor as export. Playback creates its audio context only from the Play action. Scrubbing supersedes pending frames; project changes stop the old playback session. Disposal releases image bitmaps, sessions, audio contexts and active jobs. No media is sent to a server.

## Keyboard editing

Focus the preview or timeline to use single-key shortcuts. `Space` toggles playback; `K` pauses and `L` plays forward. Left/right arrows step one frame, Shift+left/right step ten frames, up/down visit previous/next edit boundaries, and Home/End seek to the first/last frame.

| Action                                          | Shortcut or gesture                                           |
| ----------------------------------------------- | ------------------------------------------------------------- |
| Save a project version                          | Mod+S                                                         |
| Split at playhead                               | S or Mod+B                                                    |
| Duplicate selection                             | D or Mod+D                                                    |
| Select all / clear selection                    | Mod+A / Escape                                                |
| Copy / cut / paste clips at playhead            | Mod+C / Mod+X / Mod+V                                         |
| Add/remove selection, including group members   | Shift/Mod+click                                               |
| Group / ungroup                                 | Mod+G / Mod+Shift+G                                           |
| Nudge selection one / ten frames                | Alt+left/right / Alt+Shift+left/right                         |
| Trim start / end to playhead                    | Q / W                                                         |
| Delete / safe ripple delete                     | Delete or Backspace / Shift+Delete                            |
| Properties                                      | Enter on selected clip or double-click clip                   |
| Add text                                        | T                                                             |
| Zoom pointed timeline or preview                | Ctrl/Command+wheel or trackpad pinch                          |
| Zoom focused view / fit                         | + or = / − / 0 or backslash                                   |
| Pan                                             | Middle-button drag; Shift+wheel scrolls timeline horizontally |
| Seek / scrub                                    | Click an empty lane or click/drag the ruler                   |
| Fit preview                                     | Double-click preview                                          |
| New project / toggle chat / toggle media / help | N / C / M / ?                                                 |

Zoom and pan are transient views, independent between timeline and preview; they never change project geometry or exports. Keyboard zoom targets the focused view, falling back to the timeline when the editing area has focus. Timeline zoom ranges from fit to 32×; preview from fit to 8×. Normal wheel/trackpad scrolling remains native; editing gestures leave browser zoom outside those surfaces intact. `?` and Workspace settings → Keyboard shortcuts list the complete map. These mappings follow common [desktop editing conventions](https://helpx.adobe.com/sg/premiere/desktop/get-started/keyboard-shortcuts/default-keyboard-shortcuts.html), adapted to the supported LocalCut commands.

The local clipboard holds a frozen clip selection only within the current session and project, including group membership, keyframes, captions and transitions between copied clips. Paste makes new identities, keeps relative track/time placement and uses current originals; it does not access the system clipboard. Cut changes the clipboard only after its removal succeeds. Source files and text-field copy/paste retain their existing workflows.

Nudging preserves group offsets and clamps the earliest member at zero. Q/W shorten one ungrouped clip with the engine's split semantics, preserving animation, fades and source bounds; select a point inside the clip. Ripple delete closes the selected time interval on every track only when no retained clip intersects it and no retained group straddles it. Unsafe ripple/trim commands are unavailable. Engine validation still rejects invalid transitions or timing atomically. Normal Delete leaves the gap. All edits are undoable and preserve revision conflict handling. Holding an editing key does not repeat mutations; frame navigation and zoom may repeat.

The pass covers existing LocalCut workflows. Source-monitor insert/overwrite, markers, dedicated slip/slide/roll tools and reverse/rate shuttle have no supported workflow/API and receive no misleading bindings. Historical versions allow selection, navigation, properties and view gestures; mutation and clipboard shortcuts remain unavailable.

Mod+K opens Commands from outside text fields and dialogs. The header search icon and Workspace settings → Commands also open it. Search project, media, editing, clip selection, playback, version, export, view, appearance and chat operations; use arrows and Enter to run an available action. File, property, export and AI configuration commands open their existing workflows. AI proposals still require explicit approval. Unavailable actions are omitted, including mutations and export in a historical version. Escape dismisses the palette and returns focus to its header control.

See the [desktop palette](images/workspace-commands.png) and [narrow palette](images/workspace-commands-narrow.png).

Command on macOS or Ctrl elsewhere works with `Z` for Undo, Shift+`Z` for Redo, `O` for Open project, `I` for Import media, and `E` for Export. Ctrl+`Y` also redoes. Shortcuts never intercept text inputs, IME composition, dialogs or menus; Space on a focused button retains its native action. Editing shortcuts call the same revision-aware operations as the visible controls.

## Version browsing

The workspace omits unavailable editing, media and playback buttons; the header omits unavailable Versions and Export actions, the duplicate New project button and local-storage information icon. Create projects through the Projects screen, Workspace settings → Project → New project or Commands. Scrollbars are hidden throughout the workspace and popup surfaces; wheel, touch, trackpad and keyboard scrolling remain available.

Versions in the header opens the saved history and checkpoints pending edits. Select a version to recreate its full timeline, project dimensions, media references and preview. You can select clips, inspect read-only properties, scrub and play the saved state. Editing controls, imports, relinking and export are hidden while browsing; AI requests/application remain blocked. The conversation stays mounted and refers to the current project; transient chat and playhead state are not part of the saved project document.

Return to current resumes the latest project, including changes from another tab. Restore as new version copies the selected state into a new current revision and appends a new version; earlier and later historical entries stay unchanged. If another tab changes the current revision before restoration, review its latest state and retry. Undo can reverse the restoration without deleting the restored version. Closing history returns to the current project.

Autosave appends a version one second after the last committed edit. Rapid edits form one settled version; Undo/Redo also autosave. Pending work is checkpointed when switching projects, browsing history or closing the editor. A forced tab close still retains committed edits; reopening checkpoints the recovered current state. Version history is local to this browser and project; legacy project JSON carries current state only. The new workspace/project transfer dialog can include the version list and historical originals.

## Optional AI

Connect AI accepts a user-owned OpenRouter key or starts its PKCE login. Keys stay in memory and are cleared from the input after use; reload requires connection again. If no remembered model is available, choose a tool-capable model explicitly from the searchable single-select dropdown. Search names or IDs inside its popup; the refresh icon is at the right of the search row. The model catalog is requested only by connecting or refreshing it. Data & analytics reveals the optional text/name/transcript sharing choices; they are hidden from the initial connection view.

Prompts and structural metadata are sent remotely only by Send. Separate, initially unchecked choices opt names, on-screen text and transcript content into context. Changing model, project or sharing choices starts a new conversation. Chat includes saved text only. Separately permitted indexing sends generated stills, audio excerpts and video excerpts with sound. Provider charges can apply; set spending limits in OpenRouter.

Streaming text is not an applied edit. Only a successfully completed assistant turn can publish a validated proposal. Inspect its operations, then Apply or Discard. Apply retains the engine's revision check and stable receipt; stale proposals require a new request. Undo/Redo, export, transcription and model preparation have separate approval cards. Export, transcription and preparation jobs show real progress and cancellation; atomic edits and history commits cannot be cancelled after submission. Completed exports offer a local Save action. Cancelling a turn does not publish partial proposals. Committed edits survive disconnection and reload; conversations do not.

## Text to speech

After creating/opening a current project and connecting OpenRouter, use Text to speech in the chat header or Commands → Text to speech. Speech has its own model/voice choice and does not require selecting a chat model. Choose a currently available Gemini speech model and voice, write the script, and select every language it contains. Search also accepts a custom language or regional variant. Delivery directions let you ask for warmth, expression or an accent; natural conversational delivery is the default.

Generate explicitly sends the script and speech choices to the connected account; provider charges can apply. The resulting audio has a local playback preview. Speaking speed accepts 0.5–2×. Total length uses seconds and fits the complete audio to the nearest sample while preserving pitch. Once generated, changing timing reveals Adjust timing; this is local and does not generate another provider request. Impossible lengths show the permitted range. Changes to script, model, voice, languages or delivery discard the old preview so it cannot be added with outdated settings.

Add to timeline imports the adjusted WAV and appends it to the first audio track, creating one if necessary. It uses the same canonical history, persistence, preview and export as imported audio. Undo removes the insertion; Redo restores it. Cancellation or dismissal discards unfinished generation/adjustment; a committed timeline edit remains durable. Speech controls are unavailable in historical versions. See [speech transport and privacy](ai.md#text-to-speech) for limits and verification boundaries, and the [desktop](images/workspace-speech.png) and [narrow](images/workspace-speech-narrow.png) dialog examples.

## Export

Export checks the exact requested MP4/H.264/AAC or WebM/VP9/Opus configuration. Unsupported codecs show an actionable error without changing formats or dropping audio. The engine captures the project revision, streams to local temporary storage and reports real progress. Cancel stops unfinished work; a completed artifact provides Save video. Closing the dialog disposes its temporary artifact without altering the project or an already saved download.

Safari can return an MPEG-4 ES descriptor instead of the raw AAC AudioSpecificConfig. LocalCut extracts the decoder configuration for both priming calibration and exported packet metadata, preserving audio and its measured timing. This corrects the reproduced `InternalAudioDecoderCocoa decoding failed` path; Chrome remains the primary full acceptance target.

## Verification and limits

Production Chrome tests exercise both `/` and `/LocalCut/`, inert startup, real imports, timing/speed edits, Undo/Redo, persisted reopening, frame pixels and real exports reopened with native decoding. Controlled OpenRouter responses test the real UI, privacy choices and explicit proposal application. They do not prove a paid provider request or interactive account consent; those remain separately authorized checks described in [AI integration](ai.md).

Version browsing adds compatible fields to existing project records without an IndexedDB version upgrade. See [storage compatibility and rollback](storage.md) before using older application writers; they retain the current project but do not preserve its version history. Deployment uses the automatic Pages workflow on pushes to `main` in [DEPLOY.md](../DEPLOY.md).

## App icons and installation metadata

The favicon follows Klip's original film-cell identity. Base-aware links provide SVG/PNG favicons, an Apple touch icon and `manifest.webmanifest`. The manifest's relative ID/start URL/scope and standard/maskable PNG icons support root and Pages hosting. `node scripts/generate-icons.mjs` regenerates PNGs from the tracked vector using installed stable Chrome. Install metadata does not add a service worker or offline navigation; the static app still needs to be available when launched.

## Timeline selections and templates

Shift/Mod-click adds or removes clips from the selection. Clicking a grouped member selects its entire group; the group underline keeps membership visible. Use Group/Ungroup in the timeline or command palette, or Mod+G / Mod+Shift+G. Delete and Duplicate act on the selection. Changing a grouped member's Start in Clip properties moves the group by the same offset; duration, speed and gain remain individual property edits. Negative placement or broken transition overlap rejects the whole edit. Ungroup before moving a member independently.

Select an unmuted video clip with an audio stream to reveal Separate audio. The result is a separate audio clip on an audio track referencing the original file; the video is muted to prevent doubled sound. Group the two clips if they should move together. Undo restores the combined clip.

An overlap marker selects both visual endpoints. For a valid overlap on one video track, the Transition template dropdown and command palette offer Crossfade, Fade through black, Slide left/right, Zoom in/out, and Blur dissolve. Overlap length controls transition duration. No transition is added automatically when clips overlap. Templates generate editable base-attribute keyframes, which the assistant can tune after inspecting the project; applying another template builds on the current animation. Remove blend removes blending only; Undo restores the full template edit. Historical versions show groups/overlaps but hide mutation actions.

## Indexing media

AI settings contains an independent remembered Allow asset indexing choice explaining OpenRouter evidence/audio sharing and saved labels in chat. Eligible ready audio/video/image cards expose manual Index when allowed, with progress, Cancel, explicit Retry after interruption/failure, and Reindex after success. Connection and selected-model capability are required; unsupported routes show an error. Import never starts indexing.

Index history shows retained runs, approximate owned storage bytes, scan/evidence elapsed time, scene ranges and paged local still/video/audio previews. Delete this run is explicit and frees its records/files; prior runs remain. Similar-image notices compare saved perceptual hashes and histograms. Labels and evidence survive reload independently of AI credentials. Revocation hides actions, cancels active jobs and retires label-bearing chats while preserving local outputs. Klip's original film-cell mark appears in chat and the workspace logo.
