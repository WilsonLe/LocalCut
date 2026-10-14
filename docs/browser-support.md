# Browser support and local data

## Compatibility

Current stable desktop **Google Chrome** is the complete acceptance target. Export formats are capability-checked at runtime: MP4 needs H.264/AAC and WebM needs VP9/Opus. Storage, capture and codec support also depend on the browser, OS and hardware.

Native Safari has a separate macOS regression suite for storage reload and MP4 round trips. That focused coverage does not establish full Chrome parity, including WebM, local inference or performance. Mobile layouts are available, but browser/device capabilities still determine which operations work.

Screen, window and tab recording use the browser's source picker. Shared audio availability depends on the chosen source, browser and OS; see [recording guidance](workspace.md) and [troubleshooting](troubleshooting.md).

## Storage, backups and offline use

Projects and originals live in IndexedDB/OPFS in this browser and origin. There is no cloud sync. Browser data clearing, eviction, changing browser profiles or moving to a different host can make projects unavailable. Export project/workspace backups with originals before relying on long-term retention or transferring work. See [backups and recovery](getting-started.md#save-versions-and-backups) and [storage contracts](storage.md).

No service worker is installed, so full offline navigation is not supported. Local inference can reuse explicitly downloaded model/runtime caches while the application is available. See [local transcription](transcription.md).

## Optional providers and privacy

Local editing and default Whisper transcription process media on the device. Optional AI actions can send prompts and permitted metadata, indexing excerpts, authored speech scripts or approved transcription audio to configured providers. Saved browser credentials are readable by scripts on the same origin. Read [privacy and data flows](privacy.md) before connecting a provider.

## Native browser verification

Use the [development commands](development.md#commands) and [validation requirements](validation.md) for complete Chrome acceptance and the separately scoped Safari gate.

On macOS, enable **Allow remote automation** in Safari's Develop → Developer Settings once, then run `pnpm test:safari`. The suite uses installed Safari through `safaridriver`, verifies/reuses both production builds and runs serially on its own loopback ports. At the deployed `/LocalCut/` base it checks storage reload and three MP4 round trips: stereo WAV input, reimported AAC and silence. Unavailable native capabilities fail; results and failure screenshots are saved in `test-results/safari/`. Playwright WebKit is not native Safari evidence.
