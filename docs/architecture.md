# Architecture

One application package produces two independent entry points. index.html mounts a blank React 19 application and semantic Tailwind/shadcn tokens. editor.js exports the explicitly opened headless engine. Workers are loaded on demand; the blank app imports no engine code. Vite emits ESM workers and paths suitable for both /LocalCut/ and /.

The design-system configuration is shadcn Base UI, neutral Vega, CSS-first Tailwind 4, light/dark variables, and system fonts. No UI component consumers exist yet.

| Boundary     | Responsibility                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| src/core     | Zod v1 documents, commands, history contracts, captions, keyframes, rational timing, sinc interpolation              |
| src/storage  | IndexedDB transactions, immutable originals, OPFS journals, recovery, LRU derivatives, owned namespaces              |
| src/media    | Explicit container imports, metadata/decode, derivative conversion, composition, streaming export, AAC priming probe |
| src/services | Jobs, worker transport, preview clock, pinned model configuration                                                    |
| src/workers  | Separate interactive and background media workers; dedicated single-thread inference worker                          |
| src/editor   | Disposable asynchronous public facade and events                                                                     |

The project owns ordered tracks, clips, overlays/cues, and explicit transitions. It references assets by stable ID. Browser object URLs, file handles, native samples, decoded bytes, and contexts are runtime resources and never part of project JSON.

Commands operate on a clone. Validation finishes before persistence commits document, history, and receipt in one read/write transaction. That transaction serializes competing tab writes. Receipt lookup precedes revision comparison. Undo and redo restore document state while incrementing the live revision; receipts remain until deletion.

Preview and export use the same OffscreenCanvas renderer and bounded audio mixer. Effects run brightness, contrast, saturation, grayscale, blur on scratch surfaces before layering. Crossfades add weighted premultiplied layers. A black transition covers underlying tracks. Source orientation is applied by Mediabunny's sample drawing. PCM is normalized lazily to 48 kHz stereo; windows include interpolation halos and derive phase from absolute timeline sample indices. Constant speed also changes pitch.

Each active video clip owns a sequential decoder cursor retaining only the current frame and one lookahead frame. Forward playback reuses that cursor; backward or distant seeks restart at the requested source time. Simultaneous clips referencing one asset have independent cursors. Ended clips release samples and iterators, and assets without active clips release their container inputs. This bounds decoding resources during long exports while keeping interactive seeking in its separate worker.

Export freezes a revision, probes both codecs, schedules frames from indices, streams encoded packets to a temporary OPFS file, and publishes after finalization. Audio ends at the rounded video endpoint. AAC priming is measured for the exact native configuration through an impulse encode/decode probe; timestamps remove that delay and final packets trim encoder padding. Hardware output bytes may differ between runs.

Jobs have an ID, completion promise, progress subscription, and cancellation. Media work yields regularly and observes cancellation; inference cancellation terminates its dedicated worker. Terminal events are structured. Worker crashes reject pending work and subsequent jobs create a new worker.

No router, service worker, cloud backend, transport-specific agent API, or production window global exists. Future user controls and agent panels share this facade.
