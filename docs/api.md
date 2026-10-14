# Headless API

Optional remote AI lives in the separately imported `ai.js` entry. Its connection, event, proposal, cancellation and frontend wiring contracts are documented in [AI providers and service routing](ai.md). Constructing either AI object starts no work; the editor is opened separately and supplied to the assistant.

Serve dist over HTTPS or localhost. Discover both module URLs from one fresh `modules.json` response, then retain that release for the lifetime of the integration. Its version-one contract contains `release` (a digest of the module URL map) and `modules.editor` / `modules.ai` (deployment-relative, content-hashed URLs). The discovery request uses a fresh query and `cache: 'no-store'` to bypass browser/intermediary caches; module bytes remain cacheable. If a deployment removes a discovered module before import completes, surface a reload/reconnect action and rediscover both modules together. Do not silently replace one module beneath a running engine or assistant.

The stable `editor.js` and `ai.js` compatibility aliases remain available, but a server cannot retroactively invalidate an older copy already cached by a browser. Use discovery for integrations following the latest deployment, or pin the hashed URLs and retain the complete matching static release when reproducibility is required.

Import from the deployment base after an explicit editing action:

```ts
const discovery = new URL('/LocalCut/modules.json', location.href);
discovery.searchParams.set('fresh', crypto.randomUUID());
const response = await fetch(discovery, { cache: 'no-store' });
if (!response.ok) throw new Error('LocalCut modules unavailable');
const release = await response.json();
const { createEditor } = await import(
  new URL(release.modules.editor, discovery).href
);
// Types are generated at dist/types/editor/index.d.ts.
const editor = await createEditor();
const project = await editor.projects.create('First cut');
const asset = await editor.assets.import(file).completion;
const receipt = await editor.commands.apply({
  projectId: project.id,
  requestId: crypto.randomUUID(),
  expectedRevision: project.revision,
  operations: [
    { type: 'addTrack', track: { id: 'video', kind: 'video' } },
    {
      type: 'insertClip',
      trackId: 'video',
      clip: {
        id: 'clip',
        kind: 'video',
        assetId: asset.id,
        startUs: 0,
        durationUs: asset.durationUs,
        sourceInUs: 0,
        sourceOutUs: asset.durationUs,
      },
    },
  ],
});
const job = editor.exports.start(project.id, { format: 'mp4' });
const unsubscribe = job.subscribe((event) =>
  console.log(event.stage, event.progress),
);
const artifact = await job.completion;
// Consumer owns download/UI decisions and any object URL it creates.
console.log(artifact.file, artifact.revision, receipt.appliedRevision);
unsubscribe();
await artifact.dispose();
await editor.dispose();
```

| Family        | Methods                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------- |
| workspace     | snapshot, export, import                                                                          |
| projects      | create, list, open, snapshot, delete, exportJSON, importJSON                                      |
| assets        | import, inspect, rename, relink, thumbnails, contactSheet, waveform, derivative, analyze, indexes |
| commands      | validate, apply, undo, redo                                                                       |
| preview       | frame, session                                                                                    |
| exports       | preflight, start                                                                                  |
| transcription | status, prepare, measure, attach, transcribe, transcript, clearModelCache                         |
| events        | projects, jobs                                                                                    |
| lifecycle     | job.cancel, session.dispose, artifact.dispose, editor.dispose                                     |

The source facade exports inferred Editor, EditorOptions, persisted project/clip/track types, command/receipt types, Job/Progress/events, preview types, export types, subtitle helpers, and EditorError. Generated declarations preserve transitive type references.

Long jobs expose completion and subscriptions. Cancellation before publication rejects completion with CANCELLED and releases an undelivered frame bitmap or export artifact. Imports and transcripts instead publish at their successful IndexedDB commit: cancellation aborts pending writes, but a commit that already succeeded returns its result even if cancellation arrives before the completion promise settles. Consumers must close returned ImageBitmaps, unsubscribe listeners, dispose delivered artifacts, and dispose the editor. Canvas and AudioContext belong to the caller. Session play/pause/seek/currentTimeUs use the audio clock; audio requires valid browser user activation.

Operations include add/remove/reorderTrack, insert/remove/update/trim/split/move/duplicateClip, setSpeed, explicit ripple, and add/removeTransition. Use updateClip for typed transforms, effects, gains, fades, text, keyframes, and editable caption cues. Submit related changes in one batch; operation count has no application ceiling. Each operation and the resulting document still require canonical validation and atomic commit. Reuse exactly the same request envelope to retry; different content under the same ID fails REQUEST_CONFLICT.

New receipts fingerprint the submitted JSON content before parser defaults, with object-key order ignored. Keep omitted fields omitted when retrying: supplying an explicit default is different content. Unversioned receipts from the original version-one release retain its frozen parser normalization, including its old patch defaults. A matching receipt is returned before checking the current revision; newly supplied fields are never discarded to force a legacy match.

`projects.importJSON(text, { repairLegacyIdentities: true })` explicitly repairs duplicate caption cue IDs in unmarked legacy bare documents or backup envelopes. The default import stays strict. Backups marked `identityVersion: 1` always stay strict, even with the repair option. Repair preserves timing, text, settings, and a canonical original cue owner; duplicate owners receive deterministic IDs. Imported projects still receive a fresh project ID and revision zero. This option does not repair arbitrary malformed documents, source references, or collisions between different object kinds.

An updateClip patch changes only supplied top-level fields; omitted position, gain, effects, cues, and keyframes retain their existing values. Supplied text styles, cue arrays, and keyframe maps replace that field rather than merging nested values. A supplied text style may use the style's normal defaults.

Text styles retain `text`, `fontSize`, `color`, `background` and `align`, and optionally accept `fontFamily` (a `FontId`), `fontWeight` (`normal`/`bold`), `italic`, `letterSpacing` (-10–100 project pixels), `curve` (-180–180 degrees), `outlineColor`, `outlineWidth` (0–20 project pixels) and `shadow: { color, blur, offsetX, offsetY }` (blur 0–100; offsets -100–100 project pixels). `background` supplies the highlight band. Curves apply per wrapped line; a negative curve bends in the opposite direction. Rendering scales with project dimensions in thumbnails and export, including device-space shadow values. The public entry exports `TEXT_FONTS`, `TEXT_TEMPLATES`, `FontId`, `TextTemplate` and `TextStyleInput` for discovery and insertion through the existing commands.

