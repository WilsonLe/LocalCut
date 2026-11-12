# Production browser journeys

## Avoid duplicate work

Normal acceptance exercises each repeated scenario once at `/LocalCut/`, while both production builds are still required. Use `behaviorBases` from [coverage-bases.ts](../tests/browser/coverage-bases.ts). `LOCALCUT_TEST_BASES=both` is diagnostic only. Retain distinct fixture, viewport, theme and failure variants as named cases.

Normal Chrome shares one installed stable Chrome process with isolated contexts and namespaces. Separate native/performance browsers retain their stronger resource reservation. Combine compatible phases with `test.step`, but keep unrelated storage/permission/failure fixtures isolated. Never run builds while their output is consumed by browser checks.

## Current journey inventory

| Behavior                                                             | Production coverage                                                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Agent removal, inert startup and retired credential/settings cleanup | [Removal](../tests/browser/workspace-agent-removal.spec.ts)                                                                    |
| Media width, editor geometry, reload and cross-tab preferences       | [Resizable panels](../tests/browser/workspace-resizable.spec.ts)                                                               |
| Manual editing, imports, previews, speed and native export           | [Workspace](../tests/browser/workspace.spec.ts), [editor](../tests/browser/editor.spec.ts)                                     |
| Navigation, project restoration and route recovery                   | [Routing](../tests/browser/workspace-routing.spec.ts), [projects](../tests/browser/workspace-projects.spec.ts)                 |
| Mobile controls, media tabs and focus                                | [Mobile](../tests/browser/workspace-mobile.spec.ts)                                                                            |
| Appearance, catalog fonts and saved display choices                  | [Appearance](../tests/browser/workspace-appearance.spec.ts)                                                                    |
| Media folders and immutable source retention                         | [Folders](../tests/browser/media-folders.spec.ts)                                                                              |
| Commands and shared dialog lifecycle                                 | [Commands](../tests/browser/workspace-commands.spec.ts), [dialogs](../tests/browser/workspace-dialog-loading.spec.ts)          |
| Transfer and legacy backups                                          | [Transfer](../tests/browser/workspace-transfer.spec.ts)                                                                        |
| Local coding, native audio output and cancellation                   | [Coding](../tests/browser/coding.spec.ts)                                                                                      |
| Storyboard formats, image/video-still pixels and backup remapping    | [Export](../tests/browser/workspace-storyboard-export.spec.ts), [images](../tests/browser/workspace-storyboard-images.spec.ts) |
| Local deterministic analysis, evidence and recovery                  | [Asset analysis](../tests/browser/asset-index.spec.ts)                                                                         |
| Native worker, decoder and engine lifetimes                          | [Lifecycle](../tests/browser/lifecycle.spec.ts)                                                                                |
| Bundled sound search, preview/import/export, reload and cancellation | [Sound library](../tests/browser/workspace-sound-library.spec.ts)                                                              |
| Retired speech cache and saved transcript compatibility              | [Editor](../tests/browser/editor.spec.ts), [recovery](../tests/browser/recovery.spec.ts); external agents supply STT/TTS       |
| Long native export                                                   | [Performance](../tests/browser/performance.spec.ts), separate acceptance project                                               |

Chat, remote-provider and agent-action journeys were removed with their product owners. Historic evidence remains revision-bound in [validation](validation.md). Focused UI runs use `pnpm test:ui --grep '<title>'`; direct browser runs require current builds and can validate selection with `--list`. See [development stages](development.md#expand-verification-at-the-boundary).
