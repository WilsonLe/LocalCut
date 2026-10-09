# LocalCut

A local video editor that builds to static files. The conversation-led workspace combines local media import, preview, timeline editing and export with optional OpenRouter editing proposals. The separately built `editor.js` and `ai.js` entries remain available to other consumers.

## Editing

1. Create a project or open a project saved in this browser. Import video, audio or images; files are added to the matching timeline track in selection order.
2. Select clips to adjust timing, speed, gain or text. Scrub or play the preview. Use Undo and Redo to reverse committed edits.
3. Optionally connect OpenRouter, choose a model, and describe an edit. Review the proposed operations, then Apply or Discard. Prompts and permitted metadata go to OpenRouter; raw media stays local. Sharing names, on-screen text and transcripts is off by default.
4. Export MP4 or WebM after browser capability checks, then Save video. Keep a project JSON backup and copies of the original media separately.

The workspace starts without opening storage or starting media/AI services. Projects remain on this origin and browser; credentials and conversation state do not survive reload. Open a saved project after reloading. See [workspace behavior](docs/workspace.md).

## Setup

Use Node 24 LTS and pnpm 11.25.0:

```sh
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
pnpm dev
```

Current desktop Google Chrome is required for native codec, OPFS, Web Locks, and production integration tests. Local editing requires no runtime environment variables, accounts, servers, or secrets. Optional remote AI needs an explicitly connected user-owned OpenRouter key. HTTPS or localhost is required for browser storage.

| Command                   | Purpose                                                     |
| ------------------------- | ----------------------------------------------------------- |
| `pnpm dev`                | Local editor workspace at the root path                     |
| `pnpm typecheck`          | Strict browser, worker, Node/test/config checks             |
| `pnpm lint`               | ESLint and pure-core import boundaries                      |
| `pnpm format:check`       | Prettier                                                    |
| `pnpm test`               | Domain and service unit tests                               |
| `pnpm build`              | App + `editor.js` + `ai.js` + worker assets + declarations  |
| `pnpm build:root`         | Equivalent build at `/` in `dist-root`                      |
| `pnpm test:browser`       | Production integration in Google Chrome                     |
| `pnpm test:transcription` | Real pinned Whisper preparation and cached replay           |
| `pnpm test:performance`   | Warmup, two- and five-minute 1080p exports                  |
| `pnpm test:ai:live`       | Opt-in real OpenRouter test; private key and model required |
| `pnpm check:bundle`       | Actual entry graph and static artifact budgets              |
| `pnpm check`              | Normal formatting/lint/type/unit/build/bundle/browser gates |

Browser commands require both production builds first. The harness server is test-only and never enters `dist`. Transcription and performance are explicit additional acceptance gates; neither is included in ordinary `check`.

TypeScript 7.0.2 supplies `tsc` through the `@typescript/native` alias. The `typescript` alias supplies Microsoft's pinned v6 compatibility API for typescript-eslint; it does not replace the production compiler. Dependencies and the lockfile are exact.

See [architecture](docs/architecture.md), [API](docs/api.md), [OpenRouter integration and privacy](docs/ai.md), [storage](docs/storage.md), [local transcription](docs/transcription.md), [verification](docs/validation.md), and [deployment](DEPLOY.md).
