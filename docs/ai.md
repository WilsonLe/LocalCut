# OpenRouter integration

The optional `ai.js` entry provides authentication, a text-only OpenRouter transport, and a headless editing assistant. It does not add UI or start work. The blank application imports neither the editor nor the AI entry. Both entries and their declarations are produced at `/` and `/LocalCut/`; no backend, callback rewrite, runtime environment variable, or bundled key is required.

## Frontend wiring

Load the modules after the user chooses to connect. The frontend owns connection controls, the conversation view, model selection, progress, proposal review, and error presentation. The shared editor remains the only owner of project state.

```ts
import { createEditor } from '/LocalCut/editor.js';
import { createOpenRouter, createAssistant } from '/LocalCut/ai.js';

const editor = await createEditor();
const project = await editor.projects.open(selectedProjectId);
const provider = createOpenRouter();
provider.setKey(userEnteredOpenRouterKey); // Keep input and key out of logs.
const models = await provider.listModels();
// Present models.filter(model => model.supportsTools); user selects one.
const assistant = createAssistant({
  editor,
  provider,
  projectId: project.id,
  model: selectedModelId,
  assetIds: selectedLibraryAssetIds, // Explicit additional media the user shares.
  context: {
    includeText: false,
    includeAssetNames: false,
    includeTranscripts: false,
  },
});
const unsubscribe = assistant.subscribe((event) => {
  // Render text as text, never as executable HTML. Treat suggestions as untrusted.
  renderAssistantEvent(event);
});
const turn = assistant.run('Shorten the opening clip to three seconds.');
const result = await turn.completion;
for (const id of result.proposalIds) {
  const proposal = assistant.getProposal(id);
  showProposalForReview(proposal);
}
// Only from the frontend's explicit Apply action:
const receipt = await assistant.applyProposal(selectedProposalId);
// Or: assistant.discardProposal(selectedProposalId).
// Undo uses the existing editor API and the current revision:
const current = await editor.projects.snapshot(project.id);
await editor.commands.undo(project.id, crypto.randomUUID(), current.revision);

unsubscribe();
await assistant.dispose();
provider.dispose();
await editor.dispose();
```

These examples show application integration points such as `renderAssistantEvent`; they are not product controls shipped by this change. Generated public declarations are in `dist/types/ai/index.d.ts` and `dist/types/editor/index.d.ts`. The source import is `src/ai/index.ts`. A frontend may dynamically import it; keep it out of the application's initial import graph until needed.

One assistant is bound to one project, model and immutable context policy. Create another session to change these. `assetIds` is a copied allowlist of up to 1,000 additional imported library assets; selected media are inspected on demand and must be ready before a proposal can reference them. Multiple assistants may share a provider; disposing an assistant cancels its own turn and does not dispose the provider or editor. Disconnecting/disposing the provider cancels its in-flight requests. Await `assistant.dispose()` before disposing the editor; this waits for any already-started apply to settle. A browser reload loses API credentials and conversation state; project edits already committed through the editor remain.

## Connect with OpenRouter PKCE

`beginAuthorization` returns a URL; it never opens a window or navigates. It generates a cryptographically random verifier/state and an S256 challenge. Temporary verifier/state are kept in the tab's session storage under a LocalCut-owned key for at most ten minutes. The API key is never written to storage.

```ts
const provider = createOpenRouter();
const callbackUrl = new URL('/LocalCut/', location.origin).href;
const { authorizationUrl } = await provider.beginAuthorization({ callbackUrl });
// From an explicit Connect action:
location.assign(authorizationUrl);
```

Use the existing static page as the callback, `/` for a root deployment or `/LocalCut/` for GitHub Pages. A future frontend must explicitly handle the callback; the current blank shell does not. On return, capture the full URL, then remove `code`, `state` and OAuth error fields from the visible address before asynchronous work or analytics. Keep any original non-OAuth query parameters unchanged:

```ts
const callbackUrl = location.href;
const clean = new URL(callbackUrl);
for (const name of ['code', 'state', 'error', 'error_description'])
  clean.searchParams.delete(name);
history.replaceState(history.state, '', clean.href);
const provider = createOpenRouter();
await provider.completeAuthorization({ callbackUrl });
// provider.status() is now { connected: true }; no raw key is returned.
```

The helper rejects URL fragments and verifies the registered callback origin/path/query, state, expiry and single-use record before exchanging the code. Denial is handled without assuming OpenRouter supplies state on denial. Invalid or failed callbacks require a fresh connection attempt. Storage unavailable means an explicit auth failure; there is no silent insecure fallback. Host-specific storage can be supplied via `oauthStorage` or individual authorization options. Do not put credentials in project JSON, localStorage, URLs, exception text or telemetry. No management key is used. `setKey` is an alternative for an existing user-owned OpenRouter API key. `status().connected` reports local credential presence, not verified credit or account health.

`disconnect()` clears the in-memory key, removes owned pending OAuth state and aborts in-flight work. `dispose()` also makes the client unusable. Neither operation revokes the remote key; users control revocation and spending limits in OpenRouter. Memory-only storage reduces persistence exposure but cannot protect an active key from malicious same-origin scripts, browser extensions or an already compromised page. PKCE protects the authorization exchange, not an unlocked browser runtime. No encryption vault is included.

## Protocol and tool boundaries

The adapter sends requests only to fixed HTTPS OpenRouter endpoints with omitted browser cookies, no referrer and no redirects. `listModels()` fetches the current catalog explicitly. Every chat validates the selected model supports tools before sending. No default model or silent model/provider downgrade is selected. User-selected provider aliases beginning with `~` are supported; their underlying model can change at OpenRouter. `openrouter/auto` is not selected or accepted. Requests use `provider.require_parameters: true` and `provider.data_collection: 'deny'`; a policy or capability failure is surfaced. No plugins, server tools, image inputs or arbitrary endpoint options are exposed.

