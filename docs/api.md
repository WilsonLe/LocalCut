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

Long jobs expose completion and subscriptions. Cancellation before publication rejects completion with CANCELLED and releases an undelivered frame bitmap or export artifact. Imports and transcripts instead publish at their successful IndexedDB commit: cancellation aborts pending writes, but a commit that already succeeded returns its result even if cancellation arrives before the completion promise settles. Consumers must close returned ImageBitmaps, unsubscribe listeners, dispose delivered artifacts, and dispose the editor. Canvas and AudioContext belong to the caller. Session play/pause/seek/currentTimeUs use the audio clock; audio requires valid browser user activation.

Operations include add/remove/reorderTrack, insert/remove/update/trim/split/move/duplicateClip, setSpeed, explicit ripple, and add/removeTransition. Use updateClip for typed transforms, effects, gains, fades, text, keyframes, and editable caption cues. Submit related changes in one batch. Reuse exactly the same request envelope to retry; different content under the same ID fails REQUEST_CONFLICT.

An updateClip patch changes only supplied top-level fields; omitted position, gain, effects, cues, and keyframes retain their existing values. Supplied text styles, cue arrays, and keyframe maps replace that field rather than merging nested values. A supplied text style may use the style's normal defaults.

Times are safe integer microseconds. Frame rates are {num, den}. Source and timeline ranges are half-open. Timed media duration must equal the source interval divided by speed, within integer rounding. Speed is 0.25–4. Keyframes have stable IDs, clip-local timing, ordered timestamps, and linear/hold interpolation. Existing version-one documents and new inputs may omit a keyframe ID; parsing derives it deterministically from the clip ID, property, and timestamp. Repeated reads therefore keep the same IDs. Split evaluates the boundary, rebases right-hand values, and assigns distinct IDs to new boundary keys. Duplication assigns new nested keyframe and cue IDs.

Crossfades and black fades require two ordered overlapping image or video clips on one video track, with no third clip intersecting the transition. Image-to-image and image-to-video transitions use the same compositor as video-to-video transitions. Commands never extend media or move neighboring clips implicitly.

SRT/WebVTT helpers import/export plain cues; display caption clips burn them into frames. A media clip's transcriptId links source-timed generated cues, which are retimed through its source range, speed, and placement. Transcription accepts an exact integer-microsecond [startUs, endUs) range within the source asset. Returned cue endpoints stay inside that range even when 16 kHz input sampling pads the final sample.

Stable error codes include INVALID_DOCUMENT, INVALID_COMMAND, REVISION_CONFLICT, REQUEST_CONFLICT, NOT_FOUND, MISSING_ASSET, UNSUPPORTED_CODEC, AMBIGUOUS_STREAM, QUOTA_EXCEEDED, CANCELLED, WORKER_FAILED, PLAYBACK_BLOCKED, MODEL_REQUIRED, MODEL_DOWNLOAD_FAILED, and DISPOSED. Error messages identify the relevant operation or resource.

Project JSON export returns a version-one backup envelope containing referenced asset metadata and source transcripts. Import validates and restores these atomically with fresh IDs; originals are retained separately and supplied through assets.relink using the imported clip asset IDs. Legacy bare documents remain accepted in a namespace with existing metadata.

Preview play() resolves after initial scheduling and presentation succeed, and rejects startup failures such as MISSING_ASSET or PLAYBACK_BLOCKED. The first audio block is prepared before the playback clock starts. If a later decode exhausts queued audio, the timeline holds at the scheduled audio boundary and resumes consecutive blocks when decoding finishes; video presentation uses that same adjusted time. session.onError(listener) observes structured errors during playback, including a worker crash; failures stop the session. Unsubscribe and dispose the session when finished. Superseded asynchronous seeks cannot overwrite newer presentation or position.
