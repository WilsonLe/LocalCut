# Headless API

Optional remote AI lives in the separately imported `ai.js` entry. Its connection, event, proposal, cancellation and frontend wiring contracts are documented in [OpenRouter integration](ai.md). Constructing either AI object starts no work; the editor is opened separately and supplied to the assistant.

Serve dist over HTTPS or localhost. Import from the deployment base:

```ts
import { createEditor } from '/LocalCut/editor.js';
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

| Family        | Methods                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| workspace     | snapshot, export, import                                                |
| projects      | create, list, open, snapshot, delete, exportJSON, importJSON            |
| assets        | import, inspect, relink, thumbnails, contactSheet, waveform, derivative |
| commands      | validate, apply, undo, redo                                             |
| preview       | frame, session                                                          |
| exports       | preflight, start                                                        |
| transcription | status, prepare, transcribe, transcript, clearModelCache                |
| events        | projects, jobs                                                          |
| lifecycle     | job.cancel, session.dispose, artifact.dispose, editor.dispose           |

The source facade exports inferred Editor, EditorOptions, persisted project/clip/track types, command/receipt types, Job/Progress/events, preview types, export types, subtitle helpers, and EditorError. Generated declarations preserve transitive type references.

Long jobs expose completion and subscriptions. Cancellation before publication rejects completion with CANCELLED and releases an undelivered frame bitmap or export artifact. Imports and transcripts instead publish at their successful IndexedDB commit: cancellation aborts pending writes, but a commit that already succeeded returns its result even if cancellation arrives before the completion promise settles. Consumers must close returned ImageBitmaps, unsubscribe listeners, dispose delivered artifacts, and dispose the editor. Canvas and AudioContext belong to the caller. Session play/pause/seek/currentTimeUs use the audio clock; audio requires valid browser user activation.

Operations include add/remove/reorderTrack, insert/remove/update/trim/split/move/duplicateClip, setSpeed, explicit ripple, and add/removeTransition. Use updateClip for typed transforms, effects, gains, fades, text, keyframes, and editable caption cues. Submit related changes in one batch. Reuse exactly the same request envelope to retry; different content under the same ID fails REQUEST_CONFLICT.

New receipts fingerprint the submitted JSON content before parser defaults, with object-key order ignored. Keep omitted fields omitted when retrying: supplying an explicit default is different content. Unversioned receipts from the original version-one release retain its frozen parser normalization, including its old patch defaults. A matching receipt is returned before checking the current revision; newly supplied fields are never discarded to force a legacy match.

`projects.importJSON(text, { repairLegacyIdentities: true })` explicitly repairs duplicate caption cue IDs in unmarked legacy bare documents or backup envelopes. The default import stays strict. Backups marked `identityVersion: 1` always stay strict, even with the repair option. Repair preserves timing, text, settings, and a canonical original cue owner; duplicate owners receive deterministic IDs. Imported projects still receive a fresh project ID and revision zero. This option does not repair arbitrary malformed documents, source references, or collisions between different object kinds.

An updateClip patch changes only supplied top-level fields; omitted position, gain, effects, cues, and keyframes retain their existing values. Supplied text styles, cue arrays, and keyframe maps replace that field rather than merging nested values. A supplied text style may use the style's normal defaults.

Times are safe integer microseconds. Frame rates are {num, den}. Source and timeline ranges are half-open. Timed media duration must equal the source interval divided by speed, within integer rounding. Speed is 0.25–4. Keyframes have stable IDs, clip-local timing, ordered timestamps, and linear/hold interpolation. Existing version-one documents and new inputs may omit a keyframe ID; parsing derives it deterministically from the clip ID, property, and timestamp. Repeated reads therefore keep the same IDs. Split evaluates the boundary, rebases right-hand values, and assigns distinct IDs to new boundary keys. Duplication assigns new nested keyframe and cue IDs.

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

`separateAudio { clipId, audioClipId, trackId }` requires a video clip and an existing audio track. It creates an audio clip referencing the same source, with exact source endpoints, speed, placement, gain, mute, fade envelope, transcript linkage and distinct gain keyframe IDs. It mutes the original video. A muted source track produces a muted audio clip. Existing asset validation rejects video sources without audio atomically. This is a timeline edit; it does not extract or duplicate a file.

Optional `clip.groupId` persists a flat group of at least two clips across tracks. Group IDs share the document identity namespace. `groupClips { groupId, clipIds }` creates a fresh group; regrouping existing groups requires every member. `ungroupClips { groupId }` removes membership. `moveGroup { groupId, deltaUs }` moves every member by the same signed integer offset. `duplicateGroup { groupId, newGroupId, newClipIds, deltaUs }` requires a fresh ID mapped from every member and retains internal transitions with new identities. Individual clip operations remain explicit; ordinary `duplicateClip` creates an ungrouped copy. Splitting a grouped clip keeps both fragments in the group. Removing clips/tracks dissolves singleton membership at the end of the atomic batch. No group operation extends sources or implies ripple.

`applyTransitionTemplate { transitionId, trackId, fromClipId, toClipId, template, strength? }` supports `crossfade`, `black`, `slide-left`, `slide-right`, `zoom-in`, `zoom-out`, and `blur-dissolve`. Strength is 0–1 (default 0.5). It requires the same ordered adjacent visual overlap as `addTransition`. Recipes expand to ordinary clip-local position, size or blur keyframes plus the existing crossfade/black blend. Preview/export use the existing compositor. Templates preserve source/timeline ranges and unrelated attributes; targeted animation inside the overlap is replaced by sampled current values plus the recipe, while values outside it retain continuity. Slide travel is strength × project width; zoom varies size by up to 25%; blur adds up to 40 units, clamped to 100.

The transition's optional `templateId` and `strength` describe its starting recipe, not a locked effect. Inspect the result and use `updateClip` to tune the base values/keyframes. Reapplying a template builds on current values. `removeTransition` removes only the blend; keyframes remain ordinary authored animation. Undo reverses the complete template edit. Old documents without membership/template metadata still parse; frozen legacy receipt normalization remains unchanged.
