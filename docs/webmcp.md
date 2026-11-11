# Browser agent control with WebMCP

Open a project in a browser that supports WebMCP, then ask a compatible agent to inspect or edit the project you are viewing. LocalCut automatically registers vendor-neutral `localcut_*` site tools for that project. No LocalCut AI account, OpenRouter connection, MCP server or companion process is required. Browsers without WebMCP keep the ordinary editor.

Tools act directly on requested edits without a second LocalCut approval step. Browser permissions, audio activation and the agent's own action policies still apply.

## Connect and use

1. Open LocalCut and the desired project in your agent's WebMCP-capable browser. Projects belong to that browser profile and origin; transfer an originals-inclusive backup when needed.
2. Inspect the browser's site-tool list. In the desktop built-in browser, use **Site tools → Available site tools**. Start with `localcut_inspect_project`; use its project ID and revision in scoped calls.
3. Ask for the desired edit, for example: “Inspect this cut, shorten the opening, add a title and export an MP4.” The editing tool's JSON Schema describes every canonical operation/property. `localcut_catalog` supplies shared font IDs and recipes.
4. Long work returns a job ID. Use `localcut_job` with `status`, `wait`, `cancel`, `download` or `release`. Preview/export results include browser-local blob URLs and file metadata. Download saves the result; release revokes URLs and disposes temporary export data.

WebMCP is an evolving browser API, not a guarantee that every agent/browser can connect. LocalCut feature-detects `document.modelContext.registerTool` and uses registration/execution AbortSignals. See the [WebMCP specification](https://webmachinelearning.github.io/webmcp/), [Chrome's imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api) and [desktop site tools](https://learn.chatgpt.com/docs/webmcp). Chrome documents `chrome://flags/#enable-webmcp-testing` for local testing. LocalCut does not enable browser flags or enroll its hosting origin in an origin trial.

## Tool inventory

| Tools                              | Shared owner and result                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `inspect_project`, `catalog`       | Project snapshot, viewed version, Media, selection/playhead and shared authoring catalogs      |
| `validate_edits`, `apply_edits`    | Complete canonical batch schema; atomic editor validation/commit and original edit receipt     |
| `history`, `versions`              | Engine Undo/Redo and immutable version read/save/restore                                       |
| `library`, `import_media`, `asset` | Project Media organization, canonical import/relink/rename, local thumbnails/waveforms         |
| `view`, `preview_frame`            | Actual workspace selection/playhead/playback and shared native renderer                        |
| `export_video`, `backup_project`   | Native MP4/WebM and originals-inclusive archive for the viewed project                         |
| `transcription`                    | Explicit local Whisper status/preparation/transcription and project transcript readback        |
| `storyboard`, `track_mask`         | Shared image insertion, PNG/SVG/editable-scene export, Media publication and local mask motion |
| `coding`                           | Existing project filesystem and network-disabled shell/QuickJS worker; generated-file import   |
| `job`                              | Engine job progress, cancellation, results and disposable files                                |

## Scope, concurrency and lifecycle

`src/workspace/useWebMCP.ts` owns the lazy workspace binding. `src/workspace/webmcp/` owns schemas, registration, dispatch and result lifetimes. Tools call the existing editor facade, without another editable project or a built-in assistant/provider dependency.

Only the visible editor project has tools. Opening Projects, switching project/version, leaving the page or unmounting retires registrations, cancels jobs and releases retained artifacts. Old callbacks check their live route/view before accessing the engine. Historical versions are read-only: inspection and preview reflect that version; return to current before editing/restoring. Committed imports, transcripts and edits survive retirement under the engine publication contract.

Document writes require `expectedRevision`; library changes use `expectedLibraryRevision`, and sandbox changes use `expectedCodingRevision`. Reinspect after conflicts. Edit batches preserve caller request IDs and omitted fields, so identical retries recover canonical receipts. Changed payloads require new request IDs. Manual/agent edits share the engine's transaction/revision rules.

## Data and verification boundaries

Project content and generated preview/export files become available to the connected browser agent. Its provider may process results under that agent's policies. LocalCut does not select a provider or send OpenRouter requests for WebMCP. Tools expose neither saved provider credentials nor arbitrary page JavaScript, host files or unrelated projects. Local model preparation is explicit. Base64 imports accept up to 90 million characters; importing does not place clips, fetch remote URLs or run inference.

The [focused checks](development.md#webmcp-checks) distinguish a controlled registration harness from actual browser discovery. Both use production-built editor APIs and browser persistence. Preview/video checks retain native rendering, encoding and readback. Browser discovery does not establish model editing quality or interoperability with every agent.
