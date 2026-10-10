# Application and runtime

Applies throughout `src/`, together with the root guide. Read the nearest module `AGENTS.md` before changing its code. Use [architecture](../docs/architecture.md) for boundaries and [API contracts](../docs/api.md) for shared behavior.

- Preserve the client-only static application, `editor.js` and `ai.js` entries. Load media, inference and optional settings on demand; resolve worker/assets through Vite-supported module URLs.
- Initial navigation must not create an editor, open IndexedDB/OPFS editing storage, start workers, request permissions or fetch models/AI. Reading local UI preferences before rendering is allowed. Explicit create/open/import actions initialize editing. An explicit OpenRouter OAuth return may finish authentication after removing callback secrets.
- UI and external transports use the shared editor/assistant APIs. Keep one canonical project document; carry authored revisions and request IDs through mutations.
- Persist stable IDs, integer microseconds, rational frame rates and half-open intervals. Never persist object URLs, native handles or media bytes inside project JSON. Follow the local core/storage guides for validation and atomicity.
- Keep source media, decoded source audio and speech transcription inference local. Model/runtime downloads require explicit preparation. Optional remote chat, separately consented derived indexing evidence and speech synthesis remain in `ai/`, behind explicit sharing choices or a Generate action; speech synthesis sends only the authored script and speech settings.
- Keep native samples, bitmaps, workers, streams and audio nodes owned and disposable. Cancellation/disposal must prevent stale results from being published.
- Use the existing semantic styles, shadcn/Base UI foundation and system fonts. Report asynchronous progress and errors accessibly through the owning consumer.

Start with the changed module's focused check, then use the [development guide](../docs/development.md) for the applicable integration gate. Updating entry imports, worker paths or shared source boundaries requires both static builds and bundle checks.
