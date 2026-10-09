# Static deployment and rollback

The default production base is /LocalCut/. Set LOCALCUT_BASE_PATH=/ when building for a user site or custom domain. pnpm build:root creates a separate root-path output for testing. Vite resolves workers from module URLs; no server rewrite or runtime secret is required.

Deploy only dist/, which contains index.html, editor.js, hashed support/worker assets, declarations, and the build manifest. Test harnesses, fixtures, models, caches, and large inference binaries remain outside that directory.

.github/workflows/pages.yml is manually triggered and requires confirm_deploy=true. It is not an automatic push deployment. Enable GitHub Pages with GitHub Actions only when deployment is authorized, then dispatch the exact reviewed main revision. A workflow configuration does not prove a live release.

After deployment verify title, empty root, inert navigation, editor import, worker asset paths, and one imported-asset frame/export in Google Chrome at the deployed URL. Record the deployed commit and Pages artifact.

Before rolling back, verify the target release can read the current local data format. This completion release adds persisted keyframe IDs, identity-version metadata on project records/backups, and version-two receipt fingerprints. The older `984107d` release has strict parsers that cannot read every normalized project or new backup, and it does not understand the new receipt format. Rebuilding that release is not a safe data-compatible rollback.

Prefer a reviewed forward fix that retains these readers. Before recovery work, use the current compatible release to export project JSON backups and retain original media separately; preserve the app-owned IndexedDB and OPFS state as well. Current backups omit history/receipts and are intended for a compatible current importer, not a downgrade converter. Do not erase local storage, strip IDs/metadata, or overwrite projects to force an old application to open them. A future downgrade requires an explicit tested converter and separate authorization. A static-asset rollback is appropriate only to a revision whose storage compatibility has been verified.
