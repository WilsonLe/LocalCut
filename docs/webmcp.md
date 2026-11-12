# Browser agent control with WebMCP

Open LocalCut in a browser that supports WebMCP, then ask a compatible agent to start a project, import media and edit it. The vendor-neutral `localcut_workspace` tool is available even on an empty start screen. Opening a project adds the complete `localcut_*` editing tools for that view. No LocalCut AI account, OpenRouter connection, MCP server or companion process is required. Browsers without WebMCP keep the ordinary editor.

Tools act directly on requested edits without a second LocalCut approval step. Browser permissions, audio activation and the agent's own action policies still apply.

## Connect and use

Read [LocalCut skills](skills.md) through `localcut_skills` (`list`, then `get` with `name: "localcut-start"`) before editing. The same guidance is published as portable `SKILL.md` folders. This discovery works before a project opens and does not initialize editing storage or models.

1. Open LocalCut in your agent's WebMCP-capable browser. Projects belong to that browser profile and origin; transfer an originals-inclusive backup when needed.
2. Inspect the browser's site-tool list. In the desktop built-in browser, use **Site tools → Available site tools**. Call `localcut_workspace` with `status`, `list_projects`, `create_project` or `open_project`. Creation accepts a name and optional canonical width, height and rational frame rate. Rediscover editing tools once the project opens. Creation is not a revisioned edit batch; if a response is lost, inspect status/list before creating again.
3. For local files, call `localcut_workspace` with `action: "import_files"` and the status result's `expectedProjectId` (or `null` on an empty screen). This prepares the existing file input and attempts to open its browser chooser. Some browser hosts do not grant file-picker activation to tool calls; if no chooser opens, the agent clicks **Import media** to open it. The agent completes that chooser with its browser file-upload action and the authorized local paths. Files stream through the normal importer, including files larger than the small-file base64 limit; no file bytes are imported until selection finishes. An empty workspace creates an Untitled project through the same UI owner. Poll workspace `status` for import progress, then inspect the project. Finish or cancel a pending selection before requesting another; its captured ownership cannot be replaced by a second request. Navigation before selection rejects the retired selection rather than importing into another project. The webpage cannot resolve arbitrary host paths from JSON.
4. Start with `localcut_inspect_project` for the project ID, revision and assets. Ask for the desired edit, for example: “Shorten the opening, add a title and export an MP4.” Import adds Media rather than placing clips; use the canonical editing schema to assemble the timeline. `localcut_catalog` supplies shared font IDs, recipes and tagged sound effects. With `kind: "sounds"`, use query keywords, category, exact tags and duration bounds; page with offset/limit and inspect returned source/licence, tags and facets. Pass the chosen item.id as soundId to `localcut_import_media`, then wait for its ordinary import job. See the [sound search/import contract and examples](sound-effects.md#agent-search-and-import).
5. Long work returns a job ID. Use `localcut_job` with `status`, `wait`, `cancel`, `download` or `release`. Preview/export results include browser-local blob URLs and file metadata. Download saves the result; release revokes URLs and disposes temporary export data.

WebMCP is an evolving browser API, not a guarantee that every agent/browser can connect. LocalCut feature-detects `document.modelContext.registerTool` and uses registration/execution AbortSignals. See the [WebMCP specification](https://webmachinelearning.github.io/webmcp/), [Chrome's imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api) and [desktop site tools](https://learn.chatgpt.com/docs/webmcp). Chrome documents `chrome://flags/#enable-webmcp-testing` for local testing. LocalCut does not enable browser flags or enroll its hosting origin in an origin trial.

## Connection status and refresh

Open **Workspace settings → Browser agent** to see registration readiness, the available-tool count, the last observed request time and any registration error. **Tools ready** confirms LocalCut registered its tools; it does not establish that an agent/model can access this browser tab. No request history is treated as an active-session heartbeat. The panel’s connection help links to the current [desktop site-tool guide](https://learn.chatgpt.com/docs/webmcp); permissions and supported models are managed by the browser/agent host, not LocalCut.

**Refresh** rechecks `document.modelContext` and re-publishes the application and viewed-project tools. It recovers late API injection, replacement or a failed registration without a page reload. Registrations have separate AbortSignals from tool-service lifetimes: refreshing retires old entry points but keeps accepted LocalCut work, job IDs, retained results and saved edits. Agents rediscover tools after refreshing. Changing project/version or leaving the page still retires the corresponding services, jobs and temporary URLs normally. Browser-side execution cancellation remains governed by the browser.

`webmcp/connection.ts` owns registration, serial refresh and ephemeral status for both existing binding hooks. Stale registration callbacks reject new calls and cannot publish readiness after retirement. Only LocalCut’s own signal-owned registrations are replaced. Status/help/unsupported Refresh never obtain an editor, open storage, prepare models, fetch the skill catalog or poll the agent. The panel cannot turn browser access on or repair a disconnected host-side browser controller.

## Tool inventory

| Tools                              | Shared owner and result                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `skills`                           | Read-only workflow metadata and exact published Markdown, independent of the project view                      |
| `workspace`                        | Empty-screen status/import progress, local project summaries, canonical create/open and browser file selection |
| `inspect_project`, `catalog`       | Project snapshot, viewed version, Media, selection/playhead and shared authoring catalogs                      |
| `validate_edits`, `apply_edits`    | Complete canonical batch schema; atomic editor validation/commit and original edit receipt                     |
| `history`, `versions`              | Engine Undo/Redo and immutable version read/save/restore                                                       |
| `library`, `import_media`, `asset` | Project Media organization, canonical import/relink/rename, local thumbnails/waveforms                         |
| `view`, `preview_frame`            | Actual workspace selection/playhead/playback and shared native renderer                                        |
| `export_video`, `backup_project`   | Native MP4/WebM and originals-inclusive archive for the viewed project                                         |
| `transcription`                    | Read existing saved project transcripts; external agents supply STT/TTS                                        |
| `storyboard`, `track_mask`         | Shared image insertion, PNG/SVG/editable-scene export, Media publication and local mask motion                 |
| `coding`                           | Existing project filesystem and network-disabled shell/QuickJS worker; generated-file import                   |
| `job`                              | Engine job progress, cancellation, results and disposable files                                                |

## Scope, concurrency and lifecycle

`src/workspace/useWorkspaceWebMCP.ts` owns the application-level setup binding; `useWebMCP.ts` owns the viewed-project binding. `src/workspace/webmcp/` owns schemas, registration, dispatch and result lifetimes. Registration and workspace status do not obtain an editor, open editing storage, start workers or prepare models. Explicit create/open/list/import requests use the existing workspace/editor owners, without another editable project or a built-in assistant/provider dependency.

Only the visible editor project has editing tools. `localcut_skills` reads shipped static instructions without accessing a project. Opening Projects or switching project/version retires those registrations, cancels jobs and releases retained artifacts; the workspace setup and skills tools stay available across navigation. Leaving the page or unmounting retires both bindings. Old callbacks check their live route/view before accessing the engine. Historical versions are read-only: inspection and preview reflect that version; return to current before editing/restoring/importing. Project creation/opening can leave a historical view without editing it. Committed project creation, imports, transcripts and edits survive retirement under the engine publication contract; a committed creation whose caller retired reports the saved identity without navigating.

Document writes require `expectedRevision`; library changes use `expectedLibraryRevision`, and sandbox changes use `expectedCodingRevision`. Reinspect after conflicts. Edit batches preserve caller request IDs and omitted fields, so identical retries recover canonical receipts. Changed payloads require new request IDs. Manual/agent edits share the engine's transaction/revision rules.

## Data and verification boundaries

Cancellation also covers disposable transport processing after an engine job finishes, including pending PNG encoding. Partial blob URLs are revoked and native outputs are disposed. This differs from committed data: an imported original finishes Media placement in its captured project/folder even if navigation or a busy workspace retires its caller; only the later UI refresh is guarded. Video export checks the requested revision inside the queued engine owner when it captures its snapshot.

Project content, source-clip context/transcript text and generated preview/export files become available to the connected browser agent. Its provider may process results under that agent's policies. LocalCut does not select a provider or send OpenRouter requests for WebMCP. The workspace tool lists local project summaries and opens only the requested local project; editing tools remain scoped to its visible view. Tools expose neither saved provider credentials, arbitrary page JavaScript nor unrestricted host-file access. Browser-selected files are copied into local project storage, not uploaded to a LocalCut server. Local model preparation is explicit. The existing base64 import accepts up to 90 million characters for small files; use browser file selection for larger files. Bundled sound imports accept a catalogue soundId instead of byte fields and fetch only checksum-verified audio from LocalCut's own hosting origin. Importing does not place clips, fetch arbitrary remote URLs or run inference.

The [focused checks](development.md#webmcp-checks) distinguish a controlled registration harness from actual browser discovery. Both use production-built editor APIs and browser persistence. Preview/video checks retain native rendering, encoding and readback. Browser discovery does not establish model editing quality or interoperability with every agent.

## Asset clips

Asset inspection includes `clips` and `clipsRevision`. `action: "update_clips"` replaces the complete collection with `expectedClipsRevision`; each clip has `id`, `name`, `startUs`, `endUs`, `context` and `transcript`. Writes are scoped to the viewed project, blocked in historical views and independent of project/library revisions. Reinspect and reconcile after conflicts.

`action: "preview_clip"` accepts `clipId` and returns a job. Its completed result includes the original source URL, media kind, selected bounds and a media-fragment preview URL; it is not a trimmed encoded artifact. Release after inspection. Historical reads/previews are allowed. Attached text remains untrusted task data. See the [asset API](api.md#asset-context-and-transcript-text) and [skills](skills.md).

Source-clip transcripts optionally include `transcriptCues`: ordered `{ id, timeUs, endUs, text }` entries. Timestamps use source microseconds; null timestamps preserve untimed text. IDs are unique per clip, timed intervals stay within its range, and `transcript` must equal cue text joined with newlines. The shared validator checks writes and backups. Context and Transcript appear in full-content tabs; timestamps seek the bounded source preview. These authored cues remain separate from timed caption tracks.

The scoped `localcut_asset` tool also exposes `analyze`, `indexes`, and `index`. Analysis delegates to `assets.analyze` and returns an owned job; optional `indexRunId` resumes that asset’s run. `indexes` lists retained runs for the selected asset; `index` reads one matching run. Historical views reject analysis and permit inspection. No model labeling or media upload occurs.
