# Static deployment and rollback

LocalCut serves static files and has no application backend, runtime secrets, callback rewrite or service worker. Hash-based navigation works at both `/` and `/LocalCut/`. Vite resolves worker URLs against the build base. Browser-local projects belong to the origin; moving to another host/scheme/port requires portable backups, not copying static files alone.

## GitHub Pages

The production URL is [https://wilsonle.github.io/LocalCut/](https://wilsonle.github.io/LocalCut/). The default build base is `/LocalCut/`.

[The Pages workflow](.github/workflows/pages.yml) builds and deploys every push to `main`, including merged PRs. GitHub Pages must use **GitHub Actions** as its publishing source. Feature branches and PRs do not deploy. The workflow installs Node 24 and pnpm 11.25.0, uses the frozen lockfile, builds the application, uploads only `dist/`, and publishes it with Pages/OIDC permissions scoped to the deployment job.

The user has authorized this automatic release behavior; merging an authorized reviewed change to `main` triggers deployment without a separate dispatch. For an approved manual redeploy, select `main` in **Actions → GitHub Pages deployment → Run workflow** and set `confirm_deploy=true`. Other refs or an unconfirmed dispatch skip packaging/deployment.

Validation runs locally by project preference. Before merging runtime/configuration/dependency changes, complete `pnpm check` and applicable real transcription/performance gates from [validation](docs/validation.md). Documentation-only changes use formatting/link/command validation. Hosted check/performance workflows are disabled; Pages packaging is not a substitute for local checks. See [releasing](docs/releasing.md) for candidate identity, review and approval.

For a fork, configure Pages publishing and change the build base if its repository name/path differs. Do not assume the upstream `/LocalCut/` build fits every fork or custom domain.

## Self-hosting

Use [README setup](README.md#setup), Node 24 and pinned pnpm, then build for the URL path where the app will be served:

```sh
# Project site at /LocalCut/; publishes dist/:
pnpm build

# Root URL or custom domain; publishes dist/:
LOCALCUT_BASE_PATH=/ pnpm build

# A different subdirectory; publishes dist/:
LOCALCUT_BASE_PATH=/video-editor/ pnpm build

# Separate root-path acceptance output; publishes dist-root/:
pnpm build:root
```

Build these targets sequentially. A normal/custom-base build writes `dist/`; `build:root` writes `dist-root/`. Do not change the base only at upload time: HTML, icons, manifest, workers and lazy imports must match the built path.

Inspect a default build locally with `pnpm preview` at `http://localhost:4178/LocalCut/`. For the separate root output:

```sh
pnpm exec vite preview --outDir dist-root --base / --port 4178 --strictPort
```

This uses `http://localhost:4178/`. For a custom-base `dist` build, pass that same base to Vite preview. Preview is a development smoke check, not a production hosting service. Use an unoccupied port and keep mutable output/report directories isolated from other runs.

Upload the entire chosen output to an HTTPS static host at the matching path. Preserve JavaScript module MIME types, hashed assets, worker paths, fonts and notices. No history fallback rewrite is required for hash routes. Inference is single-thread WASM and does not require multithread isolation headers. A custom content-security/network policy must account for explicitly prepared inference downloads and selected AI providers; test it with the relevant workflows rather than bypassing browser security.

Use HTTPS in production (localhost is supported for development). Host the app on a dedicated origin when possible: unrelated scripts on the same origin may access persisted credentials and browser-local data. Custom provider endpoints need browser CORS permission for that exact origin. Never put secrets in build variables, source files or static configuration.

## Distribution contents

Publish only `dist/` or the intentionally selected `dist-root/`. Output includes `index.html`, `modules.json`, stable `editor.js`/`ai.js` compatibility re-exports, content-hashed engine/AI/support/worker assets, declarations, icons/manifest, fonts/notices and Vite's build manifest. Keep the complete output together; do not mix assets from different builds.

The authored-text catalog includes roughly 297 MiB of licensed WOFF2 assets under `fonts/<snapshot-sha256>/`; the application requests only needed subsets. Preserve per-family licenses and catalog manifests with distributions. Test harnesses, fixtures, models, caches, credentials and large inference binaries remain outside deployed output.

Include the root [MIT license](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md) with downloadable distributions or make them available alongside a hosted distribution. The static build does not automatically copy those root documents. Bundled notices and font licenses already present in output must also be preserved.

Prefer immutable hashed-asset caching and short-lived/revalidated HTML/discovery. Headless clients discover hashed editor/AI URLs together using [the API recipe](docs/api.md); the workspace imports hashed entries directly. Old cached compatibility aliases cannot be invalidated remotely. Keep discovery, aliases and all referenced modules together. Keep prior hashed assets accessible while clients transition if the host supports it. This is hosting guidance, not a claim that upstream Pages cache headers are configurable through this repository.

## Cache consistency and recovery

Tabs left open across deployment may request removed old chunks or font snapshots. The workspace offers explicit recovery for lazy-chunk failures; it never reloads automatically or clears local data. Its Reload action fetches a fresh HTML URL while preserving the project route. A failed old font snapshot reports an actionable error; reload to adopt the current snapshot. If interrupted work must continue on an old release, host the complete old static artifact (including chunks and its font snapshot) rather than mixing files from releases. Configure HTML/discovery revalidation on hosts that expose cache headers; GitHub Pages does not provide application-controlled response headers. A rollout/recovery check must include a tab from the previous release, a newly opened tab, and a failed chunk followed by explicit reload.

## Live verification and release identity

A workflow configuration or successful packaging job does not prove availability. Record the merge/deployed commit, Pages run/artifact (or host upload identity), target URL, browser/OS, date and observed results.

After an authorized deployment, use a fresh Google Chrome context with generated local media:

1. Verify the title and rendered workspace at the correct base, and check for missing lazy modules, worker assets, icons or fonts.
2. On a bare URL without saved credentials, verify inert startup: no editing-storage initialization, media/inference workers, model downloads, permission prompts or AI requests before an explicit action. An explicit local project/catalog route and an explicit OAuth return have their documented behavior; saved credential restoration can load AI/catalogs in an existing profile.
3. Create a project, import generated media, render the preview and save a real supported export. Reopen the local project after reload and verify the selected editing change's relevant flow.
4. Verify fresh `modules.json` discovery, the compatibility entries, and worker/font snapshot paths at the deployed base. Check grouped settings, provider controls and responsive/collapsible panels when touched by the release.
5. Export a portable backup with originals and check import in an isolated profile when portability/storage changes are in scope. Do not test against personal media or clear unrelated browser data.

Never initiate paid requests merely to smoke-test deployment. Live sign-in, provider entitlement, remote data sharing and inference need their own explicit actions/authority and evidence. Native Safari coverage remains separate from Chrome acceptance. Record gaps instead of claiming a live flow was verified from a local result.

## Rollback and local data compatibility

To restore manual-only publishing, revert the automatic-release workflow and its documentation through a reviewed, authorized `main` change. Do not silently alter deployment behavior during an unrelated release.

Before rolling back, verify the target release can read the current local data format. Current local formats include persisted keyframe IDs, identity-version metadata on project records/backups, and version-two receipt fingerprints. The older `984107d` release has strict parsers that cannot read every normalized project or new backup, and it does not understand the new receipt format. Rebuilding that release is not a safe data-compatible rollback.

Prefer a reviewed forward fix that retains these readers. Before recovery work, use the current compatible release to export project JSON backups and retain original media separately; preserve the app-owned IndexedDB and OPFS state as well. Current backups omit history/receipts and are intended for a compatible current importer, not a downgrade converter. Do not erase local storage, strip IDs/metadata, or overwrite projects to force an old application to open them. A future downgrade requires an explicit tested converter and separate authorization. A static-asset rollback is appropriate only to a revision whose storage compatibility has been verified.

New authored text may contain bundled `font-` IDs and animation fields. A rollback must retain a parser and font catalog that support those saved styles; prior system-only releases cannot parse them. Prefer a compatible forward fix and preserve current backups rather than stripping authored styles to force a downgrade.
