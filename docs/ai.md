# AI providers and service routing

The optional `ai.js` entry provides OpenRouter, user-configured OpenAI-compatible endpoints, ChatGPT OAuth/Responses, independent LLM/TTS/STT routing, and a headless editing assistant. STT defaults to local Whisper, with opt-in timestamp-capable OpenAI-compatible providers. Importing it does not start work. The workspace loads it only for explicit AI connection, saved OpenRouter credential restoration or an OAuth return; navigation without saved credentials imports neither the editor nor the AI entry. Both entries and their declarations are produced at `/` and `/LocalCut/`; no backend, callback rewrite, runtime environment variable, or bundled key is required.

## Providers and fallback

`createOpenAICompatible({ baseUrl, model, speechModel, voices, transcriptionModel })` reuses the bounded OpenRouter transport/parser. Specify an HTTPS base URL or HTTP loopback URL, without embedded credentials, query parameters or fragments. A local server may use an empty API key. Declare the exact tool-capable chat model; there is no guessed catalog or automatic model choice. Optional speech support requires an explicit model, voices, delivery-instruction support and signed 16-bit little-endian, 24 kHz mono PCM from `/audio/speech`. The adapter removes OpenRouter-only request extensions. Browser endpoints must permit the app origin through CORS; browser/private-network policy may restrict loopback access from hosted Pages.

`createServiceRouter(connections, routes)` freezes independent provider/model lists for LLM, TTS and STT. Catalog discovery tries the configured order, skipping disconnected providers and recoverable outages. The provider that supplies the catalog owns the user's current model/voice selection; every other route uses its explicitly configured model and (for speech) voice. `selectedProvider('llm' | 'tts')` identifies that catalog owner, so persisted choices update its route rather than the unavailable primary. Each provider is tried once. Network/timeouts, unavailable providers, rate limits and authorization/credit failures permit the next route; invalid requests, refusals, protocol/limit errors and cancellation stop. Chat never falls back after a text or complete event is published. Multi-provider history omits provider-specific reasoning signatures. Speech can fail over before a complete audio result is returned; a failed attempt may still incur a charge. Indexing never fails over or sends its evidence to a custom endpoint/ChatGPT.

Router disposal aborts its operations but leaves reusable named connections owned by the consumer. Credential replacement/removal must dispose the old connection and retire its router/conversations. Empty service lists disable that service. STT uses `router.transcribe` as the editor's per-job `TranscriptionExecutor`, preserving shared PCM extraction, cancellation and validated transcript persistence. Configure `local`/`whisper` and/or connections declaring `transcriptionModel`; OpenRouter and ChatGPT are not STT providers here. A missing local model can advance to a configured remote fallback without downloading weights. Remote STT uses [OpenAI-compatible audio transcription](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create) with 16 kHz mono WAV, at most 25 MB per request, `verbose_json` segment timestamps and optional language. Untimed, malformed or unordered segments fail without switching providers. Source timestamps are clamped to the approved range. Use a timestamp-capable model such as `whisper-1`; a service offering only plain-text JSON is incompatible.

The assistant freezes the STT executor and trusted disclosure with its session. Each transcription proposal shows all possible audio recipients before approval; model-authored summaries cannot hide that notice. Changing routes or disconnecting retires the session and aborts old work. Configuration alone never uploads audio. Approved transcription may send selected source audio through this route, while transcript-text sharing remains a separate session opt-in.

## ChatGPT sign-in

LocalCut follows OpenAI's [open-source sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) and [public Responses inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) contracts. It creates a stable origin-local host ID and starts dynamic registration using its own LocalCut name, random state/nonce and PKCE S256. Returning sign-ins reuse the saved issued client ID and verified subject. No Codex client ID, private `backend-api`, client secret or partner key is used.

Continue with ChatGPT opens a separate sign-in tab. After authorization, copy the entire `http://127.0.0.1:1455/auth/callback?...` address, even when the browser reports that the page cannot load, and paste it into Callback URL. The static app does not bind a localhost server. It requires the exact loopback host/path, fresh single-use pending attempt, unique matching state/code and issued client ID. It exchanges the code with the original PKCE verifier and exact redirect URI, verifies the ID token signature against OpenAI's fixed JWKS plus issuer/audience/expiry/nonce, and checks the granted ChatGPT-plan scopes. The input is cleared before exchange; neither the URL nor code is saved.

