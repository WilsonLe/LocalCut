# Third-party notices

Dependencies retain their upstream licenses in installed packages. Copies for the design/engine stack and the pinned model card are shipped in public/notices/. LocalCut's generated artifacts include bundled third-party code; preserve this notice with distributions.

- React: Meta Platforms and contributors, MIT.
- Tailwind CSS: Tailwind Labs, MIT.
- shadcn/ui and Base UI: upstream contributors, MIT.
- Zod: upstream contributors, MIT.
- idb: Jake Archibald and contributors, ISC.
- Mediabunny: Vanilagy and contributors, MPL-2.0.
- Transformers.js: Hugging Face and contributors, Apache-2.0.
- ONNX Runtime: Microsoft and contributors, MIT.
- Whisper: OpenAI and contributors, MIT. The pinned Xenova/whisper-tiny model conversion declares Apache-2.0 in its model card. Model card: https://huggingface.co/Xenova/whisper-tiny. Pinned revision: 5332fcc35e32a33b86612b9a57a89be7906102b1.
- cn, class-variance-authority, lucide-react, tw-animate-css: upstream package notices/licenses.
- react-markdown, remark-gfm and their Markdown-processing dependencies: MIT and related upstream licenses, preserved in `public/notices/markdown-LICENSES.txt`.

## Speech test fixture

tests/fixtures/jfk.wav contains a short excerpt of President John F. Kennedy's January 20, 1961 inaugural address. Federal-government speech is public domain in the United States. Source recording is distributed in whisper.cpp's test samples under its MIT repository license; this file is used solely for tests and not deployed.

Source: https://github.com/ggml-org/whisper.cpp/blob/master/samples/jfk.wav
Transcript/context: https://www.jfklibrary.org/archives/other-resources/john-f-kennedy-speeches/inaugural-address-19610120
SHA-256: 59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e

Generated color, gradient, and sinusoidal fixtures are created by LocalCut's tests and have no external media dependencies.

## Bundled authored-text fonts

The font catalog is generated from the pinned Fontsource Google Fonts metadata revision `77f00efe046239b4bff0c1b5569ae67813401315` (https://github.com/fontsource/google-font-metadata). Each family retains its copyright and complete license in `public/fonts/<id>/LICENSE.txt`. SIL OFL 1.1, Apache 2.0 and Ubuntu Font License 1.0 texts also appear in `public/notices/fonts/`. Original, unmodified upright WOFF2 subsets are locally served; each family's manifest records immutable upstream URLs and SHA-256 hashes. `public/fonts/catalog-lock.json` records source hashes, families and exclusions (missing verified licenses or upright faces).

Maintainers may regenerate the snapshot with `node scripts/import-fonts.mjs`; this explicit operation fetches pinned upstream metadata and reuses existing local font bytes. Builds and application startup never invoke the importer or contact a third-party font host. Catalog fonts belong to authored video text, separately from system fonts used by the application interface.
