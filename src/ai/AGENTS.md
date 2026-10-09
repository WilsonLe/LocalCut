# Optional AI integration

- Own the headless OpenRouter adapter, authentication, context policy, stream parser, and assistant. Keep imports and construction inert; consumers initiate connection and requests.
- Keep keys in memory. Only expiring PKCE state/verifier data belongs in tab-scoped OAuth storage; callback secrets and provider error bodies must not leak through logs or public errors.
- Credential replacement, disconnect, and disposal invalidate old generations and abort their work. Late responses cannot restore credentials or publish proposals for a retired session.
- Require an explicit tool-capable model; retain no automatic model fallback. Capture the project's identity, revision, selected asset allowlist, and context policy for each assistant session.
- Names, overlay/caption text, and transcripts are separate opt-ins. Build remote context through `context.ts`; never expand the allowlist or send raw media.
- Treat provider text and tool arguments as untrusted. Enforce existing byte/round/tool limits and complete terminal stream validation before exposing executable tool calls.
- Tools may inspect and propose. `applyProposal` retains the edit-only contract; explicit `approveProposal` can also execute reviewed history/export/transcription/preparation actions. Preserve request IDs, stale-revision rejection and committed results during disposal. Never let a model approve its own proposal, prepare a model automatically or trigger a browser Save.
- Model/privacy changes require a new session. Cancellation discards unfinished proposals without allowing late work to republish them. Forward only bounded progress and result metadata; retain export Files locally and dispose them with their owner. Local transcription approval never grants remote transcript sharing.

Check the relevant protocol/authentication/assistant cases without a paid provider:

```sh
pnpm test tests/unit/openrouter-auth.test.ts tests/unit/openrouter-protocol.test.ts tests/unit/assistant.test.ts
```

Use `pnpm test:browser tests/browser/ai.spec.ts` for production-entry integration after current builds. [AI contracts/privacy](../../docs/ai.md) own live-provider prerequisites; [development](../../docs/development.md) owns the wider validation loop.
