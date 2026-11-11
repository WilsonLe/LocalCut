# Privacy and local data

LocalCut is a static browser application with no application backend or cloud project sync. The browser fetches the application and, only after explicit preparation, pinned local transcription assets. Hosting services may process their own request information.

Project documents, originals, transcripts, editing history, reusable media analysis, exports and temporary processing files stay in browser-local IndexedDB/OPFS. Appearance, editor layout and recent-project identity use separate whitelisted localStorage records. Portable backups contain only the selected projects/settings/media. Local Whisper processes audio in a dedicated browser worker; there is no remote transcription route.

The application has no built-in agent, chat, provider accounts, speech synthesis or remote media labeling. Startup removes obsolete provider credentials, pending authorization records and voice settings without connecting to a provider. Legacy backups cannot restore them. Historical agent sidecars and previously generated/imported media are preserved as inert local data; the removed runtime never restores or submits them. See [agent removal](ai.md).

Local error reports and notification history retain source diagnostics with credentials and URL parameters redacted. They are not automatically uploaded. A downloaded backup/export is a separate user-owned file. Clearing browser site data affects the entire origin and can remove local projects and originals; export needed work first.

Browser-local scripts can access same-origin storage. Prefer a dedicated trusted origin for self-hosting. No runtime secrets or provider keys are required.

Guest project code executes in QuickJS inside a terminable worker with a virtual project filesystem and networking disabled. It has no browser, provider, other-project or immutable-original access. Its local API remains available independently of the removed assistant.

## Browser agent access

[WebMCP](webmcp.md) exposes the viewed project’s content, local transcripts and generated previews/exports to the browser agent you use. Its provider may process results under its policies. These tools do not select a provider, send OpenRouter requests, expose saved credentials or grant unrelated-project access. Requested edits use the canonical editor without a second LocalCut approval step; local model preparation remains explicit.
