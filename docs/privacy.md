# Privacy and local data

LocalCut is a static browser application with no application backend or cloud project sync. The browser fetches the static application; it downloads no speech models or inference runtime. Hosting services may process their own request information.

Project documents, originals, transcripts, source-clip context/transcript text, editing history, reusable media analysis, exports and temporary processing files stay in browser-local IndexedDB/OPFS. Appearance and editor layout use separate whitelisted localStorage records. The retired recent-project identity record is ignored. Portable backups contain only the selected projects/settings/media. LocalCut has no speech inference engine or remote transcription route. External agents may process selected media through their own authorized STT/TTS capabilities; see [speech contracts](transcription.md).

The application has no built-in agent, chat, provider accounts, speech synthesis or remote media labeling. Startup removes obsolete provider credentials, pending authorization records and voice settings without connecting to a provider. Legacy backups cannot restore them. Historical agent sidecars and previously generated/imported media are preserved as inert local data; the removed runtime never restores or submits them. See [agent removal](ai.md).

Local error reports and notification history retain source diagnostics with credentials and URL parameters redacted. They are not automatically uploaded. A downloaded backup/export is a separate user-owned file. Clearing browser site data affects the entire origin and can remove local projects and originals; export needed work first.

Browser-local scripts can access same-origin storage. Prefer a dedicated trusted origin for self-hosting. No runtime secrets or provider keys are required.

Guest project code executes in QuickJS inside a terminable worker with a virtual project filesystem and networking disabled. It has no browser, provider, other-project or immutable-original access. Its local API remains available independently of the removed assistant.

## Browser agent access

Browser-agent status keeps registration readiness, tool counts and the last request time in memory for this page. It stores no request arguments/results, agent identity or persistent activity history, and starts no heartbeat or background request. See [status and refresh](webmcp.md#connection-status-and-refresh).

[WebMCP](webmcp.md) exposes the viewed project’s content, source-clip text, local transcripts and generated previews/exports to the browser agent you use. Its provider may process results under its policies. The workspace tool can list local project summaries, create/open requested projects and start browser file selection, including on an empty screen. It cannot read host paths from JSON; the browser/agent file-selection capability supplies authorized files to the normal local importer. Files are copied to browser storage, not uploaded to a LocalCut server. Registration alone leaves editing storage and workers idle. These tools do not select a provider, send OpenRouter requests or expose saved credentials. Requested edits use the canonical editor without a second LocalCut approval step; STT/TTS are supplied by the external agent, with media processing governed by that host and the user’s authorization.

The [skills tool](skills.md) fetches public same-origin workflow Markdown/index files only on request. It reads no local project data or credentials, starts no inference and sends no provider requests. Source-clip annotations remain local until an explicitly connected agent reads the project/asset or a user exports an including backup.
