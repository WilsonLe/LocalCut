# Media processing

This directory owns container inspection, derivative conversion, shared frame/PCM
composition, codec preflight, and streaming export. Read [architecture](../../docs/architecture.md),
[API contracts](../../docs/api.md), and [acceptance evidence](../../docs/validation.md).

- Keep container formats explicit. Inspect all selected streams and reject ambiguous or unsupported streams; preserve source orientation and required audio.
- Bound native decoding resources. Each active video clip owns its cursor even when clips share an asset; release ended cursors, samples, bitmaps, inputs, and PCM leases, including stale results after cancellation.
- Preview and export share `Renderer`. Preserve scratch-surface effect order, resolution-scaled blur, weighted premultiplied crossfades, and black fades that cover lower tracks.
- Mix bounded 48 kHz stereo windows. Derive resampling phase from absolute sample indices, retain interpolation halos, apply gain/fades/mute, and clamp output without allocating full-project audio.
- Indexing uses versioned four-Hz pixel analysis and source timestamps without LLM discovery. Process every detected scene, preserve orientation/audio, remove descriptive metadata, and keep all evidence bounded to scene endpoints.
- Probe the exact requested video/audio configuration. Unsupported settings fail explicitly; export must not silently switch format or omit audio.
- Schedule export from frame indices, round the end to a full frame, and align/pad audio to that endpoint. Preserve the configuration-specific AAC priming correction.
- Normalize encoded AAC decoder metadata in both priming and muxing. WebKit can return an ES descriptor instead of AudioSpecificConfig; preserve valid native configurations and reject malformed envelopes. The regression fixture is in `tests/unit/audio-config.test.ts`.
- Stream with backpressure into journaled OPFS output. Publish only after finalization; failures and cancellation clean temporary output. The caller disposes delivered artifacts.

Run focused checks from the repository root:

```sh
pnpm test tests/unit/video-frame-cursor.test.ts
pnpm test:browser tests/browser/media-acceptance.spec.ts tests/browser/editor.spec.ts
```

Use current production builds and real Chrome per [development recipes](../../docs/development.md).
Export/resource changes also need the explicit performance gate in [validation](../../docs/validation.md).
