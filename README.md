# LocalCut

A local video editor that builds to static files. The conversation-led workspace combines local media import, preview, timeline editing and export with optional AI-provider editing proposals. The separately built `editor.js` and `ai.js` entries remain available to other consumers.

## Editing

1. Create a project or open a project saved in this browser. Import video, audio or images; files are added to the matching timeline track in selection order.
2. Select clips to adjust timing, speed, audio pitch, gain or text. Use Clip properties to build curved, linear or staircase speed ramps with editable points. Scrub or play the preview. Use Undo and Redo to reverse committed edits.
3. Optionally connect OpenRouter, an OpenAI-compatible endpoint, or ChatGPT, configure service routes and choose a model, and describe an edit. Review the proposed operations, then Apply or Discard. Prompts and permitted metadata go to the configured LLM route; original media stays local. Separate indexing permission allows generated stills, audio excerpts and video excerpts with sound to be sent by an explicit Index action. Sharing names, on-screen text and transcripts is off by default.
4. Use Text to speech from chat or Commands to generate multilingual narration with a chosen voice, preview it, adjust speed/total length and add it to the audio timeline through the independent configured TTS route.
5. Export MP4 or WebM after browser capability checks, then Save video. Use Settings → Project → Export project for a backup with optional originals. Settings → Workspace → Export workspace lets you select settings, projects, versions and original assets. Preview and select backup contents before importing.

The workspace starts without opening editing storage or starting media services. AI restores only when a saved credential is present. Projects remain on this origin and browser; workspace/appearance preferences survive reload locally; indexing permission is remembered separately; OpenRouter credentials persist separately and restore the connection; conversation state does not. Compatible-endpoint API keys remain session-only. ChatGPT tokens are saved separately and restored through an explicit action; Disconnect removes them. Open a saved project after reloading. See [workspace behavior](docs/workspace.md) and the maintained [user preferences](docs/user-preferences.md).

## Setup

Use Node 24 LTS and pnpm 11.25.0:

```sh
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
pnpm dev
```

Current desktop Google Chrome is required for native codec, OPFS, Web Locks, and production integration tests. Local editing requires no runtime environment variables, accounts, servers, or secrets. Optional remote AI needs an explicitly connected provider key or ChatGPT OAuth sign-in. Custom endpoints must allow browser CORS. HTTPS or localhost is required for browser storage.

Contributors and coding agents: start with [AGENTS.md](AGENTS.md) and the [development guide](docs/development.md) for module ownership, fast check selection, build reuse, and the single review-and-address cycle.

Validation runs locally with `pnpm check` and the applicable real transcription/performance acceptance commands. Hosted CI is disabled. GitHub Pages builds and publishes automatically on every push to `main`; release packaging remains separate from local validation. Confirmed manual redeployment is also available. See [deployment and rollback](DEPLOY.md).

| Command                               | Purpose                                                       |
| ------------------------------------- | ------------------------------------------------------------- |
| `pnpm dev`                            | Local editor workspace at the root path                       |
| `pnpm typecheck`                      | Strict browser, worker, Node/test/config checks               |
| `pnpm lint`                           | ESLint and pure-core import boundaries                        |
| `pnpm format:check`                   | Prettier                                                      |
| `pnpm test`                           | Domain and service unit tests                                 |
| `pnpm build`                          | App + `editor.js` + `ai.js` + worker assets + declarations    |
| `pnpm build:root`                     | Equivalent build at `/` in `dist-root`                        |
| `pnpm test:browser`                   | Production integration in Google Chrome                       |
| `pnpm test:safari`                    | Native Safari storage and H.264/AAC regressions (macOS)       |
| `pnpm test:profile <label> <command>` | Wall time, descendant CPU/RSS and host utilization profile    |
| `pnpm test:tooling`                   | Resource scheduling and verified-build cache regressions      |
| `pnpm test:ui`                        | Focused workspace tests; rebuild only stale production assets |
| `pnpm test:transcription`             | Real pinned Whisper preparation and cached replay             |
| `pnpm test:performance`               | Warmup, two- and five-minute 1080p exports                    |
| `pnpm test:ai:live`                   | Opt-in real OpenRouter test; private key and model required   |
| `pnpm check:bundle`                   | Actual entry graph and static artifact budgets                |
| `pnpm check`                          | Normal formatting/lint/type/unit/build/bundle/browser gates   |

Browser commands require both production builds first, except `test:ui` and `test:safari`, which verify or build them automatically. The harness server is test-only and never enters `dist`. Unit concurrency adapts to CPU availability, current load, available memory (including reclaimable OS cache), and cgroup limits. Normal Chrome defaults to one reused browser worker. Set `LOCALCUT_BROWSER_WORKERS=2` for explicitly requested parallelism within that same live capacity budget. `LOCALCUT_TEST_SLOTS=1` makes the check pipeline serial; `LOCALCUT_UNIT_WORKERS=1` narrows the unit pool; `LOCALCUT_BROWSER_WORKERS=1` keeps browser runs serial. Overrides accept positive safe integers and only narrow available capacity; there are no fixed machine-size ceilings. Normal Chrome reserves two CPU slots and about 1.5 GiB per worker. Transcription, performance, and live-provider tests remain serial, explicit additional gates; none is included in ordinary `check`.

For UI iteration, run `pnpm test:ui`, or narrow it with `pnpm test:ui --grep 'speed rounding'`. It runs workspace tests at both static base paths. Content hashes verify build inputs and every output file before reuse; changed source, build configuration, dependencies, or missing/tampered output triggers a rebuild. Documentation and test-only edits do not. The stamps live in ignored `.cache/build-state/`, outside deployed assets. `pnpm check` uses the same verified-build reuse and retains all static, unit, artifact and Chrome gates. It refreshes its shared resource budget at gate boundaries and every second while waiting, overlaps independent checks, runs both builds in sequence, and starts browser consumers only after outputs pass the bundle gate.

TypeScript 7.0.2 supplies `tsc` through the `@typescript/native` alias. The `typescript` alias supplies Microsoft's pinned v6 compatibility API for typescript-eslint; it does not replace the production compiler. Dependencies and the lockfile are exact.

See [architecture](docs/architecture.md), [API](docs/api.md), [OpenRouter integration and privacy](docs/ai.md), [storage](docs/storage.md), [local transcription](docs/transcription.md), [verification](docs/validation.md), and [deployment](DEPLOY.md).

Native Safari: enable **Allow remote automation** in Safari’s Develop → Developer Settings once, then run `pnpm test:safari`. The suite uses installed Safari through `safaridriver`, verifies/reuses both builds, and runs serially with its own loopback ports. It checks storage reload and three MP4 round trips at each base path, including stereo WAV input, reimported AAC and silence. Unavailable native capabilities fail. Results and failure screenshots are saved in `test-results/safari/`. Playwright WebKit is not native Safari evidence. Safari is an explicit additional gate, with Chrome remaining the complete acceptance target.
