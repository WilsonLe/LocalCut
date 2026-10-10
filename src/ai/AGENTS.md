# Optional AI integration

- Own provider adapters, service routing, authentication, context policy, stream parsers, and assistant. Keep imports and construction inert; consumers initiate connection and requests.
- Keep runtime keys private. Compatible-endpoint keys remain session-only. ChatGPT OAuth tokens use their dedicated origin-local record, explicitly restored and removed on Disconnect. The workspace opts into a separate persistent credential record; headless clients remain memory-only unless supplied credential storage. Restore is explicit and network-free; Disconnect deletes the record, while disposal preserves it. Only expiring PKCE state/verifier data belongs in tab-scoped OAuth storage; callback secrets and provider error bodies must not leak through logs or public errors.
- Credential replacement, disconnect, and disposal invalidate old generations and abort their work. Late responses cannot restore credentials or publish proposals for a retired session.
- Require an explicit tool-capable model. Only user-configured ordered LLM/TTS/STT routes permit fallback; stop after visible chat output, cancellation, refusal or invalid requests. Indexing retains no automatic model/provider fallback. Capture the project's identity, revision, selected asset allowlist, and context policy for each assistant session.
- Names, overlay/caption text, and transcripts are separate opt-ins. Build remote context through `context.ts`; never expand the allowlist or send raw media through chat. The separately consented indexer sends generated local stills, audio excerpts and video excerpts with sound; preserve dedicated selected-model validation, safe manifests and explicit retries.
- Treat provider text and tool arguments as untrusted. Enforce existing byte/round/tool limits and complete terminal stream validation before exposing executable tool calls.
- Keep the initial tool surface to skill loading and core inspection. The fixed catalog in `skills.ts` owns discovery; dynamically import domain guidance from `skills/` only after an explicit `load_skill`. Recompute tool/action schemas each round, enforce the frozen round authority at execution, and reset loads per turn. Skill loading never grants approval, service capability or context-sharing consent.
- Tools may inspect and propose. `applyProposal` retains the edit-only contract; explicit `approveProposal` can also execute reviewed history/export/transcription/preparation actions. Preserve request IDs, stale-revision rejection and committed results during disposal. Never let a model approve its own proposal, prepare a model automatically or trigger a browser Save.
- Model/privacy changes require a new session. Cancellation discards unfinished proposals without allowing late work to republish them. Forward only bounded progress and result metadata; retain export Files locally and dispose them with their owner. Transcription proposals disclose the frozen local/remote STT route from trusted configuration; a model cannot alter recipients. Approval may send the selected audio to the listed STT endpoints but never grants remote transcript-text sharing.

- Speech discovery/requests reuse this adapter's in-memory credentials, cancellation generation and fixed endpoints. Offer instruction-capable Gemini models with advertised voices and the documented PCM contract; never share source media or project context. `speech-audio.ts` owns local pitch-preserving timing and WAV rendering; controls do not duplicate that processing or retry paid generation automatically.

Check the relevant protocol/authentication/assistant cases without a paid provider:

```sh
pnpm test tests/unit/openrouter-credentials.test.ts tests/unit/openrouter-auth.test.ts tests/unit/openrouter-protocol.test.ts tests/unit/assistant.test.ts
```

Use `pnpm test:browser tests/browser/ai.spec.ts` for production-entry integration after current builds. [AI contracts/privacy](../../docs/ai.md) own live-provider prerequisites; [development](../../docs/development.md) owns the wider validation loop.
