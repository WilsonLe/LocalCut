# LocalCut

A local, headless video editor foundation that builds to static files. The production React page intentionally renders nothing. Import the separately built editor module to exercise the engine; product mockups and controls will follow.

## Setup

Use Node 24 LTS and pnpm 11.25.0:

```sh
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
pnpm dev
```

Current desktop Google Chrome is required for native codec, OPFS, Web Locks, and production integration tests. No runtime environment variables, accounts, servers, or secrets are required. HTTPS or localhost is required for browser storage.

| Command                   | Purpose                                                     |
| ------------------------- | ----------------------------------------------------------- |
| `pnpm dev`                | Blank application at the root path                          |
| `pnpm typecheck`          | Strict browser, worker, Node/test/config checks             |
| `pnpm lint`               | ESLint and pure-core import boundaries                      |
| `pnpm format:check`       | Prettier                                                    |
| `pnpm test`               | Domain and service unit tests                               |
| `pnpm build`              | App + `editor.js` + worker assets + declarations            |
| `pnpm build:root`         | Equivalent build at `/` in `dist-root`                      |
| `pnpm test:browser`       | Production integration in Google Chrome                     |
| `pnpm test:transcription` | Real pinned Whisper preparation and cached replay           |
| `pnpm test:performance`   | Warmup, two- and five-minute 1080p exports                  |
| `pnpm check:bundle`       | Actual entry graph and static artifact budgets              |
| `pnpm check`              | Normal formatting/lint/type/unit/build/bundle/browser gates |

Browser commands require both production builds first. The harness server is test-only and never enters `dist`. Transcription and performance are explicit additional acceptance gates; neither is included in ordinary `check`.

TypeScript 7.0.2 supplies `tsc` through the `@typescript/native` alias. The `typescript` alias supplies Microsoft's pinned v6 compatibility API for typescript-eslint; it does not replace the production compiler. Dependencies and the lockfile are exact.

See [architecture](docs/architecture.md), [API](docs/api.md), [storage](docs/storage.md), [transcription and privacy](docs/transcription.md), [verification](docs/validation.md), and [deployment](DEPLOY.md).
