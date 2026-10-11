# Troubleshooting

Preserve your work before recovery. Export project/workspace backups with the originals needed to reopen them, and keep original source files separately. Use a fresh browser profile for experiments rather than clearing a working origin.

## Browser and media

| Symptom                                            | Check and next step                                                                                                                                                                            |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project missing after changing URL/device/profile  | Verify the original scheme, host, port and profile. Projects are local to that origin; a project URL alone does not transfer data. Import a portable backup into a compatible app.             |
| Storage/quota failure                              | Check browser storage settings and available disk. Export backups before deleting app data. Use app-owned removal controls; do not delete OPFS/IndexedDB records manually.                     |
| MP4/WebM option unavailable or decode/export fails | Use stable desktop Chrome and record its version/OS. Check the actual container, audio/video codecs and duration. Reproduce with generated media; runtime capability checks are authoritative. |
| Export completes but no file is retained           | Use Save video and check browser download permissions/location. Autosaved projects and downloaded videos are different artifacts.                                                              |
| Screen/window/tab audio missing                    | Check the browser picker and OS permissions; system/tab audio availability depends on the chosen source and platform. Only select sources you intend to record.                                |
| Fonts or workers return 404 after self-hosting     | Build for the exact base path and publish the complete output, including hashed workers, font subsets and licenses. See [deployment](../DEPLOY.md#self-hosting).                               |
| Local transcription reports model unavailable      | Explicitly prepare the model; initial preparation needs network access, cache space and the pinned runtime. A transcription request does not silently download missing weights.                |
| Cached inference works but offline reload fails    | No service worker/offline shell is installed. Cached model availability does not provide full offline application navigation.                                                                  |

Avoid repeated export retries without reading the error. If a new browser revision changes native codec behavior, record the failing codec/configuration and a minimal generated reproduction; do not silently substitute a weaker acceptance channel.

## AI providers

A connection or successful model catalog is not proof that every inference service is authorized. Check the configured service route, exact model/voice, account access/credits and endpoint CORS. Compatible endpoints require the protocol described in [AI routing](ai.md#providers-and-fallback). Do not disable browser security or add keys to query strings to work around CORS.

For OpenRouter sign-in, use the same application origin and current pending attempt. For ChatGPT, paste the entire callback URL only into LocalCut's Callback URL input, using the fresh pending sign-in; see [ChatGPT sign-in](ai.md#chatgpt-sign-in). Never post that URL in an issue. A rejected/expired attempt needs a new sign-in, not replaying a saved callback.

If you replace a key or disconnect, old operations/sessions must retire. If that fails, report redacted status and reproduction steps. Revoke compromised credentials at the provider; a local disconnect alone is not remote revocation. Review [privacy](privacy.md) before enabling indexing or a remote transcription route.

## Development setup and checks

- Check `node --version` is `v24.x` and `pnpm --version` is `11.25.0`. A shell wrapper may invoke a different Node than your interactive shell; inspect the executable path when an engine warning disagrees with `node --version`.
- Use `pnpm install --frozen-lockfile`. If it reports a lock mismatch, investigate the manifest/lockfile change; do not regenerate the lockfile to hide it.
- If formatting fails, use `pnpm exec prettier --write` with only the files you changed, then `pnpm format:check`. Avoid formatting unrelated files.
- Direct `pnpm test:browser` requires both current production builds. `pnpm test:ui` verifies/rebuilds them automatically; see [focused checks](development.md#one-edit-one-focused-check).
- Google Chrome is the native acceptance channel. Generic Playwright Chromium/WebKit cannot establish Chrome/Safari codec evidence. Native Safari additionally requires remote automation enabled on macOS.
- An occupied test port or output directory needs an isolated run, not killing an unrelated process. Follow [run isolation](development.md#isolate-runs-and-resume-from-evidence).
- Read retained traces/screenshots and the failing assertion before retrying. Keep artifacts local if they may contain private data. See [validation](validation.md) for gate-specific requirements.

Use [SUPPORT.md](../SUPPORT.md) for reporting. Include exact commands, revision, browser/base path and redacted observed errors. Distinguish a local failure from a deployed defect and author checks from independent review.
