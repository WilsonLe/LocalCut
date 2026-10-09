# Headless API

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
| projects      | create, list, open, snapshot, delete, exportJSON, importJSON            |
| assets        | import, inspect, relink, thumbnails, contactSheet, waveform, derivative |
| commands      | validate, apply, undo, redo                                             |
| preview       | frame, session                                                          |
| exports       | preflight, start                                                        |
| transcription | status, prepare, transcribe, transcript, clearModelCache                |
| events        | projects, jobs                                                          |
| lifecycle     | job.cancel, session.dispose, artifact.dispose, editor.dispose           |

The source facade exports inferred Editor, EditorOptions, persisted project/clip/track types, command/receipt types, Job/Progress/events, preview types, export types, subtitle helpers, and EditorError. Generated declarations preserve transitive type references.

Long jobs expose completion and subscriptions; cancellation rejects completion with CANCELLED. Consumers must close returned ImageBitmaps, unsubscribe listeners, dispose artifacts, and dispose the editor. Canvas and AudioContext belong to the caller. Session play/pause/seek/currentTimeUs use the audio clock; audio requires valid browser user activation.

Operations include add/remove/reorderTrack, insert/remove/update/trim/split/move/duplicateClip, setSpeed, explicit ripple, and add/removeTransition. Use updateClip for typed transforms, effects, gains, fades, text, keyframes, and editable caption cues. Submit related changes in one batch. Reuse exactly the same request envelope to retry; different content under the same ID fails REQUEST_CONFLICT.

Times are safe integer microseconds. Frame rates are {num, den}. Source and timeline ranges are half-open. Timed media duration must equal the source interval divided by speed, within integer rounding. Speed is 0.25–4. Keyframes are clip-local, ordered, and use linear/hold interpolation. Split evaluates the boundary and rebases the right-hand values.

Crossfades and black fades require two ordered overlapping video clips on one video track, with no third clip intersecting the transition. Commands never extend media or move neighboring clips implicitly.

SRT/WebVTT helpers import/export plain cues; display caption clips burn them into frames. A media clip's transcriptId links source-timed generated cues, which are retimed through its source range, speed, and placement.

Stable error codes include INVALID_DOCUMENT, INVALID_COMMAND, REVISION_CONFLICT, REQUEST_CONFLICT, NOT_FOUND, MISSING_ASSET, UNSUPPORTED_CODEC, AMBIGUOUS_STREAM, QUOTA_EXCEEDED, CANCELLED, WORKER_FAILED, PLAYBACK_BLOCKED, MODEL_REQUIRED, MODEL_DOWNLOAD_FAILED, and DISPOSED. Error messages identify the relevant operation or resource.

Project JSON export returns a version-one backup envelope containing referenced asset metadata and source transcripts. Import validates and restores these atomically with fresh IDs; originals are retained separately and supplied through assets.relink using the imported clip asset IDs. Legacy bare documents remain accepted in a namespace with existing metadata.

Preview play() resolves after initial scheduling and presentation succeed, and rejects startup failures such as MISSING_ASSET or PLAYBACK_BLOCKED. session.onError(listener) observes structured errors during playback, including a worker crash; failures stop the session. Unsubscribe and dispose the session when finished. Superseded asynchronous seeks cannot overwrite newer presentation or position.
