# Privacy and data flows

LocalCut is a static browser application. It has no application backend or cloud project sync. That does not mean all network traffic is absent: the browser fetches the application, explicitly prepared inference assets and optional provider requests. Hosting and provider services may process their own request/account information under their policies.

## Data boundaries

| Action or data                                        | Where it goes / persists                                                                                                                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Imported originals, editing, preview and video export | Browser-local media processing; originals in OPFS, project records in IndexedDB                                                                                                           |
| Saved projects, versions and workspace preferences    | This browser profile and origin; no automatic cross-device transfer                                                                                                                       |
| Default local Whisper transcription                   | Selected audio stays local; explicit preparation downloads pinned model/runtime assets into the named cache                                                                               |
| Chat                                                  | User prompt and bounded permitted project context go to the configured LLM route; names, text and transcripts have separate session sharing options, off by default                       |
| Asset indexing                                        | Separate remembered permission plus explicit Index can send generated stills, audio/video excerpts with sound to the selected OpenRouter model; it does not send the original source file |
| Text to speech                                        | Explicit Generate sends the authored script, voice, languages and delivery instructions through the configured TTS route; resulting audio becomes a local asset when added                |
| Remote transcription                                  | Explicitly configured STT routes plus an approved transcription job may send selected decoded audio to the disclosed endpoints; local Whisper remains the default                         |
| Portable backups                                      | The user downloads selected preferences/projects/versions and optional originals; provider credentials and sharing consent are excluded                                                   |

Service routes may include ordered fallbacks. Each possible remote transcription recipient is disclosed before approval, and a failed provider attempt may still incur a charge. Indexing does not fail over to custom endpoints/ChatGPT. See the [AI contract](ai.md#providers-and-fallback) for exact service capabilities, limits and cancellation behavior.

## Credentials and consent

OpenRouter credentials persist in a separate browser-local record and may restore the connection/catalog after reload. Compatible-endpoint keys are session-only. ChatGPT tokens persist separately and are restored through an explicit action; refresh may occur on a provider request. Disconnect removes the provider's saved credential record where supported.

Browser localStorage can be read by scripts executing on the same origin; this is not an OS-protected credential vault. Do not connect sensitive accounts on shared computers or untrusted copies of the app. Prefer a dedicated origin for self-hosting. Build-time variables cannot safely conceal a provider key in a static application.

Remembering a model or restoring a connection does not authorize paid inference or new data sharing. Chat text/name/transcript consent is session-only; indexing permission is remembered separately. Conversations are not restored across reloads. For authoritative details use [AI credentials and frontend wiring](ai.md) and [workspace behavior](workspace.md).

## Retention, removal and recovery

Browser storage is subject to quotas, eviction and user deletion. Keep originals and portable backups outside the app, and verify a backup in a separate profile before clearing data. Use supported app operations for project/asset removal; manual IndexedDB/OPFS edits can break ownership and recovery invariants. Clearing a model cache does not delete saved transcripts, media or edits. See [storage](storage.md) and [transcription](transcription.md).

Disconnecting locally does not necessarily revoke a provider-issued credential or erase data already sent to a provider. Use provider account controls for revocation/remote retention. A downloaded export or backup is a separate file and remains until you remove it. Browser site-data clearing is destructive and affects the entire origin; export first and understand the scope.

Do not publish private media, project archives, transcripts, callback addresses, tokens or raw storage/network traces in support reports. Use generated samples and redact screenshots/logs. Follow [SECURITY.md](../SECURITY.md) for suspected data disclosure or credential vulnerabilities.
