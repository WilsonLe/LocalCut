# Sound effects

Open **Media → Sound effects**, search by name, tag or creator, and choose a category. Preview a row with its Play button; the volume control changes preview loudness only. Adding a sound opens the ordinary Media import result. Drag that imported asset onto an audio track to use it in an edit. Imports do not automatically place clips or change their gain.

See the [desktop](images/sound-effects-library.png) and [narrow-screen](images/sound-effects-library-mobile.png) library views.

The initial collection contains **281 distinct sounds across nine categories**, prepared from nine CC0 source collections. Files are served with LocalCut and fetched only when requested. No account, external sound service or API key is needed. CC0 does not require credits in a finished video; each row still links to its source. The complete [source lock](../scripts/sound-library.lock.json), [catalogue](../public/sounds/catalog.json), [measurements](../public/sounds/measurements.json) and [third-party notices](../THIRD_PARTY_NOTICES.md#bundled-sound-effects) retain provenance.

## Catalogue and interaction contract

The Media action loads its dialog and catalogue on demand. Opening, searching and previewing do not create a project or import audio. One preview plays at a time. Changing the search, category or page stops it. Closing, navigating to another project/route or entering a historical read-only view retires the dialog, stops playback, revokes its object URL and aborts unpublished downloads. Historical views expose no sound-library import action.

The catalogue's schema, category list and search live in `src/core/sound-library.ts`. The workspace loader validates that schema and verifies each requested file's byte count and SHA-256 before preview or import. A mismatch makes one HTTP revalidation attempt, then offers an actionable failure. Only checksum-derived local audio paths are constructed; creator links must use HTTPS. A failed catalogue can be retried. Failed sound requests can be retried through the same row.

The dialog retains at most one prepared file for preview/import reuse. Imported originals, deduplication, folder placement, job progress, project identity and retention stay with the existing shared media importer/editor. Once submitted, those durable jobs keep their existing completion semantics. A late download cannot import into a newly viewed project. Imports from a folder target the folder captured when opening the sound browser; imports from Trash target the Media root. No project schema, public editor API or derived-computation cache is added.

This is a bundled collection, not a service-worker offline feature. Loading the app/catalogue or a previously unfetched sound still requires the hosting origin; see [browser and offline limits](browser-support.md#storage-backups-and-offline-use). After import, sounds are ordinary local assets and can be included in backups with originals.

## Initial research and source decisions — 13 November 2026

The research compared original pack pages, included licence files, publisher restrictions and individual recording descriptions. Searches covered CC0 creators, stock libraries, field recordings, transition effects and library classification. This is a bounded source and implementation review, not an exhaustive survey or independent legal clearance of every contributor's ownership. Selection criteria were permission to redistribute reusable files, traceable acquisition, useful editing coverage, native decoding and a practical static-download size.

### Sources included

| Original source                                                                | Included sounds | Contribution and evidence                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------ | --------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds)           |              57 | Clicks, confirmations, errors and movement cues. The creator page and archive licence declare CC0.                                                                                                                                                                                                               |
| [Kenney UI Audio](https://kenney.nl/assets/ui-audio)                           |              11 | A small additional set of click, rollover and switch variations, under its included CC0 licence.                                                                                                                                                                                                                 |
| [Kenney Impact Sounds](https://kenney.nl/assets/impact-sounds)                 |              77 | Material impacts and footsteps on carpet, concrete, grass, snow and wood. The source page and archive licence declare CC0.                                                                                                                                                                                       |
| [Kenney RPG Audio](https://kenney.nl/assets/rpg-audio)                         |              42 | Books/pages, clothing, doors, coins, latches and other object Foley; its archive retains the creator's CC0 notice.                                                                                                                                                                                               |
| [Kenney Digital Audio](https://kenney.nl/assets/digital-audio)                 |              37 | Tonal sweeps, power-ups, zaps and retro effects with an included CC0 licence.                                                                                                                                                                                                                                    |
| [Kenney Sci-fi Sounds](https://kenney.nl/assets/sci-fi-sounds)                 |              49 | Engines, computer noise, doors, lasers, force fields and explosions with an included CC0 licence.                                                                                                                                                                                                                |
| [LEGIT Audio: The Shop free samples](https://opengameart.org/content/the-shop) |               2 | Recorded fridge/interior drones. The author's CC0 statement explicitly covers these free OpenGameArt samples; it does not extend to the paid full collection.                                                                                                                                                    |
| [Thimras: Park ambiences](https://opengameart.org/content/park-ambiences)      |               3 | Birds, river and wind recorded in an Adelaide public park. The individual author page declares CC0 and describes the recording provenance. LocalCut includes the first 20 seconds of each original.                                                                                                              |
| [Woven SFX whooshes](https://github.com/woven-video/woven-sfx)                 |               3 | Deep, fast and large swish transitions. The repository's separate [sound licence](https://github.com/woven-video/woven-sfx/blob/main/SOUNDS_LICENSE) declares CC0; downloads are pinned to an immutable commit in the lock. The CDN refused direct retrieval, so the same publisher's repository WAVs were used. |

The six Kenney archives contain 467 audio members after excluding preview/demo files. Selecting at most three numbered variants per named family keeps useful variety while avoiding pages of near-identical controls. Exact duplicate input hashes were excluded. The resulting 281 WAVs also have 281 distinct output hashes. Names and tags follow creator labels and documented recording subjects; they are not claims that a model or human identified every sound by listening.

### Alternatives and exclusions

| Source or licence               | Decision for this bundled library                                                                                                                                                                                               | Evidence                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| CC0                             | Eligible when the actual source declaration and provenance are credible. Redistribution and commercial use are permitted; privacy, trademark and other rights still require attention where relevant.                           | [Creative Commons CC0 deed and legal-code link](https://creativecommons.org/publicdomain/zero/1.0/) |
| Freesound                       | A useful future source, but licensing is per sound. CC0 candidates can qualify; attribution and noncommercial items cannot be treated as interchangeable. No bulk Freesound content was bundled.                                | [Freesound licence FAQ](https://freesound.org/help/faq/#licenses)                                   |
| Pixabay                         | Excluded from redistribution as an unchanged reusable stock collection. Use in a larger finished video is a different permission.                                                                                               | [Content licence summary](https://pixabay.com/service/license-summary/)                             |
| Mixkit                          | Excluded: its sound licence prohibits redistribution as stock, in a tool/template or with source files.                                                                                                                         | [Sound Effects Free License](https://mixkit.co/license/modal/sfxFree/)                              |
| Sonniss GDC bundle              | Excluded: the current bundle licence permits synchronization in projects but distinguishes that from supplying the sound effects themselves through files or services.                                                          | [GDC bundle licence, version 2.0](https://sonniss.com/gdc-bundle-license/)                          |
| ZapSplat standard library       | Excluded: its current terms prohibit sharing/redistributing the sound library, including in apps. Paying for attribution-free use does not itself grant redistribution.                                                         | [Standard licence](https://www.zapsplat.com/license-type/standard-license/)                         |
| 99Sounds                        | Excluded: personal/commercial production use does not grant redistribution of the standalone audio files, even for free.                                                                                                        | [99Sounds licence](https://99sounds.org/license/)                                                   |
| OpenGameArt “rain and thunders” | Excluded despite the CC0 label: the uploader's comments disclose use of commercial sound-library plugins for thunder, leaving upstream redistribution rights unresolved. This is an uncertainty, not a finding of infringement. | [Original upload and creator's comment](https://opengameart.org/content/rain-and-thunders)          |
| Collection pages labelled “CC0” | Discovery only. The individual creator/file declaration must be checked; a curator's collection title is insufficient evidence.                                                                                                 | [Example collection](https://opengameart.org/content/airos-cc0-ambience-and-background-sfx)         |

Publisher licences were inspected on the date above; later additions need fresh source checks. “Free”, “royalty-free” and “usable in commercial videos” do not establish permission to supply reusable files to other editors. CC0 declarations are author statements, not independent proof of ownership or a guarantee against erroneous platform claims. The source links and hashes provide evidence for review; they do not make the collection exclusive or certify all possible uses.

### Organization and sound treatment

The reviewed snapshot provides 32 transitions, 53 interface sounds, 68 impacts, 17 footsteps, 39 Foley sounds, 23 digital effects, 44 sci-fi sounds, two room tones and three nature excerpts. These are broad editor-facing groups, with searchable material/action synonyms. The [Universal Category System](https://universalcategorysystem.com/) informed the value of consistent source/category naming; this small catalogue does not claim full UCS classification or compliance.

All outputs are 48 kHz, 16-bit PCM WAV, retaining mono/stereo channel counts. Kenney's compressed Ogg originals remain identified in the lock; WAV conversion improves import consistency, not the fidelity of the original recording. The recipe resamples, reduces gain only where necessary to keep sample peaks at or below −1 dBFS, then quantizes to 16-bit PCM. Quiet sources are not boosted, and no blanket LUFS normalization, denoising, compression, spatial widening or pitch changes are applied. Different effects still need scene-specific mix levels.

Sources longer than 20 seconds become explicit first-20-second excerpts with 20 ms edge fades. Short effects keep their full source duration and existing attack/tail. No source is certified as a seamless loop. Measured output sample peaks range from −28.37775 to −1.00015 dBFS; these are sample peaks, not true-peak or broadcast-loudness measurements. The audio total is 47,106,284 bytes (44.9 MiB), with a checked 60 MiB ceiling.

Every candidate was decoded and measured by the recorded FFmpeg toolchain. The preparation rejects missing, non-finite, silent or unsupported-channel output. Build checks inspect every actual PCM WAV, source selection, notice, checksum, duration and size in both hosting outputs. Measurements do not establish subjective quality, clean natural transients, mono compatibility or the absence of upstream recording damage. No comprehensive listening approval is claimed; native browser playback and editing acceptance are separate evidence.

### Coverage limits

This first collection emphasizes practical short cues and reusable creator packs. It has limited real-world ambience, cinematic sound design, crowd/vehicle/animal coverage and no dialogue/voice library. Those gaps should be filled from individually reviewed original recordings or commissioned material, without relabelling restricted stock as CC0. Expanding attribution-based sources would also require a clear credit workflow for exported projects.

## Reproduce and verify

Use the [source lock](../scripts/sound-library.lock.json) to acquire its exact originals into an ignored local folder. Kenney downloads use the creator's normal pack download; the lock stores the stable page rather than an expiring signed URL. For archives, retain the archive filename and checksum. The preparation performs no network access and refuses mismatched originals, members or recipe/tool versions.

```sh
python3 scripts/prepare-sounds.py --sources .cache/sound-originals --output .cache/sounds-rebuilt
node scripts/check-sounds.mjs .cache/sounds-rebuilt
```

Use the recorded FFmpeg version for byte-for-byte output. Compare file hashes and parsed catalogue content with `public/sounds/`; JSON whitespace is presentation only. Do not overwrite the shipped collection with an unreviewed rebuild. New sounds require refreshed rights review, the lock/recipe hash, notices, measurements, the generated catalogue/WAVs and affected documentation together.

```sh
pnpm test tests/unit/sound-library.test.ts tests/unit/media-import.test.ts
node --test tests/tooling/build-state.test.mjs
pnpm test:ui --grep 'sound library'
```

The last command verifies/reuses both production builds and runs the focused native Chrome journeys. Builds validate source assets without external downloads; bundle checks validate packaged files at `/` and `/LocalCut/`. Source, lock and preparation/checker changes invalidate verified-build reuse. See [development gates](development.md#expand-verification-at-the-boundary) for the remaining static and draft handoff requirements.
