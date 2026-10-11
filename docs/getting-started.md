# Your first LocalCut project

Open [LocalCut on GitHub Pages](https://wilsonle.github.io/LocalCut/) in current stable desktop Chrome, or follow [source setup](../README.md#setup). Local editing needs no account, AI connection or server. Keep files you own or are permitted to use.

## Create, import and edit

1. Create a project from the workspace or Settings. Give it a useful name and choose its output settings. Open a saved project from the workspace when returning.
2. Open Media and use the import card to select video, audio or images. Imported files are added to matching timeline tracks in selection order. Screen recording uses the browser's source picker; available sources/audio vary by browser and OS.
3. Select a clip in the timeline. Adjust timing, speed, pitch, gain or text through the existing clip controls. Add and reorder tracks, group clips or separate audio as needed. Overlapping visual clips on one video track can use transition templates.
4. Preview the edit and use Undo/Redo for committed changes. Text templates are real editable clips; bundled fonts and animations are rendered by the same preview/export pipeline.

On narrow screens switch between Edit, Chat and Media; switching views preserves the active work. Keyboard shortcut help and Commands are available in the workspace. See [workspace behavior](workspace.md) for detailed interactions.

## Save, versions and backups

Edits persist locally; an autosaved version follows a quiet period after committed editing. Use **Settings → Project → Versions** to inspect a historical version in the real read-only editor. Restoring it appends a new version rather than overwriting history.

A saved project link identifies data in this browser/origin; sending that URL to another device does not transfer the project. There is no cloud sync. Private browsing and browser eviction/clearing can remove data. A different port, host, scheme or browser profile uses different storage.

Export a backup through **Settings → Project → Export project**, or **Settings → Workspace → Export workspace** for multiple projects/preferences. Choose the projects, versions and original files you want included. A backup without originals may not be enough to reproduce the edit elsewhere. Provider credentials and sharing consent are excluded from portable backups.

To recover or transfer, keep the downloaded archive outside browser storage, open the same compatible application in a separate profile/device, preview the import contents and choose what to import. Imports create new project copies and preserve existing projects. Verify preview and source availability before removing any old copy. See [storage and portability](storage.md).

## Optional AI and speech

Open Chat's provider configuration to connect OpenRouter, a supported compatible endpoint or ChatGPT. Configure explicit models/service routes. Custom endpoints must permit browser CORS. ChatGPT uses the manual callback-paste flow described in [AI sign-in](ai.md#chatgpt-sign-in); never share the callback address.

Ask for an edit, inspect the proposed operations and choose Apply or Discard. Approved edits use the engine and support Undo. Connection or model selection alone does not initiate paid inference.

Text to speech sends the authored script and speech choices when you explicitly choose Generate. Preview the result, adjust its timing and choose Add to import it locally. Indexing uses separate permission and an explicit Index action, which can send generated excerpts. Transcription defaults to local Whisper after explicit model preparation; a configured remote STT route may send approved selected audio. Read [privacy](privacy.md) before enabling remote services.

## Export a video

Open **Settings → Export**, choose MP4 or WebM from the formats supported by your browser, export and then Save video. Keep the downloaded video separately from browser-local projects. A video export is a rendered result; use a project/workspace backup if you want to edit it later.

If export is unavailable or fails, keep the project and originals, record the error and use [troubleshooting](troubleshooting.md). Codec support depends on browser, OS and hardware; changing a filename extension cannot convert an unsupported codec.
