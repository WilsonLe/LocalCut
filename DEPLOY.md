# Static deployment and rollback

The default production base is /LocalCut/. Set LOCALCUT_BASE_PATH=/ when building for a user site or custom domain. pnpm build:root creates a separate root-path output for testing. Vite resolves workers from module URLs; no server rewrite or runtime secret is required.

Deploy only dist/, which contains index.html, editor.js, hashed support/worker assets, declarations, and the build manifest. Test harnesses, fixtures, models, caches, and large inference binaries remain outside that directory.

.github/workflows/pages.yml is manually triggered and requires confirm_deploy=true. It is not an automatic push deployment. Enable GitHub Pages with GitHub Actions only when deployment is authorized, then dispatch the exact reviewed main revision. A workflow configuration does not prove a live release.

After deployment verify title, empty root, inert navigation, editor import, worker asset paths, and one imported-asset frame/export in Google Chrome at the deployed URL. Record the deployed commit and Pages artifact.

Rollback by rebuilding and manually deploying the last verified main revision. App rollback does not migrate or erase local v1 projects. A future schema migration needs a documented recovery/migration policy before release.