Streaming uses bounded UTF-8/SSE parsing and handles comments, split network chunks, CR/LF boundaries, multiline data, incremental tool arguments and final usage accounting. The adapter requires a complete terminal response and `[DONE]` before exposing executable tool calls. Truncated, malformed, refused, oversized and provider-error streams fail. No automatic retry can duplicate a provider charge. Abort cancels local consumption and HTTP work; whether upstream billing stops depends on the provider.

The assistant exposes only these local tools:

| Tool              | Scope                                                                |
| ----------------- | -------------------------------------------------------------------- |
| `inspect_project` | Selected revision, redacted by the context policy                    |
| `inspect_asset`   | Metadata for project assets or explicitly selected library asset IDs |
| `read_transcript` | Explicitly enabled source transcripts referenced by that project     |
| `propose_edits`   | Validated atomic operations; creates a pending proposal only         |

Tool definitions derive operation schemas from the existing core contract. Unknown tools, extra fields, invalid IDs/ranges, unselected assets or foreign transcripts and invalid operations fail locally. All streamed text, model tool arguments, media names and transcript content are untrusted data. The model cannot fetch arbitrary URLs, run JavaScript, import media, read credentials or modify project storage. A prompt injection cannot expand the tool allowlist or bypass apply/revision validation.

A completed turn publishes cloned proposals with host-generated IDs and immutable internal command batches. `getProposal()` returns a copy; editing it cannot change what Apply commits. The batch is bound to the snapshot revision and has a stable request ID. Apply delegates to the existing atomic engine transaction, preserving its idempotency, asset validation, history and Undo. A concurrent project edit produces `REVISION_CONFLICT` and requires a new proposal. Concurrent application of the same proposal shares one result. Cancellation/disposal does not roll back an already committed edit or erase its receipt.

The assistant stages proposals until the whole turn succeeds. A fatal malformed response, cancellation or turn-budget error discards staged proposals, leaving project state unchanged. Recoverable tool errors return sanitized error results to the model for correction within the same budget; invalid operations are never staged. Consumers should clearly distinguish streamed narration from the eventual completed proposal. Sessions permit one active turn, bounded history, explicit `clearHistory`, disposal, turn cancellation, and listener unsubscription.

## Privacy and resource limits

The user's prompt and structural project metadata are sent only by explicit `run()`. Defaults withhold project/asset names, overlay/caption text and transcript content. `includeAssetNames` also includes the project name. `includeText` enables overlay text and caption cues; `includeTranscripts` enables the transcript tool. The caller must obtain the user's choice before enabling these options. The prompt itself can contain sensitive information; redacting project fields does not redact user-entered text.

Raw source files, frame images, thumbnails, PCM, private browser files, complete backups and API keys are never supplied to the assistant tools. Editor media processing and local Whisper inference remain local. OpenRouter is a remote service: unlike local transcription, this feature sends selected text and metadata off the device. `data_collection: 'deny'` filters upstream provider data policies; it does not guarantee zero retention by OpenRouter or override the user's account logging settings. Zero-retention routing is not promised. See [OpenRouter data collection](https://openrouter.ai/docs/guides/privacy/data-collection) and [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection).

Defaults per assistant: six model rounds per turn, 24 tool calls, 50 operations per proposal, 20 retained proposals, eight history turns, 256 KiB request context, 128 KiB accumulated output, and 4,096 requested output tokens per round. These are bounded configuration options, not a guaranteed dollar cap. Provider-reported token usage and optional cost are exposed through events/results. Configure spending limits with OpenRouter; LocalCut does not mint or manage billing credentials. The transport applies a 120-second total timeout per HTTP operation by default.

Errors use stable `AiError.code` values: authentication/expiry, credits, rate limits, network/timeout, unsupported models, malformed/incomplete responses, context/tool/response limits, forbidden tools, rejected edits, stale revisions, cancellation, busy state and disposal. Provider response bodies are not surfaced as error text, since they can echo credentials or private content. HTTP status and bounded retry-after metadata may be provided. A retry is always an explicit caller action.

## Verification

`pnpm check` includes unit protocol/auth/controller tests, both static builds and production Chrome integration with intercepted OpenRouter responses and the real local editor. Interception makes deterministic failure-path tests possible; it does not prove authenticated live provider behavior. Tests cover privacy redaction, OAuth callback reload, explicit proposal/apply/Undo and persistence, stale revisions, idempotency, cancellation, malformed streams, credential races, resource bounds and inert imports. The initial app graph excludes both optional entries and all AI dependencies count toward the aggregate budget.

The public catalog and CORS were checked without a key on 2026-10-10 (Sydney): model GET returned 200, and auth/chat OPTIONS returned 204 permitting bearer-header browser calls. This verifies public connectivity only.

For a separately authorized real-provider acceptance run, inject a user-owned key through a private process environment and select an explicit tool-capable model. Both production builds must exist:

```sh
LOCALCUT_OPENROUTER_LIVE=1 LOCALCUT_OPENROUTER_MODEL=provider/model pnpm test:ai:live
```

`OPENROUTER_API_KEY` must already be set securely; never paste a real key into a tracked script or command history. This command can incur provider charges. It asks for one synthetic track, validates the returned proposal, applies it through the actual engine and undoes it. Missing opt-in/key/model fails before any provider request, rather than becoming a passing skip. Tracing, screenshots, videos and response attachments are disabled for this suite. Normal CI never needs or receives a real provider key. OAuth login/consent still needs an interactive account test once a frontend exists.

No UI, model account, backend, schema migration or deployment change is included. Rollback consists of reverting the additive AI module/build/docs changes; existing project documents remain compatible.
