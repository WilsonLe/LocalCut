# Application and runtime

Applies throughout `src/`, together with the root guide. Read the nearest module `AGENTS.md` before changing its code. Use [architecture](../docs/architecture.md) for boundaries and [API contracts](../docs/api.md) for shared behavior.

- Preserve the client-only static application, `editor.js` entry. Load media and optional settings on demand; resolve worker/assets through Vite-supported module URLs.
- The app root is the project catalog; never restore the retired recent-project pointer automatically. A fresh empty catalog may enumerate existing databases but must not create editing storage, load the editor, start workers or request permissions. Existing catalogs may revalidate through the editor facade; cached summaries never hydrate editable documents. Explicit create/open/import actions and valid workspace/project-catalog identities initialize local editing. Workspace URLs restore only an existing local project; they must not create one, request remote models or start paid work.
- UI and external transports use the shared editor APIs. Keep one canonical project document; carry authored revisions and request IDs through mutations.
- Persist stable IDs, integer microseconds, rational frame rates and half-open intervals. Never persist object URLs, native handles or media bytes inside project JSON. Follow the local core/storage guides for validation and atomicity.
- Keep source media and authored data local. External agents supply STT/TTS; no bundled speech model or provider runtime remains. Product agent AI and provider adapters are removed; see [the removal decision](../docs/ai.md).

- Follow [persistent computation](../docs/development.md#persist-reusable-computation) for new or changed derived work. Reuse valid local results across refreshes; update the storage inventory and prove fresh-worker reuse, invalidation and recovery.
- Keep native samples, bitmaps, workers, streams and audio nodes owned and disposable. Cancellation/disposal must prevent stale results from being published.
- Use the existing semantic styles and shadcn/Base UI foundation, with system fonts as appearance defaults. Appearance and authored text share the pinned, locally served font catalog; prepare faces independently in each rendering realm. Keep the full appearance catalog lazy on default startup and restore saved selected fonts without opening editing services. Report asynchronous progress and errors accessibly through the owning consumer.

Start with the changed module's focused check, then use the [development guide](../docs/development.md) for the applicable integration gate. Updating entry imports, worker paths or shared source boundaries requires both static builds and bundle checks.