Validated tokens live in `localcut.chatgpt-credentials.v1`, separately from preferences/project storage and portable backups. Browser localStorage is readable by scripts running on this origin; LocalCut does not claim an OS-protected vault. This user-requested browser persistence differs from OpenAI's [protected runtime credential storage guidance](https://developers.openai.com/siwc/token-sharing-open-source/token-reference); LocalCut does not claim compliance with that storage requirement. Restore saved ChatGPT explicitly reads that record after reload. It does not initiate paid inference. Expired access tokens refresh on a provider request; Web Locks serialize rotation across tabs, and record/generation checks reject late refreshes after replacement/disconnect. Each sign-in captures the durable authority revision and credential session before exchange; a later sign-in or disconnect invalidates it, including an initially empty session. Inference/catalog publication stays bound to the restored session; same-session token rotation may be adopted, but replacement requires explicit restore. Dispose preserves the record; Disconnect removes it. No tokens enter public status, assistant messages, logs or URLs. Expiring PKCE state is tab-scoped.

Catalog uses the account-specific `/v1/models`; inference uses `/v1/responses` with `store:false` and `stream:true`. Text can stream early, but tool calls publish only after a fully validated `response.completed` terminal event and stream exhaustion. Failed, incomplete, refused, oversized or malformed responses never publish executable calls. This connection supports LLM only.

Live account sign-in, plan entitlement, browser CORS availability and paid inference are external acceptance boundaries. Synthetic signed-token/browser tests verify LocalCut's flow, not account/provider acceptance. Do not save callback/token bodies in live-test traces or screenshots.

## Frontend wiring

Load the modules after the user chooses to connect. The frontend owns connection controls, the conversation view, model selection, progress, proposal review, and error presentation. The shared editor remains the only owner of project state. The composer information icon reveals the selected provider/model and a Configure AI action. Its connection dialog uses one searchable model dropdown with an inline refresh icon; Data & analytics reveals the separate, initially unchecked sharing opt-ins. Session switching preserves drafts and transcripts within the current project/model/context scope. See [workspace behavior](workspace.md) for the UI contract.

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

These examples show application integration points such as `renderAssistantEvent`; the workspace provides those controls through this same API. Generated public declarations are in `dist/types/ai/index.d.ts` and `dist/types/editor/index.d.ts`. The source import is `src/ai/index.ts`. A frontend may dynamically import it; keep it out of the application's initial import graph until needed.

One assistant is bound to one project, model and immutable context policy. Create another session to change these. `assetIds` is a copied allowlist of up to 1,000 additional imported library assets; selected media are inspected on demand and must be ready before a proposal can reference them. Multiple assistants may share a provider; disposing an assistant cancels its own turn and does not dispose the provider or editor. Disconnecting/disposing the provider cancels its in-flight requests. Await `assistant.dispose()` before disposing the editor; this waits for any already-started apply to settle. The workspace restores locally saved credentials after reload, while conversation state is lost; project edits already committed through the editor remain.

## Text to speech