Old text styles retain their original defaults and appearance. New optional fields survive history and backups without a database migration; frozen legacy receipt normalization is unchanged. Older app revisions cannot parse styles containing these new fields, so reopening a styled backup requires the current parser. The ten legacy system stacks retain their IDs; the bundled catalog adds validated `font-<upstream-id>` IDs. Each rendering realm loads checksummed same-origin WOFF2 subsets before painting. Failures reject preview/export with MISSING_ASSET; browser-synthesized bold/italic apply to the pinned upright face. Newly authored IDs require this catalog revision.

Times are safe integer microseconds. Frame rates are {num, den}. Source and timeline ranges are half-open. Timed media duration must equal the source interval divided by average speed, within integer rounding. Speed is 0.25–4. `pitchMode` is `change` (legacy/default) or `preserve`. Optional `speedRamp` contains 2–64 ordered points `{ position, speed, interpolation }`, with normalized timeline endpoints 0 and 1. Segment interpolation is `smooth` (cubic ease), `linear`, or `hold` (staircase); each point selects the segment leading to the next. A ramp overrides constant `speed`. Split retains exact easing subintervals using optional `curveStart`/`curveEnd`; inverse integrated timing maps source captions. Split stores optional `speedRampSourceRange: { sourceInUs, sourceOutUs, from, to }` with the original integer source bounds and unitless normalized fractions. These describe nominal unrounded boundaries, which must round to the actual integer source bounds; their interval divided by average speed matches timeline duration within one microsecond. Repeated splits slice these nominal bounds, preventing cumulative rounding while preserving exact timeline boundaries and integer source adjacency. Playback still uses the actual integer bounds. Trim, speed/profile changes and explicit timing changes clear this split provenance. Keyframes have stable IDs, clip-local timing, ordered timestamps, and linear/hold interpolation. Existing version-one documents and new inputs may omit a keyframe ID; parsing derives it deterministically from the clip ID, property, and timestamp. Repeated reads therefore keep the same IDs. Split evaluates the boundary, rebases right-hand values, and assigns distinct IDs to new boundary keys. Duplication assigns new nested keyframe and cue IDs.

Crossfades and black fades require two ordered overlapping image or video clips on one video track, with no third clip intersecting the transition. Image-to-image and image-to-video transitions use the same compositor as video-to-video transitions. Commands never extend media or move neighboring clips implicitly.

SRT/WebVTT helpers import/export plain cues; display caption clips burn them into frames. A media clip's transcriptId links source-timed generated cues, which are retimed through its source range, speed, and placement. Transcription accepts an exact integer-microsecond [startUs, endUs) range within the source asset. Returned cue endpoints stay inside that range even when 16 kHz input sampling pads the final sample.

Stable error codes include INVALID_DOCUMENT, INVALID_COMMAND, REVISION_CONFLICT, REQUEST_CONFLICT, NOT_FOUND, MISSING_ASSET, UNSUPPORTED_CODEC, AMBIGUOUS_STREAM, QUOTA_EXCEEDED, CANCELLED, WORKER_FAILED, PLAYBACK_BLOCKED, MODEL_REQUIRED, MODEL_DOWNLOAD_FAILED, and DISPOSED. Error messages identify the relevant operation or resource.

Project JSON export returns a version-one backup envelope containing referenced asset metadata and source transcripts. Import validates and restores these atomically with fresh IDs; originals are retained separately and supplied through assets.relink using the imported clip asset IDs. Legacy bare documents remain accepted in a namespace with existing metadata.

Preview play() resolves after initial scheduling and presentation succeed, and rejects startup failures such as MISSING_ASSET or PLAYBACK_BLOCKED. The first audio block is prepared before the playback clock starts. If a later decode exhausts queued audio, the timeline holds at the scheduled audio boundary and resumes consecutive blocks when decoding finishes; video presentation uses that same adjusted time. session.onError(listener) observes structured errors during playback, including a worker crash; failures stop the session. Unsubscribe and dispose the session when finished. Superseded asynchronous seeks cannot overwrite newer presentation or position.

