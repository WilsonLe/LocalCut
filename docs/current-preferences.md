# Current preference index

The [13 November sound-library request](user-preferences.md#sound-effects-library--13-november-2026) adds researched, reusable sound effects and asks for a larger, tagged collection that external agents can search easily. See the [library contract and source decisions](sound-effects.md).

The [agent-provided speech decision](user-preferences.md#agent-provided-stt-and-tts--12-november-2026) removes bundled Whisper entirely. Skills request STT/TTS from the calling agent; saved transcript and caption data remain compatible. See [speech and captions](transcription.md).

The [asset-content decision](user-preferences.md#asset-content-without-indexing-controls--12-november-2026) supersedes the earlier indexing-control request. Asset clicks open editable context/transcript and source-clip details; analysis stays internal with no user-facing Index controls.

The [browser-agent readiness decision](user-preferences.md#browser-agent-readiness-and-manual-refresh--12-november-2026) adds visible registration status, connection help and manual refresh without claiming a verified agent connection.

The [built-in-browser-first decision](user-preferences.md#built-in-browser-first-for-agents--12-november-2026) applies to interactive agent use, manual previews and every published skill. See [browser selection](browser-support.md#agent-browser-selection) for fallback and local-project transfer; required native Chrome validation remains in force.

The [source-clip and copy decision](user-preferences.md#source-clips-and-task-facing-copy--12-november-2026) supersedes flat asset notes with annotated source clips and removes explanatory UI metatext.

The [portable-skills and asset-text decision](user-preferences.md#portable-editing-skills-and-asset-reference-text--12-november-2026) adds self-contained external-agent guidance and editable asset reference text; see [skills](skills.md).

The separately authorized [WebMCP integration](webmcp.md), [12 November autonomous setup decision](user-preferences.md#autonomous-browser-project-setup--12-november-2026) and [11 November browser-agent decision](user-preferences.md#vendor-neutral-browser-agent-control--11-november-2026) permit external compatible agents to create/open projects, import local files and control the viewed project. This does not restore product chat, provider adapters or the removed built-in assistant.

The [11 November 2026 agent removal decision](user-preferences.md#remove-agent-ai-features--11-november-2026) supersedes all earlier requirements for assistant access, chat, providers, remote transcription, speech generation and agent tools. Keep the [dated preference record](user-preferences.md) for history.

| Changing                         | Current contract                                                  |
| -------------------------------- | ----------------------------------------------------------------- |
| Shared editing and architecture  | [Architecture](architecture.md), [API](api.md)                    |
| Local validation and releases    | [Development](development.md), [deployment](../DEPLOY.md)         |
| Local persistence and backups    | [Storage](storage.md)                                             |
| Workspace and accessibility      | [Workspace](workspace.md), [UI guide](../src/workspace/AGENTS.md) |
| Browser updates                  | [Browser support](browser-support.md)                             |
| Agent-provided speech            | [Transcription](transcription.md)                                 |
| Privacy and retired agent data   | [Privacy](privacy.md), [agent removal](ai.md)                     |
| Storyboards and local coding API | [Storyboard workflows](storyboard-workflows.md), [API](api.md)    |

For other behavior, use the [documentation index](README.md). Newer explicit choices take precedence; preserve dated entries and update the owning contract when a choice changes.
