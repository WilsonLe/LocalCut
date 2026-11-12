# Browser support and local data

## Compatibility

[WebMCP agent control](webmcp.md) is an optional progressive enhancement using `document.modelContext.registerTool`. It requires a compatible browser and agent; unsupported browsers retain manual editing. See the WebMCP guide for setup, API references and verification limits.

Current stable desktop **Google Chrome** is the complete acceptance target. Export formats are capability-checked at runtime: MP4 needs H.264/AAC and WebM needs VP9/Opus. Storage, capture and codec support also depend on the browser, OS and hardware.

Native Safari has a separate macOS regression suite for storage reload and MP4 round trips. That focused coverage does not establish full Chrome parity, including WebM or performance. Mobile layouts are available, but browser/device capabilities still determine which operations work.

Screen, window and tab recording use the browser's source picker. Shared audio availability depends on the chosen source, browser and OS; see [recording guidance](workspace.md) and [troubleshooting](troubleshooting.md).

## Agent browser selection

For interactive LocalCut work and manual previews, use the agent host's built-in browser first. Reuse the intended LocalCut tab when it is already there. Open Chrome or another external browser only when the user explicitly requests it, no built-in browser is available, or an observed failure blocks a capability required for the task. State that concrete fallback reason before switching. Do not infer incompatibility from a browser name or assume the built-in browser supports every native operation.

Discover WebMCP site tools when available. If they are absent, use the ordinary editor UI in the same browser when it can complete the task; missing site tools alone does not require Chrome. Honor the user's explicit browser choice.

Projects and media belong to one browser profile and origin. Before switching browsers, preserve existing work through a project/workspace backup including originals and restore it in the destination. Verify the intended project and media before editing; if backup/restore is unavailable, keep the original tab intact and report the blocked transfer rather than assuming the project is shared.

The same rule is included in every [published portable skill](skills.md), including skills read through WebMCP. It guides external agents; the app cannot force an agent host's browser choice. Required native codec, storage and performance acceptance tests continue to use stable Chrome under the existing [validation contract](validation.md). Built-in browser observations do not replace those gates.

## Storage, backups and offline use

Projects and originals live in IndexedDB/OPFS in this browser and origin. There is no cloud sync. Browser data clearing, eviction, changing browser profiles or moving to a different host can make projects unavailable. Export project/workspace backups with originals before relying on long-term retention or transferring work. See [backups and recovery](getting-started.md#save-versions-and-backups) and [storage contracts](storage.md).

No service worker is installed, so full offline navigation is not supported. Speech capabilities belong to the external agent. See [speech and captions](transcription.md).

## Optional providers and privacy

Local editing processes media on the device. LocalCut has no provider connections or remote AI requests; external agents use their own authorized speech tools. See [privacy and data flows](privacy.md).

## Native browser verification

Use the [development commands](development.md#commands) and [validation requirements](validation.md) for complete Chrome acceptance and the separately scoped Safari gate.

On macOS, enable **Allow remote automation** in Safari's Develop → Developer Settings once, then run `pnpm test:safari`. The suite uses installed Safari through `safaridriver`, verifies/reuses both production builds and runs serially on its own loopback ports. At the deployed `/LocalCut/` base it checks storage reload and three MP4 round trips: stereo WAV input, reimported AAC and silence. Unavailable native capabilities fail; results and failure screenshots are saved in `test-results/safari/`. Playwright WebKit is not native Safari evidence.
