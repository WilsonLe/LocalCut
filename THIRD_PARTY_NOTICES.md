# Third-party notices

Dependencies retain their upstream licenses in installed packages. Copies for the design/engine stack are shipped in public/notices/. LocalCut's generated artifacts include bundled third-party code; preserve this notice with distributions.

- React: Meta Platforms and contributors, MIT.
- Tailwind CSS: Tailwind Labs, MIT.
- shadcn/ui and Base UI: upstream contributors, MIT.
- Zod: upstream contributors, MIT.
- idb: Jake Archibald and contributors, ISC.
- Mediabunny: Vanilagy and contributors, MPL-2.0.
- cn, class-variance-authority, lucide-react, tw-animate-css: upstream package notices/licenses.

## Bundled sound effects

`public/sounds/` contains a curated CC0 1.0 sound collection from Kenney, Juhani Junkala (SubspaceAudio), LEGIT Audio's free OpenGameArt samples, Thimras's Park ambiences and Woven SFX. Audio retains its original CC0 dedication; it is not relicensed as LocalCut's MIT code. Optional creator credits and source links remain available in the library.

See [sound effects research and source decisions](docs/sound-effects.md), the [source/member SHA-256 lock](scripts/sound-library.lock.json), the [output catalogue](public/sounds/catalog.json) and individual notices under `public/sounds/licenses/`. The lock records exact originals and Woven's immutable repository commit. The preparation produces 48 kHz PCM WAV, preserving source identity and recording gain/excerpt transformations in `public/sounds/measurements.json`. Original Ogg sources are lossy; conversion does not restore missing fidelity. The paid LEGIT Audio collection and restricted commercial stock are not included.

CC0 terms: https://creativecommons.org/publicdomain/zero/1.0/

## Speech test fixture

tests/fixtures/jfk.wav contains a short excerpt of President John F. Kennedy's January 20, 1961 inaugural address. Federal-government speech is public domain in the United States. Source recording is distributed in whisper.cpp's test samples under its MIT repository license; this file is used solely for tests and not deployed.

Source: https://github.com/ggml-org/whisper.cpp/blob/master/samples/jfk.wav
Transcript/context: https://www.jfklibrary.org/archives/other-resources/john-f-kennedy-speeches/inaugural-address-19610120
SHA-256: 59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e

Generated color, gradient, and sinusoidal fixtures are created by LocalCut's tests and have no external media dependencies.

## Bundled authored-text fonts

The font catalog is generated from the pinned Fontsource Google Fonts metadata revision `77f00efe046239b4bff0c1b5569ae67813401315` (https://github.com/fontsource/google-font-metadata). Each family retains its copyright and complete license in `public/fonts/<id>/LICENSE.txt`. SIL OFL 1.1, Apache 2.0 and Ubuntu Font License 1.0 texts also appear in `public/notices/fonts/`. Original, unmodified upright WOFF2 subsets are locally served; each family's manifest records immutable upstream URLs and SHA-256 hashes. `public/fonts/catalog-lock.json` records source hashes, families and exclusions (missing verified licenses or upright faces).

Maintainers may regenerate the snapshot with `node scripts/import-fonts.mjs`; this explicit operation fetches pinned upstream metadata and reuses existing local font bytes. Builds and application startup never invoke the importer or contact a third-party font host. Catalog fonts belong to authored video text, separately from system fonts used by the application interface.

## Excalidraw Storyboard

The embedded diagram uses pinned `@excalidraw/excalidraw` 0.18.1 (MIT) and its transitive dependencies. Drawing fonts are served locally from that package's distributed assets, with [font notices](public/storyboard/FONT-NOTICES.txt); their upstream licensing remains available in [Excalidraw's font sources](https://github.com/excalidraw/excalidraw/tree/v0.18.1/packages/excalidraw/fonts). The diagram uses Excalidraw's bundled font families independently from the authored-video text catalog.

The build adapter in `scripts/storyboard-assets.ts` redirects the pinned vendor's automatic CDN font fallback to the same local assets. It verifies the expected source pattern and fails if a dependency update changes it; third-party licensing is retained.

## Embedded photo metadata

ExifReader 4.46.0, Mattias Wallander and contributors, MPL-2.0. Used locally for EXIF dates and GPS; source: https://github.com/mattiasw/ExifReader/tree/v4.46.0. Its unmodified package retains upstream licensing; the shipped [license](public/notices/exifreader-LICENSE) accompanies distributions.

## Browser coding runtime

just-bash 3.6.0 (Vercel and contributors, Apache-2.0) supplies the browser shell; quickjs-emscripten-core and @jitl/quickjs-singlefile-browser-release-sync 0.32.0 (Jake Teton-Landis and contributors, MIT) embed QuickJS (Fabrice Bellard and Charlie Gordon, MIT). The runtime and its browser-bundled dependencies retain their notices in [coding licenses](public/notices/coding-LICENSES.txt). Native optional compression modules are not used or built. Sources: https://github.com/vercel-labs/just-bash and https://github.com/justjake/quickjs-emscripten.

## Agent workflow guidance

The portable [LocalCut skills](docs/skills.md) adapt editing guidance from Agentic Workflows `0.2.0+codex.20261018000000` (MIT), copyright (c) 2026 Wilson Le. Each shipped `public/skills/localcut-*/` folder includes the complete upstream MIT license as `LICENSE.txt`; the Markdown footer identifies source areas. The same files are served through WebMCP. See [adaptation decisions](docs/skills.md#adaptation-and-provenance) for included/excluded workflows and capability limits. No upstream binaries, provider setup or external helper dependencies are included.