`assets.waveform`, `assets.thumbnails`, `assets.contactSheet` and `assets.derivative` reuse versioned local derivatives across engine disposal and page refresh. Keys include source identity and request parameters; thumbnail widths must be safe integers from 1 to 4096. Complete valid hits return cancellable Jobs before durable task submission, without global queue notifications or worker launches; their IDs have no task record. A new miss retains its Job ID when entering the durable queue. Cache reads retain cancellation and namespace ownership. Missing/corrupt display caches rebuild; failed display-cache writes still return the computed result. Source relinking invalidates prior derivatives. No project revision or remote request is created by a hit. See [the computation inventory](storage.md#reusable-computation-inventory).

### Asset names and project removal

`editor.assets.rename(assetId, name, expectedName)` trims and validates a nonempty display name and atomically compares `expectedName` to the stored name. A stale form fails with `REVISION_CONFLICT`. It updates shared asset metadata and emits project notifications for current projects referencing the asset without changing their authored revision. Original bytes, index source identities and explicit clip-name overrides remain unchanged. Removing an asset from a project uses one revision-aware batch of `removeClip` operations for its references; undo and saved versions retain access to the original.

## Clip duration and loops

`resizeClip { clipId, durationUs }` changes a positive integer-microsecond timeline duration, preserving selected source bounds. Audio/video clips gain optional `loop: { offsetUs }` timing; their cycle is the selected source span divided by average speed, using the existing integer rounding contract. `offsetUs` is inside that cycle and defaults to zero. Source ranges below one millisecond cannot loop. Playback wraps within the half-open selected source range; speed ramps repeat their complete selected curve on each cycle. Images/text extend their content without timed-source loops. Shortening clips retains an evaluated keyframe at the new end to preserve earlier animation/gain, removes later keys, crops local cues and clamps fades.

Splitting a looping clip retains the source range and rebases the right clip's loop offset, preserving playback phase and fade continuity. Speed/ramp commands scale duration and loop offset by the new cycle length. Explicit source `trimClip` removes looping and restores a normal source-derived duration. Audio separation, duplicate/history/version/backup flows preserve loop fields. Source transcript captions follow the current playback cycle; authored clip-local keyframes and captions retain their timeline-local behavior.

The optional field leaves existing documents unchanged, but older strict readers cannot open new looping clips. Keep this reader when rolling back, or export media before using an older application. Frozen legacy receipt normalization is unchanged; new commands use the current receipt schema.

## Immutable project versions

`projects.versions.list(projectId)` returns newest-first metadata (`id`, `number`, `createdAt`, `kind`, `revision`, optional `restoredFrom`). `projects.versions.snapshot(projectId, versionId)` returns that metadata and the complete saved project, detached from persisted data. There is no update/delete operation for individual versions. `projects.versions.save(projectId)` flushes pending autosave and deduplicates the current revision. `projects.open(id)` checkpoints a recovered working revision; ordinary snapshot reads do not create an autosave version.

`projects.versions.restore(projectId, versionId, requestId, expectedRevision)` returns an edit receipt. It atomically preserves pending work, restores the selected content at a new monotonic revision, and appends a version referencing its source. It uses the same stale-revision and idempotency contracts as commands and supports Undo/Redo.

`preview.frame(projectId, timeUs, size?, versionId?)` and `preview.session(projectId, canvas, audioContext, versionId?)` use a saved immutable version when supplied. They never swap the live project or create temporary project records. Historical preview uses the same compositor and local source files as current playback. Inspect a snapshot with timeline/property consumers; mutation controls must remain disabled while browsing.

`events.versions(listener)` reports `{ projectId, error? }` after a version save or save failure. Unsubscribe when finished. Autosave uses a one-second trailing debounce per project; committed edits are already durable. Disposal flushes pending saves and propagates a failed save after releasing owned resources. A browser forced closed before the timer preserves edits; open the project again to checkpoint them.

## Workspace archive API

`editor.workspace.snapshot(projectIds, includeVersions = true, settings?)` reads an internally consistent metadata snapshot. `workspace.export({ projectIds, includeVersions, assetIds }, settings?)` returns a cancellable `Job<File>` containing JSON or a ZIP with deduplicated selected originals. `readWorkspaceArchive(blob, signal?, allowProjectBackup = false)` inspects/validates it without opening an editor. Project UI enables legacy version-one project-envelope compatibility with the final argument. Both transfer scopes use the same archive format.

`workspace.import(archive, { projectIds, includeVersions, assetIds })` revalidates the complete metadata and selected original bytes, then returns a cancellable job resolving to newly created projects. It publishes selected projects atomically and emits normal project events afterward. It does not apply settings: the workspace consumer uses the appearance/preference owners after that commit, reporting localStorage failure separately. Imported projects and versions reset revision to zero and get fresh project/source/transcript/version IDs. See [workspace transfer storage](storage.md#workspace-and-project-transfer) for integrity, cancellation, resource limits and recovery.

## Audio separation, clip groups and transition templates

`separateAudio { clipId, audioClipId, trackId }` requires a video clip and an existing audio track. It creates an audio clip referencing the same source, with exact source endpoints, speed/ramp, pitch mode, placement, gain, mute, fade envelope, transcript linkage and distinct gain keyframe IDs. It mutes the original video. A muted source track produces a muted audio clip. Existing asset validation rejects video sources without audio atomically. This is a timeline edit; it does not extract or duplicate a file.

Optional `clip.groupId` persists a flat group of at least two clips across tracks. Group IDs share the document identity namespace. `groupClips { groupId, clipIds }` creates a fresh group; regrouping existing groups requires every member. `ungroupClips { groupId }` removes membership. `moveGroup { groupId, deltaUs }` moves every member by the same signed integer offset. `duplicateGroup { groupId, newGroupId, newClipIds, deltaUs }` requires a fresh ID mapped from every member and retains internal transitions with new identities. Individual clip operations remain explicit; ordinary `duplicateClip` creates an ungrouped copy. Splitting a grouped clip keeps both fragments in the group. Removing clips/tracks dissolves singleton membership at the end of the atomic batch. No group operation extends sources or implies ripple.

`applyTransitionTemplate { transitionId, trackId, fromClipId, toClipId, template, strength? }` supports `crossfade`, `black`, `slide-left`, `slide-right`, `zoom-in`, `zoom-out`, and `blur-dissolve`. Strength is 0–1 (default 0.5). It requires the same ordered adjacent visual overlap as `addTransition`. Recipes expand to ordinary clip-local position, size or blur keyframes plus the existing crossfade/black blend. Preview/export use the existing compositor. Templates preserve source/timeline ranges and unrelated attributes; targeted animation inside the overlap is replaced by sampled current values plus the recipe, while values outside it retain continuity. Slide travel is strength × project width; zoom varies size by up to 25%; blur adds up to 40 units, clamped to 100.

The transition's optional `templateId` and `strength` describe its starting recipe, not a locked effect. Inspect the result and use `updateClip` to tune the base values/keyframes. Reapplying a template builds on current values. `removeTransition` removes only the blend; keyframes remain ordinary authored animation. Undo reverses the complete template edit. Old documents without membership/template metadata still parse; frozen legacy receipt normalization remains unchanged.

## Asset indexing

`editor.assets.analyze(assetId, indexRunId?)` returns the existing cancellable `Job<AssetIndexRun>`; omitting the run ID creates a retained run and supplying it resumes missing local outputs for an unchanged source. Local analysis requires no AI connection. `assets.indexes.list(assetId?)`, `get(runId)`, and `artifact(runId, artifactId)` inspect saved records and files. Callers own preview object URLs. `remove(runId)` explicitly deletes one run under its lease; `withRun`, `recordRequest`, `recordResponse` and `status` are shared coordination/checkpoint APIs. Label publication validates host scene IDs and current source identity; relink invalidates active context without deleting evidence.

The optional `createAssetIndexer({ editor, provider, model, consent, onRunId? })` returns `run(assetId, runId?)` jobs and `dispose()`. The live consent callback is checked around every asynchronous step; consumers must cancel/dispose on revocation. Jobs perform local analysis, sequential scene labeling and an overall summary. Retry is explicit and preserves successful scenes. An optional trusted `onRunId(runId)` observer receives the retained checkpoint after local analysis; hosts can bind it to the approved request identity for explicit retries. Reindex omits the old run ID. Source files, records and job identities stay scoped to the editor namespace.

`createAssistant` optionally accepts `indexing: { run(assetId, requestId): Job<AssetIndexRun>, consent(): boolean, disclosure: string }` from a trusted host. With `context.includeAssetIndexes` and live consent, the incremental indexing skill exposes the reviewed `index_asset` action. The host must bind the selected provider/model and cancel/dispose on consent or configuration changes. `approveProposal` returns `{ kind: 'indexing', runId, assetId, sceneCount }` after completion; reasoning tools never receive media bytes. The workspace routes approvals to `createAssetIndexer`; the proposal UI supplies progress/cancellation and the media library refreshes retained results from terminal label tasks. See [AI indexing](ai.md#manual-asset-indexing).

`AssetAnalysis`, `AssetIndexRun`, `IndexScene`, `IndexArtifact`, and `IndexLabel` are public editor types. Audio assets use energy/silence segments with retained WAV excerpts. Source timestamps and highlight boundaries are host-owned integer microseconds; models cannot change them. Generated artifacts are retained Files, separate from disposable exports and derivative caches. Analysis emits scan/generate progress and records their elapsed time separately from provider work.

## Speed commands

`setSpeed { clipId, speed, pitchMode? }` clears a ramp and preserves the exact source endpoints. `setSpeedRamp { clipId, points, pitchMode? }` applies ordered points or clears the ramp with `points: null`. Both derive duration; omitted pitch mode preserves the current choice. These commands require video/audio clips. `rampPreset`, `averageSpeed` and `sourceDurationUs` are available through `editor.js`; assistant proposals use these same validated operation schemas.

Changing a ramp, or returning from a ramp to constant speed, scales existing clip-local keyframes, cues and fade envelopes proportionally to the new duration while retaining IDs. Keyframes collapsed onto the same rounded timestamp retain the last key, and cues collapsed to zero duration are removed. Constant-only speed retains the established clip-local keyframe/cue/fade contract and rejects bounds that exceed its new duration. Trim preserves the normalized ramp shape and applies the existing keyframe/fade validation. Duplication, audio separation, history, project versions and backups preserve ramp/pitch settings.

Keep pitch uses bounded, stereo-coherent WSOLA in shared preview/export PCM composition. It preserves pitch rather than promising identical timbre: extreme rates and abrupt staircases can produce overlap artifacts; seeking starts a fresh grain sequence. Change pitch follows instantaneous ramp speed with anti-alias filtering. Both stay local and honor source trim, mute, gain and fades. Existing version-one documents omit these fields and retain constant speed/change pitch. Older builds cannot read documents authored with the new fields; use this revision when opening such projects or backups. Frozen legacy receipt normalization remains unchanged.

## Configured transcription execution

`editor.transcription.transcribe(assetId, { language?, startUs?, endUs?, provider? })` accepts an optional per-job `TranscriptionExecutor`. This transient callback is not persisted or model-configurable. It receives mono 16 kHz samples, approved source bounds, a lazy local inference callback and the job abort signal. Default calls keep the pinned local model preparation requirement. All returned transcripts pass the existing storage validation plus exact requested-range checks before committing; cancellation before commit aborts saving, while committed results remain authoritative. The AI service router exposes `transcribe` for this hook and a trusted `transcriptionDisclosure`; pass both to the assistant's optional `transcription: { execute, disclosure }` setting. The workspace retires this session on route changes and shows the disclosure before user approval.

### Text animation

`text.animation` optionally accepts `{ kind: 'typewriter' | 'handmade', stepMs: 40..2000, loop: boolean, frames?: 3..5, variations?: string[] }`. Variations contain three to five non-empty strings and override the handmade frame count and main text, including when the main text is empty. Typewriter reveals Unicode graphemes at each step; a looping reveal holds the completed text for eight steps. Handmade text uses deterministic discrete poses and optionally cycles the variations. Timing is relative to the clip start, identical on seeking, samples, preview and export. Static styles remain unchanged. History and backups retain animation without a storage migration; old parsers cannot read animation fields.

## Durable task queue

`editor.tasks` is the namespace-local queue for long-running operations. Import/relink, asset analysis/derivatives, exports, transcription preparation/inference and workspace transfers retain their existing `Job<T>` return shape but run through this queue. Preview frame/audio scheduling and atomic commands remain immediate. The assistant uses `editor.tasks` by default when passed a full editor, with an optional `tasks` override; the workspace also queues speech, dictation, screen capture and provider labeling. Capture starts from an explicit browser gesture and cannot restart itself after refresh.

Production handlers declare `TaskCachePolicy`: `freshTask(reason)` preserves explicit actions, while `pureTaskCache(version)` hashes typed input content and permits completed-result reuse. Custom reusable policies provide `version`, `key`, `reuseCompleted` and optional `read`/`write` hooks for an existing result owner. The public entry exports those helpers plus `taskCacheKey` and `CacheHit`. Domain reads precede admission; cache-key claims and inputs persist before scheduling; result writes precede completed status. Reusable handlers cannot own session callbacks, canonical commits or disposable native handles.

Matching reusable requests share one durable task across queue instances/tabs. Each caller gets its own cancellable Job and a cloned result. Its cancellation detaches that consumer; use `tasks.cancel(actualTaskId)` to stop shared work. Global queue events identify the actual durable task; per-Job subscriptions identify that consumer. Only a newly admitted miss has a matching task record for its Job ID. Completed pure local measurement/timing requests also reuse saved queue results after reload. Preparation always verifies current model bytes before reuse. Imports, publications, exports and provider actions remain fresh; see [cache exclusions and persistence](storage.md#durable-task-sidecar).

```ts
const tasks = await editor.tasks.list();
const status = await editor.tasks.get(tasks[0].id);
await editor.tasks.poll(); // Refresh status subscribers and dispatch ready tasks.
const unsubscribe = editor.tasks.subscribe((task) => console.log(task.state));
if (await editor.tasks.canRetry(tasks[0].id)) {
  const retry = await editor.tasks.retry(tasks[0].id);
  await retry.completion;
}
await editor.tasks.cancel(tasks[0].id);
const saved = await editor.tasks.result(completedTaskId);
await editor.tasks.remove(completedTaskId);
```

States are `queued`, `running`, `retrying`, `completed`, `failed`, `interrupted` and `cancelled`. Status includes ID, kind, label, lane, optional project ID, stage/progress, attempt count/budget, retry time and a sanitized error with an actionable escalation. `subscribeErrors(listener)` reports sanitized scheduler/storage failures even when browser storage cannot persist an error record. Status never includes credentials, media bytes or provider error bodies. Safe request errors may also retain fixed HTTP rejection categories, recognized parameter names, reviewer stage and recovery reason through both the queued Job rejection and the task sidecar. The core diagnostic owner filters these fields; arbitrary provider text is excluded. Inputs and results are separate records. `result<T>(id)` is available only after completion; completed results and original inputs survive reload. Export results contain the saved file and metadata; the editor reconstructs their `dispose` function when reopening a result from storage or another tab. `events.jobs` uses the same ID as each returned queued `Job`.

`TaskQueue` is exported from `editor.js` for other explicit consumers. Construction is inert. Register a named handler with `execute(input, { id, signal, progress })`, a resource `lane`, `recovery: 'safe' | 'manual'`, optional `retryCodes`, `maxAttempts`, `retryable`, `sessionBound`, result encoding/decoding and committed-result/discard policy. `enqueue(kind, input, { label, projectId? })` persists structured-cloneable input before dispatch and returns a `Job`. `start()` enables polling; `dispose()` stops dispatch, aborts running work and marks outstanding owned work interrupted. A handler must preserve its underlying commit/cleanup contract.

Cross-tab Web Locks serialize each lane and guard each task. Safe local derivative/analysis/model-download failures use bounded exponential backoff; exhausted attempts escalate. Remote speech retries only an explicit rate-limit rejection; unknown network/timeout outcomes, invalid inputs, authentication/credit/storage problems and non-idempotent publications require explicit action. Retry retains the task ID and input, resets the attempt budget and uses a saved speech checkpoint when available. Reconfiguration/disconnection cannot redirect a speech task to another route. Session-bound handlers retain an owner Web Lock so another tab cannot steal their callbacks. Abandoned session-bound tasks escalate even if they never started. An absent handler or capture gesture cannot be replayed: reopen the owning workflow and reconnect/review consent, or submit a new request. Edit approval is never queued for automatic replay.

Every `assistant.run(prompt)` returns a turn whose completion resolves to `AssistantResult`, including `completion: { status, checks, contract, verdict }`. `reviewed` means the main agent returned a final answer after consuming a current assessment; `limited` means a review/caller budget stopped the turn. The host does not interpret assessment text or certify fulfillment. Goal and task notes are verbatim text, and the separate read-only assessment is passed to the main agent to guide its next decision. See [request completion review](ai.md#request-completion-review) for limits, privacy, usage and cancellation contracts.

Assistant `usage` events expose independent cumulative snapshots. Additive `usage_call` events carry `{ turnId, call: { id, source, model, usage? } }` for each completed main or auxiliary attempt, including attempts that return no usage or need an empty-response retry. Hosts can retain/display these records without triggering remote work; they do not grant editing authority. Optional `generateChatTitle.onUsage` and `AssetIndexerOptions.onUsage` callbacks expose completed naming/labeling usage to the initiating host. See [request usage accounting](ai.md#request-usage-accounting) for attribution and pricing limits.

`assistant.branch(turnId)` creates an opaque checkpoint through a retained completed turn. Pass it as `branch` to `createAssistant` with the same project/model/context policy. The fork copies bounded protocol history and matching tool exchanges, excludes later turns, and carries no proposals, artifacts or approval authority. Forged/mismatched checkpoints are rejected. `canBranch(turnId)` reports availability. `includeAssets(ids)` explicitly extends the local asset allowlist while idle; it sends metadata under the existing sharing policy, never source pixels.

## Project catalog management

`projects.catalog()` returns entries with `project`, catalog `revision`, `archived`, optional local `thumbnail` Blob, and `thumbnailPosition: { x, y }` (0–100). Existing records default to active, revision zero and centered automatic previews. `projects.list()` still returns every document, including archived projects.

`projects.updateCatalog(id, expectedRevision, patch)` atomically patches `archived`, `thumbnail` (PNG/JPEG/WebP Blob up to 2 MiB, or `null` to reset), and/or `thumbnailPosition`. A stale catalog revision fails with `REVISION_CONFLICT`; successful commits increment only the catalog revision and emit a project notification. Catalog changes do not alter editing history or immutable versions.

The normal command `{ type: 'renameProject', name }` trims a nonempty name (maximum 1,000 characters), uses the editing revision/receipt contract, and supports undo, redo, autosave, and backups. Catalog forms keep their authored revision and require explicitly reloading details after conflict.

## Track operations

Tracks optionally persist `name` (trimmed, 1–1000 characters), `disabled`, `solo` and `locked`; `muted` retains its existing false default. Omitted optional fields retain legacy behavior. `updateTrack { trackId, patch }` changes only supplied fields among those five properties. No clips or timeline positions change when toggling output state. Project duration includes disabled clips so enable/disable cannot shift the timeline endpoint.

`disabled` removes all track video/audio from shared preview/export composition. `muted` removes only audio. Enabled solo tracks isolate output independently in two domains: visual tracks (video/overlay), and audio-capable tracks (video/audio). A muted solo track still isolates its domain; disabled solo tracks do not isolate other tracks. With no enabled solos in a domain, normal output resumes. Export requires originals only for media consumed by this output policy: missing originals on disabled or fully excluded tracks do not block export, while a muted video still requires its visual original. Backups retain all source references so excluded tracks can be relinked and enabled later.

`locked` rejects clip/content operations, transitions, track clearing/deletion/reordering and group mutations involving that track with `INVALID_COMMAND`. Locks apply in the pure engine, including implicit singleton-group cleanup; failed batches are atomic. Metadata/output changes and duplication remain available. An explicit `updateTrack` unlock earlier in the same approved batch permits following edits. Undo/Redo and version restore restore saved state, including locks.

`duplicateTrack { trackId, newTrackId }` inserts a copy immediately after its source, reuses original asset references and placement, copies state with `locked: false`, and gives the track a copy name. Clip, keyframe, cue, group and transition IDs are freshly and deterministically derived from the new track ID; retries preserve identities. Groups with two or more members inside the source track become independent groups; lone members of cross-track groups become ungrouped. Internal transitions are preserved. `clearTrack { trackId }` removes its clips/transitions while keeping the track. `removeTrack` removes the track and its clips/transitions. Both dissolve singleton groups atomically and retain original library assets. Existing `addTrack` and zero-based `reorderTrack` remain available.

These optional fields use existing document/history/backup serialization without a database migration. Older application revisions cannot read documents with the new fields; use the compatible reader when restoring such projects.

### Instance-owned animation

`Clip.keyframes` and numeric base properties belong to a single timeline placement, identified by `clip.id`. Source `assetId` references may be shared, but `updateClip` never writes source bytes or another placement. Commands validate a fresh document snapshot; previously returned snapshots retain their authored state. Use `updateClip` with a complete replacement keyframe map for animation edits, retaining all untouched parameter curves. Linear/hold points use integer clip-local microseconds, including the duration endpoint; renderers clamp outside the first/last point. An empty property curve uses its numeric base value. The existing duplicate/split/paste flows retain independent nested identities, and preview/export consume the same evaluation.

## Generated speech timing

`transcription.measure(samples, sampleRate, { language?, provider? })` queues measurement of mono normalized PCM at 16, 24 or 48 kHz (at most 12 million finite samples). It anti-aliases to 16 kHz through the shared resampler, then uses the existing transcription worker or explicitly supplied `TranscriptionExecutor`. Default measurement requires already prepared local Whisper; it never downloads weights or uploads audio. Results are `SpeechTranscript` records with model/revision/language and recognized phrase cues in safe integer microseconds, independent of imported assets. Remote callbacks remain session-bound; abandoned requests escalate for explicit retry.

`retimeSpeechTranscript(timing, originalDurationUs, renderedDurationUs)` proportionally maps measured phrases to the rendered WAV, retaining IDs and pauses. `padSpeechTranscript(timing, durationUs, paddingUs = 80000)` expands editing ranges, clipped to source endpoints and neighboring midpoint boundaries so they never overlap. `transcription.attach(assetId, timing, speech?)` validates and commits a canonical transcript and returns its ID for an `insertClip` operation. Metadata stores the original script, TTS model/voice/languages/directions, original duration, rendered-source measured cues and padding. Keep recognized text distinct from the authored script: transcription is an estimate, not forced alignment. Retimed boundaries are proportional estimates, with the same small timing uncertainty as ASR/WSOLA. Attachment is a short canonical commit; measurement is durable queued work.

New workspace speech tasks always snapshot the configured STT route for measurement; restored legacy tasks retain their original route authority. The speech task checkpoints normalized audio before measurement, and timing before rendering. Timing failure preserves the take; explicit retry does not synthesize it again. Completed result/input/checkpoint records and saved voice references retain measured phrases. Legacy takes without timing remain readable and offer explicit measurement. Imported clips link `transcriptId`, and project/workspace backups preserve the transcript metadata. `read_transcript` exposes both measured boundaries and padded editing ranges only after transcript-sharing consent. No raw audio or reference bytes are included in that tool.

## Storyboard commands

`Project.storyboard` is optional and contains `{ elements, backgroundColor }`, with stable Excalidraw vector/text/image element IDs. `projects.snapshot` reads it without loading the canvas library. The public types include `Storyboard`, `StoryboardElement` and `StoryboardPatch`.

All storyboard mutations use `commands.validate/apply`, request IDs and expected revisions:

- `upsertStoryboardElements { elements: [{ id, type?, x?, y?, width?, height?, text?, ... }] }` creates or patches elements. New elements need a type; omitted fields in existing elements are preserved. Types are rectangle, diamond, ellipse, text, line, arrow, freedraw, frame and image. Text requires `text`; linear/freehand drawings require local `points`. Existing types cannot change. Common style defaults are applied only to new elements.
- `removeStoryboardElements { elementIds }` removes elements and clears references to them from frames, text containers and arrow bindings.
- `reorderStoryboardElements { elementIds }` sets back-to-front stacking with every live element ID exactly once, retaining geometry and labels and resetting fractional indices for Excalidraw restoration.
- `setStoryboardBackground { backgroundColor }` changes only the canvas color without reading/replacing labels.
- `setStoryboard { storyboard: { elements, backgroundColor } }` replaces the complete scene, as used by direct Excalidraw drawing. It never changes timeline clips or media.

Scenes are bounded to 5,000 unique elements, 20,000 points per drawing and 100,000 characters per text element. Only defined fields are accepted; files, media bytes, web embeds, links and arbitrary custom metadata are excluded. Undo/Redo, autosaved versions and backups reuse the canonical project owners.

### Storyboard export and Media reuse

`editor.storyboard.insertImage(projectId, options, expectedRevision, requestId?)` returns a cancellable job with `{ projectId, revision, assetId, elementId, receipt }`. Options select a ready image/video `assetId`, a fresh `elementId`, `timeUs` (default 0, inside the source video), `x/y` (default 0), `width` (default 640, at most 4096), optional `height` (omitted preserves aspect ratio), and an existing `frameId` or null. It preserves image-source pixels or reuses cached video thumbnails, normalizes a local PNG and imports an immutable Media asset before one revision-bound image placement. Stale revisions, invalid frames/IDs/timestamps and unavailable sources reject. Cancelled/conflicting board writes preserve already committed originals and their library entry. A successful commit survives late cancellation.

Image elements use `fileId` equal to a local image asset ID, `status`, `scale` and optional `crop` in the canonical storyboard schema. Ordinary commands cover all authored geometry. `storyboard.files(project, signal?)` hydrates ephemeral local Excalidraw BinaryFiles for host canvas use; never forward them to remote chat. Missing originals require relinking. Project/history/version/backup reference tracking includes board image assets and restores remap their file IDs. PNG/SVG/editable-scene exports hydrate the same local files.

`editor.storyboard.export(projectId, options, expectedRevision)` returns a queued `Job<StoryboardExportResult>` with a local `File`, project ID, exact revision and format. Options are `{ format: 'png' | 'svg' | 'excalidraw', elementIds?, background?, scale?, padding?, name? }`. Omitted selection exports the whole live scene; selected frames include descendants, groups include members, shapes include bound labels, and foreign references are detached. Defaults: background included, scale 1, padding 20 pixels. Scale is 0.1–4, padding 0–1000, and PNG allocation is limited to 16,384 pixels per side and 32 million pixels. Empty raster/vector images fail; an empty editable scene is valid. Names are validated plain filenames. PNG/SVG omit hidden editable-scene metadata; `.excalidraw` preserves editable local geometry, text and image files. SVG inlines its drawing fonts. Rendering uses the pinned package and same-origin assets on demand, including when the canvas UI is closed.

`editor.storyboard.store(projectId, { ...options, format: 'png', parentId?: folderId | null }, expectedRevision)` returns a queued `Job<StoryboardAssetResult>` with `assetId`, `entryId`, `libraryRevision`, project ID and captured storyboard revision. It renders a PNG through the same cache, imports the immutable original and places it in that project's Media root or active folder. Invalid folders/stale revisions reject before import. Once original publication commits, late cancellation retains the asset and completes its named library placement. File and library publication use the existing owners and remain separate from project history. A concurrent folder deletion or storage failure may prevent library placement after original import; the original remains retained and the failed store request is not automatically retried.

Store does not create a timeline placement or live diagram link. Use the returned asset ID with ordinary `insertClip` and per-instance `updateClip`. Explicit repeated stores publish new assets while identical render content/options reuse versioned derivative bytes across reload. Exports return caller-owned Blob-backed files, not filesystem handles; downloading remains a user UI action. Diagram rendering has no video-codec requirement. Neither API sends original pixels or file bytes to providers.

## Error diagnostic propagation

Editor error normalization retains the original stack and cause. Worker failures carry their available stack and serialized cause/aggregate data back to the calling realm; job events can include optional diagnostic fields alongside their existing code/message. Durable task failure records retain original error messages and complete stack text, including multiline headers and nested causes, with credential/callback redaction. There is no message allowlist or unknown-message replacement. Job completion reconstructs the saved original diagnostic message, with a fallback to legacy task metadata when no diagnostic exists. Scheduler status/action/retry metadata remains separate and bounded. Consumers must tolerate legacy failures with unavailable stacks or previously omitted messages. These fields add observation only; request correlation, cancellation, publication and retry semantics are unchanged. The workspace captures its local session separately and never submits diagnostic reports to providers.

## Embedded asset capture metadata

`assets.import` and `assets.relink` extract recognized capture tags locally into optional `Asset.capture`. `assets.inspect(id)` returns `capture.time: { value, source }` and `capture.location: { latitude, longitude, altitudeMeters?, source }` when present. Time values preserve fractional seconds and an explicit offset; without an offset the timezone is unknown. Date-only tags retain date-only precision. For EXIF, the first valid original or digitized timestamp uses its matching offset and subseconds. Time provenance distinguishes `exif-original`, `exif-digitized`, `quicktime-creationdate` and `container-date`; generic container dates can mean creation or release rather than filming. GPS coordinates are signed decimal degrees; altitude is meters. Source facts are metadata assertions, not verified events.

JPEG APP1, PNG eXIf and WebP EXIF use pinned [ExifReader](https://github.com/mattiasw/ExifReader/tree/v4.46.0), with at most 4,096 chunk headers and 1 MiB of EXIF payload read, skipping compressed pixels. XMP/IPTC-only capture information is not extracted. MP4/MOV use [Mediabunny metadata tags](https://mediabunny.dev/api/MetadataTags), including explicit QuickTime creationdate, ISO6709 decimal-degree location and legacy udta `©xyz`. Recognized generic container dates remain separately identified. A bounded MP4/MOV atom walk (at most 4,096 headers) also retains nonzero version-zero/one movie-header creation times as `container-date`, after explicit date tags; these may reflect encoding rather than filming. Missing, unsupported, oversized or malformed optional metadata does not prevent importing otherwise supported media. No filesystem timestamp, geolocation permission, network lookup or reverse geocoding supplies capture facts.

Capture fields persist in the asset record and project/workspace backups, including metadata-only restoration. Relinking inspects the supplied original again. Existing assets remain valid without capture fields; no startup scan is scheduled. Original file bytes are unchanged. Local media details expose recorded date/provenance and GPS without requiring remote sharing.

The optional assistant host policy `execution: 'requested'` executes validated tools during user-submitted turns and returns real receipts before continuing. Workspace chat uses it; headless callers default to `'review'` and keep the proposal approval API. See [the assistant execution contract](ai.md#workspace-requested-execution).

## Creative effects and local mask tracking

`updateClip` supports optional `colorPreset`, `colorStrength` (0–1), `colorLut`, `blendMode`, `mask`, `chromaKey`, `balance` (−1 left to 1 right), `equalizer` (`lowDb`, `midDb`, `highDb`, each −12–12 dB), `noiseReduction` (0–1) and `noiseFloorDb` (−80–−10, default −50). Missing settings preserve neutral legacy output. Null removes LUT/mask/key/EQ; nested objects replace their field. Gain, mute, fades and existing numeric keyframes retain their contracts. New effect settings are static except the mask's editable translation path.

`COLOR_PRESETS`, `BLEND_MODES` and `parseCube(text)` are shared facade exports. Import supports standalone Adobe 3D `.cube` tables of sizes 2–65, finite RGB rows in red-fastest order and optional input domains, bounded to 16 MiB. Unsupported 1D/combined formats, duplicate headers, invalid domains and wrong row counts fail. Titles are ignored. LUT values are authored numeric settings retained in project JSON/backups. Strength mixes the combined preset/LUT grade with the original color; zero bypasses grading.

Chroma key uses a six-digit hex color, tolerance, softness and spill (0–1). It removes matching chroma before existing effects and grading. Masks use normalized clip-local `x/y/width/height`, rectangle/ellipse, `invert`, and project-pixel `feather` (0–100). Optional ordered `points: [{timeUs,x,y}]` interpolate translation in clip-local microseconds; split rebases the path and speed changes retime it. Geometry edits may clear motion. Masks run after grading; opacity/blend follows. Crossfades independently blend endpoints over the backdrop before weighted interpolation; black transitions retain black coverage.

`editor.masks.track(projectId, clipId, expectedRevision, mask?)` returns a cancellable Job containing `{mask, confidence, revision}`. It computes translation from local video frames; it does not commit edits. Supply a draft mask or use the saved mask, then apply the result with `updateClip` at the same expected revision. Results use a versioned durable task cache keyed by the project, draft mask and source identity. A changed revision or source cannot reuse stale motion. Tracking needs visible texture, no source crop, a static clip box aspect ratio no taller than 2:1 portrait, and motion within 16 pixels between sampled 192-pixel-wide frames. It samples at most about ten times per second and 600 frames per clip; low confidence fails without publishing partial motion. It does not segment subjects or track scale/rotation.

Audio processing stays in the bounded shared mixer: speed/pitch, local overlapped spectral suppression, 300/3000 Hz crossover EQ, attenuating stereo balance, gain/fades and final clamp. Spectral suppression uses the selected noise floor; it is intended for steady low-level noise and may affect quiet wanted sound. No learned voice isolation or source upload occurs. Bounded raw stretched overlap retains sequential keep-pitch state while preroll/postroll supplies EQ/spectral context across requested windows; pitch-stretch seeks retain their existing transient contract.

## Media library folders

`const library = editor.library.forProject(projectId)` binds every operation and subscription to an existing project. `library.list()` returns `{ revision, entries }` and adopts ready originals referenced in this project’s current/history/version documents into its named OPFS library. Explicit `place` also retains otherwise-unused uploads in that project. Entry IDs identify file/folder instances; asset IDs identify retained editing sources. Entries have `parentId: null` at the library root. Each project has its own actual OPFS root, sidecar and revision. Removing the last timeline reference retains already placed library files. Foreign entry/folder IDs are unavailable; project renaming keeps the same root.

`library.apply(operation, expectedRevision)` is the shared UI/assistant mutation owner. Operations are `create { parentId, name }`, `rename { entryId, name }`, `move { entryId, parentId, name? }`, `copy { entryId, parentId }`, `trash { entryId }`, and `restore { entryId }`; each has a matching `type`. Moves can atomically specify a destination name. It returns the committed snapshot and broadcasts changes through `library.subscribe(listener)` for this project only. Reopen forms after `REVISION_CONFLICT`; never rebase an authored form silently.

`library.place(assetId | null, relativeDirectories, parentId = null)` creates upload hierarchy through the same owner and places a ready imported asset; a null asset creates directories, including empty dropped directories. Imports preserve stable editing identities. `library.file(entryId)` reads a named media file; `library.download(entryId)` returns that File or a folder ZIP File. The caller owns explicit Save. See [storage/recovery](storage.md#media-folder-library) for retained originals, quota, Trash, rollback and backup boundaries.

Media inspection rejects unknown container formats with `UNSUPPORTED_CODEC`, preserving the decoder cause instead of treating them as a worker crash. `assets.import` imports a source only; `library.forProject(projectId).place` organizes it, and timeline insertion requires an explicit command. The workspace reports known macOS/Apple Photos metadata sidecars as skipped before enqueueing import tasks; headless imports remain explicit format-checked operations.

## Assistant session goals

`review_progress` subscription events carry `{ turnId, callId, name, text }` for `request_contract`, `session_todos` and `completion_check`. Text is a cumulative provisional display draft; an empty string resets the attempt. Keep it separate from main `text` events and canonical history/goals. Terminal `tool` completion supplies the accepted result; failure/cancellation retires its draft. Progress grants no tool or editing authority and does not expose opaque reasoning. No storage schema change is required.

`createAssistant({ restoredGoal?, restoredTurns? })` accepts matching-scope advisory text state `{ goal, todos }`. `RestoredChatTurn.sessionGoal` carries a response-time snapshot; opaque `branch(turnId)` restores that response's state. `snapshot().sessionGoal` returns a copy of current state, and `session_goal` events publish updates with their turn ID. Hosts persist both current and response snapshots with their existing scoped chat owner. Neither restored state nor history grants tools, approvals or sharing. `clearHistory()` resets goal/checklist as well as exchanges; restoration alone never starts inference. See [the completion lifecycle](ai.md#request-completion-review).

## Project coding workspace

`editor.coding.inspect(projectId)` returns the workspace revision, file paths/sizes, directories and runtime facts. `query(projectId, { type: 'read_file' | 'glob' | 'grep', ... })` returns a cancellable Job with text/search results. `run(projectId, operation, expectedRevision)` returns a cancellable, durably scheduled Job for write/edit/browser Bash/saved JavaScript execution. Its completed result contains stdout/stderr/exitCode and the new workspace manifest; file bytes are not exposed to the assistant. Inspect the revision before dependent work. Each explicit run is fresh authored work, reusing persisted source/output files rather than automatically rerendering on startup.

`file(projectId, path)` retrieves a saved local File for download or host processing. `importFile(projectId, path, expectedRevision, name?)` imports a generated audio/image/video file into the project Media library, returning its asset ID and library revision; timeline placement remains a canonical command. Unsupported media is rejected by the ordinary importer. Native/media imports that committed before late cancellation survive. Code sources are retained separately, without changing project JSON, undo/redo or original ownership. See [the AI coding contract](ai.md#browser-coding-and-music-composition) and [persistence](storage.md#project-coding-files).
