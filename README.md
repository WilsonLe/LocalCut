# LocalCut

A local video editor that builds to static files. The conversation-led workspace combines local media import, preview, timeline editing and export with optional OpenRouter editing proposals. The separately built `editor.js` and `ai.js` entries remain available to other consumers.

## Editing

1. Create a project or open a project saved in this browser. Import video, audio or images; files are added to the matching timeline track in selection order.
2. Select clips to adjust timing, speed, gain or text. Scrub or play the preview. Use Undo and Redo to reverse committed edits.
3. Optionally connect OpenRouter, choose a model, and describe an edit. Review the proposed operations, then Apply or Discard. Prompts and permitted metadata go to OpenRouter; raw media stays local. Sharing names, on-screen text and transcripts is off by default.
4. Export MP4 or WebM after browser capability checks, then Save video. Use Settings → Project → Export project for a backup with optional originals. Settings → Workspace → Export workspace lets you select settings, projects, versions and original assets. Preview and select backup contents before importing.

The workspace starts without opening editing storage or starting media/AI services. Projects remain on this origin and browser; workspace/appearance preferences survive reload locally; credentials and conversation state do not. Open a saved project after reloading. See [workspace behavior](docs/workspace.md) and the maintained [user preferences](docs/user-preferences.md).

## Setup

Use Node 24 LTS and pnpm 11.25.0:

```sh
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
pnpm dev
```

Current desktop Google Chrome is required for native codec, OPFS, Web Locks, and production integration tests. Local editing requires no runtime environment variables, accounts, servers, or secrets. Optional remote AI needs an explicitly connected user-owned OpenRouter key. HTTPS or localhost is required for browser storage.

Contributors and coding agents: start with [AGENTS.md](AGENTS.md) and the [development guide](docs/development.md) for module ownership, fast check selection, build reuse, and the single review-and-address cycle.

Validation runs locally with `pnpm check` and the applicable real transcription/performance acceptance commands. Hosted CI is disabled. The manually triggered GitHub Pages deployment remains separate and requires deployment authorization.

| Command                   | Purpose                                                       |
| ------------------------- | ------------------------------------------------------------- |
| `pnpm dev`                | Local editor workspace at the root path                       |
| `pnpm typecheck`          | Strict browser, worker, Node/test/config checks               |
| `pnpm lint`               | ESLint and pure-core import boundaries                        |
| `pnpm format:check`       | Prettier                                                      |
| `pnpm test`               | Domain and service unit tests                                 |
| `pnpm build`              | App + `editor.js` + `ai.js` + worker assets + declarations    |
| `pnpm build:root`         | Equivalent build at `/` in `dist-root`                        |
| `pnpm test:browser`       | Production integration in Google Chrome                       |
| `pnpm test:ui`            | Focused workspace tests; rebuild only stale production assets |
| `pnpm test:transcription` | Real pinned Whisper preparation and cached replay             |
| `pnpm test:performance`   | Warmup, two- and five-minute 1080p exports                    |
| `pnpm test:ai:live`       | Opt-in real OpenRouter test; private key and model required   |
| `pnpm check:bundle`       | Actual entry graph and static artifact budgets                |
| `pnpm check`              | Normal formatting/lint/type/unit/build/bundle/browser gates   |

Browser commands require both production builds first, except `test:ui`, which verifies or builds them automatically. The harness server is test-only and never enters `dist`. Normal browser tests use two independent Chrome workers; set `LOCALCUT_BROWSER_WORKERS=1` for a serial run, or an integer up to 4 on a suitable machine. Transcription, performance, and live-provider tests remain serial, explicit additional gates; none is included in ordinary `check`.

For UI iteration, run `pnpm test:ui`, or narrow it with `pnpm test:ui --grep 'speed rounding'`. It runs workspace tests at both static base paths. Content hashes verify build inputs and every output file before reuse; changed source, build configuration, dependencies, or missing/tampered output triggers a rebuild. Documentation and test-only edits do not. The stamps live in ignored `.cache/build-state/`, outside deployed assets. `pnpm check` still performs clean production builds and the complete normal suite.

TypeScript 7.0.2 supplies `tsc` through the `@typescript/native` alias. The `typescript` alias supplies Microsoft's pinned v6 compatibility API for typescript-eslint; it does not replace the production compiler. Dependencies and the lockfile are exact.

See [architecture](docs/architecture.md), [API](docs/api.md), [OpenRouter integration and privacy](docs/ai.md), [storage](docs/storage.md), [local transcription](docs/transcription.md), [verification](docs/validation.md), and [deployment](DEPLOY.md).
