# Agent AI removal

On 11 November 2026 the user requested complete removal of agent AI features. This supersedes earlier assistant-access, chat, provider and speech-generation preferences.

LocalCut has no assistant, chat, AI settings, provider connection, remote transcription or generated narration. The former `ai.js` entry and its declarations are no longer published. Headless integrations use [the editor API](api.md) only.

Manual editing, the storyboard and local media analysis remain. The later [speech decision](transcription.md) removes bundled Whisper and delegates STT/TTS to external agents. No provider account is needed. Pure speech timing helpers and saved transcript metadata remain readable for project compatibility; synthesis and generated-audio measurement services are removed.

On startup LocalCut removes obsolete local provider credentials, pending authorization state and voice presets. Saved workspace preferences discard chat/model/provider fields. Legacy backups still import supported local preferences and project data. Historical chat/reference sidecars and previously imported/generated media are left untouched; no runtime opens or restores the retired sidecars. Removing a feature does not delete original media or authored projects. See [privacy](privacy.md) and [storage](storage.md).

Earlier requirements are retained in the [dated preference record](user-preferences.md) as history, not current product contracts.

## External browser integration

The separately requested [WebMCP site tools](webmcp.md) expose the shared local editor to compatible browser agents. They do not restore this removed product assistant, chat, provider adapters or remote inference. The [tool inventory](webmcp.md#tool-inventory) owns current external editing access.
