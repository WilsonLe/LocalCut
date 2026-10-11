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

| Family        | Methods                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------- |
| workspace     | snapshot, export, import                                                                  |
| projects      | create, list, open, snapshot, delete, exportJSON, importJSON                              |
| assets        | import, inspect, relink, thumbnails, contactSheet, waveform, derivative, analyze, indexes |
| commands      | validate, apply, undo, redo                                                               |
| preview       | frame, session                                                                            |
| exports       | preflight, start                                                                          |
| transcription | status, prepare, transcribe, transcript, clearModelCache                                  |
| events        | projects, jobs                                                                            |
| lifecycle     | job.cancel, session.dispose, artifact.dispose, editor.dispose                             |

The source facade exports inferred Editor, EditorOptions, persisted project/clip/track types, command/receipt types, Job/Progress/events, preview types, export types, subtitle helpers, and EditorError. Generated declarations preserve transitive type references.

Long jobs expose completion and subscriptions. Cancellation before publication rejects completion with CANCELLED and releases an undelivered frame bitmap or export artifact. Imports and transcripts instead publish at their successful IndexedDB commit: cancellation aborts pending writes, but a commit that already succeeded returns its result even if cancellation arrives before the completion promise settles. Consumers must close returned ImageBitmaps, unsubscribe listeners, dispose delivered artifacts, and dispose the editor. Canvas and AudioContext belong to the caller. Session play/pause/seek/currentTimeUs use the audio clock; audio requires valid browser user activation.

Operations include add/remove/reorderTrack, insert/remove/update/trim/split/move/duplicateClip, setSpeed, explicit ripple, and add/removeTransition. Use updateClip for typed transforms, effects, gains, fades, text, keyframes, and editable caption cues. Submit related changes in one batch. Reuse exactly the same request envelope to retry; different content under the same ID fails REQUEST_CONFLICT.

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

The optional `createAssetIndexer({ editor, provider, model, consent })` returns `run(assetId, runId?)` jobs and `dispose()`. The live consent callback is checked around every asynchronous step; consumers must cancel/dispose on revocation. Jobs perform local analysis, sequential scene labeling and an overall summary. Retry is explicit and preserves successful scenes. Reindex omits the old run ID. Source files, records and job identities stay scoped to the editor namespace.

`AssetAnalysis`, `AssetIndexRun`, `IndexScene`, `IndexArtifact`, and `IndexLabel` are public editor types. Audio assets use energy/silence segments with retained WAV excerpts. Source timestamps and highlight boundaries are host-owned integer microseconds; models cannot change them. Generated artifacts are retained Files, separate from disposable exports and derivative caches. Analysis emits scan/generate progress and records their elapsed time separately from provider work.

## Speed commands

`setSpeed { clipId, speed, pitchMode? }` clears a ramp and preserves the exact source endpoints. `setSpeedRamp { clipId, points, pitchMode? }` applies ordered points or clears the ramp with `points: null`. Both derive duration; omitted pitch mode preserves the current choice. These commands require video/audio clips. `rampPreset`, `averageSpeed` and `sourceDurationUs` are available through `editor.js`; assistant proposals use these same validated operation schemas.

Changing a ramp, or returning from a ramp to constant speed, scales existing clip-local keyframes, cues and fade envelopes proportionally to the new duration while retaining IDs. Keyframes collapsed onto the same rounded timestamp retain the last key, and cues collapsed to zero duration are removed. Constant-only speed retains the established clip-local keyframe/cue/fade contract and rejects bounds that exceed its new duration. Trim preserves the normalized ramp shape and applies the existing keyframe/fade validation. Duplication, audio separation, history, project versions and backups preserve ramp/pitch settings.

Keep pitch uses bounded, stereo-coherent WSOLA in shared preview/export PCM composition. It preserves pitch rather than promising identical timbre: extreme rates and abrupt staircases can produce overlap artifacts; seeking starts a fresh grain sequence. Change pitch follows instantaneous ramp speed with anti-alias filtering. Both stay local and honor source trim, mute, gain and fades. Existing version-one documents omit these fields and retain constant speed/change pitch. Older builds cannot read documents authored with the new fields; use this revision when opening such projects or backups. Frozen legacy receipt normalization remains unchanged.

## Configured transcription execution

`editor.transcription.transcribe(assetId, { language?, startUs?, endUs?, provider? })` accepts an optional per-job `TranscriptionExecutor`. This transient callback is not persisted or model-configurable. It receives mono 16 kHz samples, approved source bounds, a lazy local inference callback and the job abort signal. Default calls keep the pinned local model preparation requirement. All returned transcripts pass the existing storage validation plus exact requested-range checks before committing; cancellation before commit aborts saving, while committed results remain authoritative. The AI service router exposes `transcribe` for this hook and a trusted `transcriptionDisclosure`; pass both to the assistant's optional `transcription: { execute, disclosure }` setting. The workspace retires this session on route changes and shows the disclosure before user approval.

### Text animation

`text.animation` optionally accepts `{ kind: 'typewriter' | 'handmade', stepMs: 40..2000, loop: boolean, frames?: 3..5, variations?: string[] }`. Variations contain three to five non-empty strings and override the handmade frame count and main text, including when the main text is empty. Typewriter reveals Unicode graphemes at each step; a looping reveal holds the completed text for eight steps. Handmade text uses deterministic discrete poses and optionally cycles the variations. Timing is relative to the clip start, identical on seeking, samples, preview and export. Static styles remain unchanged. History and backups retain animation without a storage migration; old parsers cannot read animation fields.

### Project catalog management

`projects.catalog()` returns entries with `project`, catalog `revision`, `archived`, optional local `thumbnail` Blob, and `thumbnailPosition: { x, y }` (0–100). Existing records default to active, revision zero and centered automatic previews. `projects.list()` still returns every document, including archived projects.

`projects.updateCatalog(id, expectedRevision, patch)` atomically patches `archived`, `thumbnail` (PNG/JPEG/WebP Blob up to 2 MiB, or `null` to reset), and/or `thumbnailPosition`. A stale catalog revision fails with `REVISION_CONFLICT`; successful commits increment only the catalog revision and emit a project notification. Catalog changes do not alter editing history or immutable versions.

The normal command `{ type: 'renameProject', name }` trims a nonempty name (maximum 1,000 characters), uses the editing revision/receipt contract, and supports undo, redo, autosave, and backups. Catalog forms keep their authored revision and require explicitly reloading details after conflict.