The same connected provider exposes `listSpeechModels(signal)` and `synthesizeSpeech(request, signal)`. Speech discovery calls the [OpenRouter speech catalog](https://openrouter.ai/docs/guides/overview/multimodal/tts) only when the speech dialog opens or Refresh is clicked. It offers instruction-capable Gemini TTS models with advertised voices and a known 24 kHz, signed 16-bit little-endian mono PCM contract. Speech models need neither chat tools nor a chat context window; the chat catalog excludes non-text output models.

```ts
const speechModels = await provider.listSpeechModels();
// The user chooses an explicit current model and one of its advertised voices.
const audio = await provider.synthesizeSpeech(
  {
    model: selectedSpeechModel,
    voice: selectedVoice,
    script: 'Hello! Xin chào!',
    languages: ['English', 'Vietnamese'],
    instructions: 'Warm and friendly.',
  },
  controller.signal,
);
const { renderSpeech } = await import('/LocalCut/ai.js');
const result = await renderSpeech(
  audio,
  {
    mode: 'duration',
    durationSeconds: (audio.samples.length / audio.sampleRate) * 1.1,
  },
  controller.signal,
);
// Or { mode: 'speed', speed: 1.2 }. Preview result.file locally.
// Explicit Add imports this normal WAV through editor.assets.import.
```

Generate sends only the authored script, voice, selected languages and delivery instructions to `/audio/speech`, using the existing in-memory bearer key and `provider.data_collection: 'deny'`. It does not read project context, media, names, transcripts or chat sharing opt-ins. The input remains verbatim; natural conversational phrasing and pronunciation across declared languages are supplied as separate instructions. Scripts are bounded to 5,000 characters, delivery instructions to 1,500, languages to eight and audio responses to 24 MB. Missing or invalid catalog voices, non-PCM/error responses, cancellation, timeouts and stale credentials fail without publishing audio. No automatic retry or paid request occurs on dialog opening, changing controls, adjusting timing or adding a generated asset.

`renderSpeech` converts the bounded PCM into a normal WAV. Speed and target duration use local waveform-aligned overlap-add (WSOLA), preserving pitch rather than altering sample playback rate. Speed is bounded to 0.5–2×; a target must lie between half and twice the measured original duration. Impossible targets show the feasible range instead of trimming words, padding silence or making another paid request. Duration is exact to the nearest 24 kHz sample. Extreme stretching can still affect phrasing; audition before importing. Provider inference determines pronunciation and delivery quality, so a real connected-account listening check is required to judge naturalness.

Closing the dialog, disconnecting or switching projects cancels outstanding work and releases preview URLs. Explicit Add captures the current project revision before import and appends through the existing editor commands. Concurrent revisions reject the insertion and permit an explicit retry; already committed imports/edits remain durable. Imported WAV files follow normal project persistence, history, preview and export without a schema migration. The assistant cannot initiate or approve speech requests.

Deterministic tests use synthetic provider PCM and real stable Chrome imports/decoding/export at both static base paths. They prove transport, cancellation, multilingual settings, pitch and sample duration; they do not prove live paid inference or natural speech quality. No live key is bundled or required for `pnpm check`.

## Connect with OpenRouter PKCE

`beginAuthorization` returns a URL; it never opens a window or navigates. It generates a cryptographically random verifier/state and an S256 challenge. Temporary verifier/state and any original navigation hash are kept in the tab's session storage under a LocalCut-owned key for at most ten minutes. The provider receives a fragment-free callback URL; the local hash is included in `sanitizedCallbackUrl` only after successful verification and exchange. The workspace uses its existing router to restore the same local project or project-catalog route. This temporary OAuth record never contains the API key. Successful exchange also saves the key when the caller opts into credential storage.

```ts
const provider = createOpenRouter();
const callbackUrl = new URL('/LocalCut/', location.origin).href;
const { authorizationUrl } = await provider.beginAuthorization({ callbackUrl });
// From an explicit Connect action:
location.assign(authorizationUrl);
```

Use the existing static page as the callback, `/` for a root deployment or `/LocalCut/` for GitHub Pages. The workspace handles the callback on the same static page and immediately removes its OAuth query fields. On return, capture the full URL, then remove `code`, `state` and OAuth error fields from the visible address before asynchronous work or analytics. Keep any original non-OAuth query parameters unchanged:

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

The helper rejects fragments on returned provider callbacks and verifies the registered callback origin/path/query, state, expiry and single-use record before exchanging the code. Denial is handled without assuming OpenRouter supplies state on denial. Invalid or failed callbacks require a fresh connection attempt. Storage unavailable means an explicit auth failure; there is no silent insecure fallback. Host-specific storage can be supplied via `oauthStorage` or individual authorization options. Do not put credentials in project JSON, preferences, backups, URLs, exception text or telemetry. The workspace uses only the dedicated credential record described below. No management key is used. `setKey` is an alternative for an existing user-owned OpenRouter API key. `status().connected` reports local credential presence, not verified credit or account health.

`disconnect()` clears the runtime key, removes any opted-in saved credential and owned pending OAuth state, and aborts in-flight work. `dispose()` retires the runtime and makes the client unusable, preserving the saved credential for reload. Neither operation revokes the remote key; users control revocation and spending limits in OpenRouter. Browser-local storage is not an encryption vault and cannot protect a saved or active key from malicious same-origin scripts, browser extensions or an already compromised page. PKCE protects the authorization exchange, not an unlocked browser runtime. No encryption vault is included.

## Protocol and tool boundaries

The adapter sends requests only to fixed HTTPS OpenRouter endpoints with omitted browser cookies, no referrer and no redirects. `listModels()` fetches the current catalog explicitly. Every chat validates the selected model supports tools before sending. No default model or silent model/provider downgrade is selected. User-selected provider aliases beginning with `~` are supported; their underlying model can change at OpenRouter. `openrouter/auto` is not selected or accepted. Requests use `provider.require_parameters: true` and `provider.data_collection: 'deny'`; a policy or capability failure is surfaced. Chat exposes no media inputs, plugins, server tools or arbitrary endpoint options. The separately consented indexing path below accepts generated local evidence.

Provider reasoning text and signed/encrypted reasoning details are retained as bounded opaque conversation state for subsequent tool rounds. They are not emitted as user-visible text events or interpreted as tools.

Each `tool` event carries a locally generated `callId`, name and phase. After schema validation, the start event includes the parsed input; terminal events include the redacted result or a safe structured error. Match updates by `callId`, including repeated calls to the same tool. Details are limited to 32 KiB per field and at most 128 KiB per turn (or the configured context limit, if lower). Oversized details are omitted whole and marked with `inputOmitted`, `resultOmitted` or `errorOmitted`; raw invalid arguments and provider continuation data are never exposed. The workspace renders these as independently expandable calls.

Streaming uses bounded UTF-8/SSE parsing and handles comments, split network chunks, CR/LF boundaries, multiline data, incremental tool arguments and final usage accounting. The adapter requires a complete terminal response and `[DONE]` before exposing executable tool calls. Truncated, malformed, refused, oversized and provider-error streams fail. A standalone adapter never retries a charge; only explicitly configured service routes permit bounded failover. Abort cancels local consumption and HTTP work; whether upstream billing stops depends on the provider.

## Incremental domain skills

Every turn starts with only `load_skill`, `inspect_project` and `inspect_proposals`. The request includes a compact catalog of available skill IDs and descriptions. The system prompt instructs the model to select the relevant domain, load it, and add another skill only when the workflow crosses domains. The host does not infer a domain from keywords, so multilingual and compound requests use the same explicit selection mechanism.

| Skill           | Guidance and tools enabled                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editing`       | All canonical timeline, clip, audio, text/caption, effect, group and transition edits; asset/timeline/capability inspection, validation and edit proposals |
| `export`        | Browser codec preflight and local export proposals; offered only with engine export support                                                                |
| `transcription` | Local readiness, preparation/inference proposals and shared transcript reading, each filtered by engine support and sharing consent                        |
| `history`       | Undo/Redo proposals, each filtered by engine support                                                                                                       |

Guidance modules are dynamically imported from a fixed local registry when `load_skill` succeeds. No user/provider URL, arbitrary code or external skill installation is accepted. Full skill text is returned through the ordinary bounded tool result; it is absent from initial request context. Repeated loads in one turn return `already_loaded` without duplicating guidance. Loading a skill starts no engine service or model download and grants no edit approval or additional sharing consent.

The host rebuilds tool definitions for each model round. A successful load enables its tools on the **next** round. The current response's declared tools and allowed action variants remain frozen, so a load cannot authorize sibling calls in that same response. Guessed/unloaded tools and unsupported/unloaded action types are rejected before inspection, validation or proposal execution. `propose_action` contains only the loaded domains' supported schema variants, with a matching runtime check. Skill loading counts against existing round/tool/context limits and observes cancellation/disposal. Loaded authority resets on every turn; retained history keeps load receipts instead of full skill instructions and never authorizes current tools. Reload the relevant skill after user approval or for any follow-up request.

The tool audit retains the existing engine-backed operations behind those domain boundaries. Core inspection stays available for orientation and confirmed approval results; no mutation, arbitrary network, filesystem or code-execution tools are exposed. `inspect_capabilities` now describes editing rules only; service availability is disclosed through the catalog and loaded tools. Consumers of `ai.js` keep the same assistant API, but scripted providers must issue `load_skill` in a preceding round before domain calls.

The assistant exposes the following tools incrementally. Arguments derive from canonical edit/action schemas; optional tools and action variants require both the matching skill and supplied engine capability.

| Tool                    | Scope                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `load_skill`            | Load one available domain from the fixed catalog; no approval or service execution                                                                                    |
| `inspect_project`       | Selected revision, redacted by the context policy                                                                                                                     |
| `inspect_asset`         | Metadata for project assets or explicitly selected library asset IDs                                                                                                  |
| `inspect_timeline`      | Active clips, source positions, exact frame time, evaluated keyframes, audio gain, and transition weights at an integer microsecond time; no decoding or frame upload |
| `inspect_capabilities`  | Every supported edit operation, timing/effect rules, and edit approval boundaries                                                                                     |
| `inspect_proposals`     | Pending/applied proposal status and sanitized result metadata                                                                                                         |
| `inspect_transcription` | Cached model readiness and missing-asset count, without a download                                                                                                    |
| `read_transcript`       | Explicitly shared source transcripts referenced by the project or produced by approved actions in this session                                                        |
| `validate_edits`        | A complete dry run through the engine, returning affected IDs and the redacted resulting project; no commit or proposal                                               |
| `check_export`          | Native codec preflight for requested settings, with no encoding or output download                                                                                    |
| `propose_edits`         | Validated atomic operations; creates a pending proposal only                                                                                                          |
| `propose_action`        | A pending Undo, Redo, export, transcription, or model-preparation request; no service executes until approval                                                         |

All canonical edit operations are available through `editing`: add/remove/reorder tracks; insert/remove/update/trim/split/move/duplicate clips; constant speed and customizable speed ramps with change/preserve pitch; ripple placement; add/remove transitions and editable transition templates; audio separation; and group/ungroup/move/duplicate groups. `updateClip` exposes the full existing engine schema for position, dimensions, rotation, crop, opacity, brightness/contrast/saturation/grayscale/blur, gain/mute/fades, keyframes, text styles, caption cues, and transcript linkage. There is no smaller, independently maintained AI editing schema. Dry runs validate the final atomic state, including source bounds, unique IDs, and transition overlap. Validation errors return stable codes and bounded structural hints rather than local text, provider error bodies, or media names.

A completed turn publishes cloned proposals with host-generated IDs and immutable internal requests. `getProposal()` returns a copy; editing it cannot change what approval executes. Every proposal carries `batch.projectId`, `batch.expectedRevision`, and a stable `batch.requestId`. Ordinary edits retain their complete command batch. A service/history proposal carries an `action` and an empty `batch.operations` array used only as a revision envelope; that array is never sent to `commands.apply`.

`applyProposal(id)` remains the compatible edit-only API and returns its receipt. The workspace uses `approveProposal(id)` for any card:

```ts
const proposal = assistant.getProposal(selectedProposalId);
// Only from an explicit Apply/Approve action, after showing its action/settings:
const result = await assistant.approveProposal(proposal.id);
if (result.kind === 'export') {
  const artifact = assistant.exportArtifact(result.artifactId);
  // Keep artifact.file local. Offer a separate browser Save action.
  offerSave(artifact.file, result.name);
  // After Save or dismissal:
  await artifact.dispose();
}
// For a running export, transcription, or model-preparation card:
assistant.cancelProposal(selectedProposalId);
```

`approveProposal` returns a discriminated result: an edit/history receipt, local export metadata and artifact ID, transcript ID/source/cue count, or model-preparation readiness. Export files and storage paths never enter provider context. Progress appears in `proposal_progress` events and `proposal.progress`; worker details and raw errors are excluded. Export artifacts remain owned by the assistant until explicitly disposed or the assistant is disposed. Disposal cancels active service jobs and releases retained outputs. A service retry is always another explicit user approval, never an automatic model retry. Preparation and inference are separate approvals; an unprepared transcription fails without automatically downloading a model. Approving local transcription does not opt its text into remote context. Its new transcript can be linked to the source clip without sharing text, or read by the model only when `includeTranscripts` is enabled.

Edits and history delegate to the engine's atomic revision checks, persistent idempotency receipts, asset validation, and history. Export validates the authored revision before starting and the actual captured revision before publishing. A concurrent project edit produces `REVISION_CONFLICT` and requires a new proposal. Concurrent approval of one proposal shares one result; approving a completed export does not encode it again. Cancellation/disposal does not roll back an already committed edit or persisted transcript. No model tool can approve or cancel another proposal, trigger Save, or bypass the host approval action.

Atomic edit and history commits cannot be cancelled after submission. `cancelProposal` rejects those proposal types and treats a late cancellation of a completed service job as a no-op, preserving its artifact. Consumers should show cancellation only on running export, transcription and preparation jobs.

The API coverage boundary is explicit:

| Public engine family    | Assistant access                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commands                | Every edit operation through a dry run and reviewed batch; Undo/Redo through reviewed actions                                                                       |
| Export                  | Read-only native preflight; reviewed encoding; user-owned Save and artifact disposal                                                                                |
| Transcription           | Read-only cache status; separate reviewed preparation and inference; opt-in source-text inspection                                                                  |
| Assets                  | Selected/project metadata; local file selection, import and relink stay with the user                                                                               |
| Projects                | Selected snapshot; create/open/import/backup/delete stay in project UI, preventing cross-project access                                                             |
| Preview and derivatives | Structural timeline evaluation; presentation surfaces, playback activation, thumbnails, waveforms, and media bytes remain local and unavailable to the remote model |
| Lifecycle               | Caller-owned run cancellation, proposal service cancellation, session disposal and export cleanup; no arbitrary worker or storage access                            |

The assistant stages proposals until the whole turn succeeds. A fatal malformed response, cancellation or turn-budget error discards staged proposals, leaving project state unchanged. Recoverable tool errors return sanitized results to the model for correction within the same budget; invalid operations are never staged. All streamed text, arguments, names and transcript content remain untrusted data. The model cannot fetch arbitrary URLs, run JavaScript, import files, read credentials, delete projects, clear caches, expand asset selections, or approve its own proposal. Consumers should distinguish streamed narration from a completed proposal. Sessions permit one active turn, bounded history, explicit `clearHistory`, disposal, turn cancellation, and listener unsubscription.

## Privacy and resource limits

The user's prompt and structural project metadata are sent only by explicit `run()`. Defaults withhold project/asset names, overlay/caption text and transcript content. `includeAssetNames` also includes the project name. `includeText` enables overlay text and caption cues; `includeTranscripts` enables the transcript tool. The caller must obtain the user's choice before enabling these options. The prompt itself can contain sensitive information; redacting project fields does not redact user-entered text.

Raw source files, frame images, thumbnails, PCM, private browser files, complete backups and API keys are never supplied to the assistant tools. Editor media processing and local Whisper inference remain local. OpenRouter is a remote service: unlike local transcription, this feature sends selected text and metadata off the device. `data_collection: 'deny'` filters upstream provider data policies; it does not guarantee zero retention by OpenRouter or override the user's account logging settings. Zero-retention routing is not promised. See [OpenRouter data collection](https://openrouter.ai/docs/guides/privacy/data-collection) and [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection).

Defaults per assistant: six model rounds per turn, 24 tool calls, 50 operations per proposal, 20 retained proposals, eight history turns, 256 KiB request context, 128 KiB accumulated output, and 4,096 requested output tokens per round. These are bounded configuration options, not a guaranteed dollar cap. Provider-reported token usage and optional cost are exposed through events/results. Configure spending limits with OpenRouter; LocalCut does not mint or manage billing credentials. The transport applies a 120-second total timeout per HTTP operation by default.

Errors use stable `AiError.code` values: authentication/expiry, credits, rate limits, network/timeout, unsupported models, malformed/incomplete responses, context/tool/response limits, forbidden tools, rejected edits, stale revisions, cancellation, busy state and disposal. Provider response bodies are not surfaced as error text, since they can echo credentials or private content. HTTP status and bounded retry-after metadata may be provided. A retry on the same provider is always an explicit caller action; user-configured routes may fail over once per listed provider before output.

## Verification

Local `pnpm check` includes unit protocol/auth/controller tests, both static builds and production Chrome integration with intercepted OpenRouter responses and the real local editor. Interception makes deterministic failure-path tests possible; it does not prove authenticated live provider behavior. Tests cover privacy redaction, OAuth callback reload, all supported edit operations, structural planning feedback, explicit proposal/apply/Undo/Redo and persistence, service approval, stale revisions, idempotency, cancellation, malformed streams, credential races, resource bounds and inert imports. Production-entry tests approve both native export formats through the assistant, reopen the files, and check decoded pixels. Controlled service tests cover separate preparation/inference approvals and text opt-in; the real Whisper acceptance suite remains the inference capability evidence. The initial workspace graph excludes both optional entries and all AI dependencies count toward the aggregate budget.

The public catalog and CORS were checked without a key on 2026-10-10 (Sydney): model GET returned 200, and auth/chat OPTIONS returned 204 permitting bearer-header browser calls. This verifies public connectivity only.

For a separately authorized real-provider acceptance run, inject a user-owned key through a private process environment and select an explicit tool-capable model. Both production builds must exist:

```sh
LOCALCUT_OPENROUTER_LIVE=1 LOCALCUT_OPENROUTER_MODEL=provider/model pnpm test:ai:live
```

`OPENROUTER_API_KEY` must already be set securely; never paste a real key into a tracked script or command history. This local command can incur provider charges. It asks for one synthetic track, validates the returned proposal, applies it through the actual engine and undoes it. Missing opt-in/key/model fails before any provider request, rather than becoming a passing skip. Tracing, screenshots, videos and response attachments are disabled for this suite. Normal local checks never need a real provider key. OAuth login/consent still needs an interactive account test with an authorized user account.

No model account, backend or schema migration is included. Rollback consists of reverting the additive AI module/build/docs changes; existing project documents remain compatible.

## Editable timeline recipes

The shared tool schema includes audio separation, group/ungroup/move/duplicate, and `applyTransitionTemplate`. `inspect_capabilities` lists named templates and their strength range. Templates are starting recipes over ordinary position/size/blur keyframes and the existing blend. Inspect the proposal/result, then tune base attributes with `updateClip`; preserve unrelated keyframes when replacing a keyframe map. Reapplying a recipe builds on current values, and removing a transition removes only blending. Every application or refinement remains an explicit revision-bound proposal requiring user approval. Structural membership/template metadata shares no new text or source media.

## Manual asset indexing

Klip is LocalCut's assistant, represented by an original smiling film cell. The user changed the proposed Clippy name to Klip after checking Microsoft's trademark list. The artwork is original and no Microsoft affiliation is implied.

The connection dialog stores only the indexing permission in `localcut.asset-index-consent.v1`: `{ version: 1, provider: 'openrouter', allowed }`. Default is denied, malformed versions fail closed, storage events synchronize current permission across tabs, and OpenRouter API keys use their separate persistent local record. Compatible-endpoint keys remain session-only. ChatGPT tokens use the separate credential record described above. Name/text/transcript choices remain independent and session-only. Revocation cancels card jobs and retires sessions so old labels cannot re-enter chat; completed local outputs remain until explicit deletion.

`OpenRouterModel.inputModalities` comes from `architecture.input_modalities`. `createAssetIndexer` checks the current selected tool-capable model supports image input, and video input for video assets, before scanning or paid traffic. Audio-only assets require the audio input modality. No fallback or automatic retry occurs. `provider.label` is a dedicated fixed-endpoint streaming request without tools. It accepts generated JPEG/MP4 base64 data URLs and WAV audio via base64 `input_audio`, using `image_url` / `video_url` per [OpenRouter video inputs](https://github.com/OpenRouterTeam/docs/blob/main/guides/overview/multimodal/videos.mdx). Video evidence retains AAC audio; incompatible provider routes fail rather than intentionally dropping audio. Actual route understanding of sound requires separately authorized live verification.

Every detected shot is labeled sequentially from its still/excerpt and host measurements; a whole-image run uses one preview. Strict response validation requires the exact host scene ID and bounded subject/scene/style/summary/tags/sound fields. The model cannot change ranges or execute tools. Valid returned text and malformed returned labeling text are checkpointed; protocol failures expose safe errors. The overall summary uses saved scene labels, with hierarchical chunks for large scene counts. Request manifests retain artifact references, never duplicated base64 or bearer headers. The existing 2 MiB transport and bounded SSE/terminal validation remain enforced. Oversized evidence fails explicitly.

With `context.includeAssetIndexes`, each turn uses the newest complete, non-invalidated run for project assets and explicitly allowed library IDs. A catalog is bounded to 64 KiB, with compact summaries/tags and a truncation indicator. `search_asset_index` searches saved scene descriptions and `read_asset_index` returns paginated timestamped observations (at most 20 scenes per call). Chat sends saved text only and cannot index, upload, delete runs or widen its allowlist. Observations remain untrusted data and edit approvals are unchanged. Revoked/denied policy advertises neither tools nor catalog. Authorized index search/read remain core inspection tools alongside skill loading. Loading editing, export, history or transcription skills never grants index permission. When the authorized default-run set changes through relink, deletion, a new completed run or changed project assets, the assistant retires prior model history because old tool replies and narration may repeat saved labels.

Local native Chrome tests cover generated audio/video evidence and both deployment paths; intercepted provider tests cover payloads, malformed-label retry and consent/context boundaries. No paid labeling result or video/audio comprehension is claimed by those tests. Existing live-provider opt-in remains required.

Audio-only discovery uses 250 ms RMS/peak windows, sustained silence below RMS 0.005 for at least 500 ms, and at most 30-second continuous regions. It retains every resulting segment, including silence, with an up-to-four-second excerpt at its strongest energy window (midpoint for silence). Evidence is stripped stereo 48 kHz PCM16 WAV, sent through [OpenRouter audio input](https://openrouter.ai/docs/guides/overview/multimodal/audio) using the selected audio-capable chat model. Local discovery uses no transcription or learned model. Descriptions cover selected excerpts rather than an exhaustive transcript. The dedicated consent also covers audio excerpts; chat reuses saved labels without audio bytes.

## Saved workspace connection

The workspace saves pasted and OAuth-issued keys in `localcut.openrouter-credential.v1` in origin-local `localStorage`, as `{ version: 1, key }`. It remains separate from preferences, editing storage, portable backups and assistant context. Root and Pages paths on the same origin share the record. Browser data clearing removes it. It is ordinary browser storage, without encryption or OS Keychain protection.

The headless adapter remains memory-only by default and construction remains inert. A host can opt in with `credentialStorage: () => localStorage`, then explicitly call `restoreCredential()`; this reads and validates the record without any request. `setKey` and successful PKCE exchange save before connecting. Invalid versions/keys and unavailable or full storage produce sanitized actionable errors. Saving failure does not claim a successful connection; failed deletion still retires the runtime and reports that removal must be retried. Disposal never deletes the saved record.

On reload, the workspace restores a valid saved key and refreshes only the public model catalog. It keeps connection settings closed, validates the remembered model, leaves name/text/transcript sharing off and waits for an explicit paid action. Open a saved project to use Text to speech. Disconnect deletes the credential. A storage event for removal, replacement or origin clearing aborts stale connection work in other tabs; those tabs can reconnect or reload to use the new record. Keys never appear in status, inputs after use, URLs, logs or backups. Remote key revocation remains controlled in OpenRouter.
