# Workspace

The interface follows the approved conversation-led mockup: resizable conversation on the left, preview and compact timeline in the center, and an independently collapsible media library on the right. Small screens stack the preview above the conversation and open media as a right-edge drawer. Production contains no illustrative clips, simulated replies or fake export progress.

The narrower chat can collapse into a rail while the editor expands, and returns with its conversation intact. Both regions animate together and respect reduced motion. OpenRouter connection/model settings have one compact entry point in chat. The header settings menu reveals Project, View and Export groups progressively; media stays reachable from its right-edge toggle. Supporting metadata lives in tooltips and disclosures. Durable design choices are recorded in [user preferences](user-preferences.md).

Chat follows the CYOBot instructor workspace's interaction structure: session picker, scrolling transcript, right-aligned user bubbles, plain assistant replies, tool disclosures, approval cards, and a rounded growing composer. Tool disclosures expose each call's bounded input, result or error separately, subject to the same sharing policy as its remote context. Enter sends; Shift+Enter inserts a newline. IME composition and repeated Enter do not submit. Stop cancels the active turn, and scrolling up reveals a return-to-latest control. Sessions are local to the current connection/project and are not saved across reloads. Chat resizing is available above 900px; narrower layouts use a fixed responsive width.

## Projects and media

Creating or opening a project explicitly initializes the existing engine. Initial navigation does not open IndexedDB, start workers, request permissions or download models. The project menu lists projects in this browser. Reloading closes the active session; use Open project to continue a saved project.

Import media accepts the supported video, audio and image formats described in the engine API. Each successful file import is appended to its matching track through an atomic command batch. Images begin with five seconds; video and audio use their measured source duration. Images/video are fitted inside the project dimensions without changing their aspect ratio. Files that fail validation do not create clips; files already committed earlier in the same selection remain available.

The media panel shows sources referenced by the project. Missing sources can be relinked. Backup downloads editing data and asset references as JSON; originals are not embedded. Import backup validates the document and creates a separate project, preserving existing data. Keep original files separately.

## Editing and preview

Select a timeline clip to open its properties, split at the playhead or delete it. Start and duration use seconds in the form and integer microseconds in the engine. Changing only speed preserves the existing source range and changes duration. Editing duration explicitly changes the source out-point; the engine rejects unavailable source time and invalid keyframe/caption/fade bounds. Undo and Redo use the canonical history and revision checks, including after reload.

Manual changes retain the revision shown in the workspace. If another window commits first, LocalCut rejects the stale change and refreshes the form. Review the latest values before retrying; concurrent edits are not silently overwritten.

Add text creates an editable three-second overlay at the playhead. The form exposes timing, speed, gain and text. Advanced effects and transitions are available through assistant proposals and the documented engine API. Local transcription and export can also be proposed by the assistant, with explicit approval before any job starts.

Preview uses the same engine compositor as export. Playback creates its audio context only from the Play action. Scrubbing supersedes pending frames; project changes stop the old playback session. Disposal releases image bitmaps, sessions, audio contexts and active jobs. No media is sent to a server.

## Keyboard editing

Focus the preview or timeline to use single-key shortcuts. `Space` plays/pauses, arrows step one frame, Shift+arrows step ten frames, and Home/End seek to the first/last frame. `S` splits, `D` duplicates, Delete/Backspace removes the selected clip, and `T` adds text. `N` opens a new project; `C` and `M` toggle chat and media. `?` opens the complete shortcut reference in the header.

Command on macOS or Ctrl elsewhere works with `Z` for Undo, Shift+`Z` for Redo, `O` for Open project, `I` for Import media, and `E` for Export. Ctrl+`Y` also redoes. Shortcuts never intercept text inputs, IME composition, dialogs or menus; Space on a focused button retains its native action. Editing shortcuts call the same revision-aware operations as the visible controls.

## Optional AI

Connect AI accepts a user-owned OpenRouter key or starts its PKCE login. Keys stay in memory and are cleared from the input after use; reload requires connection again. Choose a tool-capable model explicitly. The model catalog is requested only by connecting or refreshing it.

Prompts and structural metadata are sent remotely only by Send. Separate, initially unchecked choices opt names, on-screen text and transcript content into context. Changing model, project or sharing choices starts a new conversation. Raw files and decoded audio are never included. Provider charges can apply; set spending limits in OpenRouter.

Streaming text is not an applied edit. Only a successfully completed assistant turn can publish a validated proposal. Inspect its operations, then Apply or Discard. Apply retains the engine's revision check and stable receipt; stale proposals require a new request. Undo/Redo, export, transcription and model preparation have separate approval cards. Export, transcription and preparation jobs show real progress and cancellation; atomic edits and history commits cannot be cancelled after submission. Completed exports offer a local Save action. Cancelling a turn does not publish partial proposals. Committed edits survive disconnection and reload; conversations do not.

## Export

Export checks the exact requested MP4/H.264/AAC or WebM/VP9/Opus configuration. Unsupported codecs show an actionable error without changing formats or dropping audio. The engine captures the project revision, streams to local temporary storage and reports real progress. Cancel stops unfinished work; a completed artifact provides Save video. Closing the dialog disposes its temporary artifact without altering the project or an already saved download.

Safari can return an MPEG-4 ES descriptor instead of the raw AAC AudioSpecificConfig. LocalCut extracts the decoder configuration for both priming calibration and exported packet metadata, preserving audio and its measured timing. This corrects the reproduced `InternalAudioDecoderCocoa decoding failed` path; Chrome remains the primary full acceptance target.

## Verification and limits

Production Chrome tests exercise both `/` and `/LocalCut/`, inert startup, real imports, timing/speed edits, Undo/Redo, persisted reopening, frame pixels and real exports reopened with native decoding. Controlled OpenRouter responses test the real UI, privacy choices and explicit proposal application. They do not prove a paid provider request or interactive account consent; those remain separately authorized checks described in [AI integration](ai.md).

No schema migration accompanies these workspace refinements. Reverting them restores the previous workspace while retaining saved projects. Deployment remains the manually triggered Pages workflow in [DEPLOY.md](../DEPLOY.md).
