# Privacy and local data

LocalCut is a static browser application with no application backend or cloud project sync. The browser fetches the application and, only after explicit preparation, pinned local transcription assets. Hosting services may process their own request information.

Project documents, originals, transcripts, attached asset context/transcript notes, editing history, reusable media analysis, exports and temporary processing files stay in browser-local IndexedDB/OPFS. Appearance, editor layout and recent-project identity use separate whitelisted localStorage records. Portable backups contain only the selected projects/settings/media. Local Whisper processes audio in a dedicated browser worker; there is no remote transcription route.

The application has no built-in agent, chat, provider accounts, speech synthesis or remote media labeling. Startup removes obsolete provider credentials, pending authorization records and voice settings without connecting to a provider. Legacy backups cannot restore them. Historical agent sidecars and previously generated/imported media are preserved as inert local data; the removed runtime never restores or submits them. See [agent removal](ai.md).

Local error reports and notification history retain source diagnostics with credentials and URL parameters redacted. They are not automatically uploaded. A downloaded backup/export is a separate user-owned file. Clearing browser site data affects the entire origin and can remove local projects and originals; export needed work first.

Browser-local scripts can access same-origin storage. Prefer a dedicated trusted origin for self-hosting. No runtime secrets or provider keys are required.

Guest project code executes in QuickJS inside a terminable worker with a virtual project filesystem and networking disabled. It has no browser, provider, other-project or immutable-original access. Its local API remains available independently of the removed assistant.

## Browser agent access

[WebMCP](webmcp.md) exposes the viewed project’s content, attached asset notes, local transcripts and generated previews/exports to the browser agent you use. Its provider may process results under its policies. The workspace tool can list local project summaries, create/open requested projects and start browser file selection, including on an empty screen. It cannot read host paths from JSON; the browser/agent file-selection capability supplies authorized files to the normal local importer. Files are copied to browser storage, not uploaded to a LocalCut server. Registration alone leaves editing storage and workers idle. These tools do not select a provider, send OpenRouter requests or expose saved credentials. Requested edits use the canonical editor without a second LocalCut approval step; local model preparation remains explicit.

The [skills tool](skills.md) fetches public same-origin workflow Markdown/index files only on request. It reads no local project data or credentials, starts no inference and sends no provider requests. Attached asset notes remain local until an explicitly connected agent reads the project/asset or a user exports an including backup.
