# LocalCut skills for external agents

LocalCut provides self-contained editing instructions through browser site tools and portable Agent Skills folders. Users need no Agentic Workflows installation, LocalCut AI account or plugin. The connected agent chooses which instructions to read and follow; skills do not add execution capabilities.

## Read through WebMCP

Open LocalCut in a compatible agent browser and discover its site tools. Call `localcut_skills` with `{"action":"list"}`, then `{"action":"get","name":"localcut-start"}`. Load only other workflows relevant to the request.

Listing returns names, descriptions, SHA-256 digests and Markdown/license URLs. Getting returns the full published `SKILL.md` in `content`. No project needs to be open. The tool stays available on Projects, historical views and across project navigation, until the app lifetime ends.

Registration fetches no guidance and initializes no editor, editing storage, worker or model. Listing reads the small same-origin index; getting fetches only the chosen Markdown and checks its exact bytes against the index digest. Unavailable files produce retry/reconnect guidance; mismatched files must be reloaded rather than followed. These are static-asset reads, not provider/model requests. Existing [WebMCP ownership](webmcp.md) still applies.

## Available workflows

| Skill                                                                       | Purpose                                                                   |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [Start](../public/skills/localcut-start/SKILL.md)                           | Discovery, setup, imports, revisions and jobs                             |
| [Asset clips](../public/skills/localcut-asset-clips/SKILL.md)               | Source ranges, previews, context/transcripts and conflict recovery        |
| [Video editing](../public/skills/localcut-video-editing/SKILL.md)           | Source inspection, continuity and one timeline                            |
| [Reference analysis](../public/skills/localcut-reference-analysis/SKILL.md) | Observed pacing, composition and sound translated into original decisions |
| [Storyboards](../public/skills/localcut-storyboards/SKILL.md)               | Visual beats, drawing and artwork export/reuse                            |
| [Audio editing](../public/skills/localcut-audio-editing/SKILL.md)           | Treatment, mixing, sync and listening evidence                            |
| [Motion design](../public/skills/localcut-motion-design/SKILL.md)           | Animation, masks, compositing and visual review                           |
| [Typography](../public/skills/localcut-typography/SKILL.md)                 | Real bundled font IDs, glyph coverage and readability                     |
| [Captions](../public/skills/localcut-captions/SKILL.md)                     | Explicit local Whisper preparation, speech uncertainty and timing         |
| [Narration](../public/skills/localcut-narration/SKILL.md)                   | Recorded/imported takes, pronunciation and measured timing                |
| [Music](../public/skills/localcut-music/SKILL.md)                           | Original instrumental synthesis or imported music on the edit clock       |
| [Image preparation](../public/skills/localcut-image-preparation/SKILL.md)   | Image selection, truthful details and source preservation                 |
| [Export review](../public/skills/localcut-export-review/SKILL.md)           | Actual candidate review, backups and durable delivery                     |

Speech synthesis, generative image editing, advanced DAW/metering, remote video retrieval and singing require a suitable separately available host capability and authority for its effects. They are optional. The music skill can use the existing network-disabled project JavaScript workspace for local instrumental WAV generation without assuming Python, FFmpeg or provider access in that sandbox. Skills do not restore the removed assistant/provider features.

## Portable files and publication

Canonical files live at `public/skills/<name>/SKILL.md`. Both static builds publish them verbatim at `<deployment-base>skills/<name>/SKILL.md`, alongside a `LICENSE.txt` per folder and generated `skills/index.json`. Pages uses `/LocalCut/`; root builds use `/`. URLs become available when that candidate is deployed.

Copy/download the whole skill folder, including its license, into your agent host's configured skills directory, or give its Markdown URL to an agent that can read it. Installation and automatic selection depend on the host. Each shipped skill also requires task-facing product copy and rejects storage/implementation/workflow metatext in rendered UI or authored titles; source transcripts remain unchanged unless correction is requested. Every folder contains all required workflow guidance, with no private source paths, absent helpers or plugin dependencies. Related LocalCut skills can be discovered through the same index.

After editing Markdown/frontmatter, regenerate and verify metadata:

```sh
node scripts/skills-index.mjs --write
node scripts/skills-index.mjs
```

The generator derives names/descriptions/hashes and checks folder identity and license attribution. Tooling regressions reject stale/incomplete metadata. Bundle checks compare both published catalogs/files with source. Public assets already participate in verified-build fingerprints; no separate runtime copy of the guidance is maintained.

## Adaptation and provenance

The inspected source was MIT-licensed Agentic Workflows `0.2.0+codex.20261018000000`, copyright 2026 Wilson Le. Every distributed folder retains the full license and names its source areas in its Markdown footer. Unsupported runtime assumptions were adapted deliberately.

| Source inspected                                                                      | Inclusion decision                                                                                             |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Suite capability map/discovery                                                        | Small metadata first, selected instructions on demand; no installation prerequisite                            |
| Video Editing, assets/timing, reference study, compositing, storyboard template       | Editorial, reference, storyboard and delivery skills on LocalCut's existing clock                              |
| Audio Editing and restoration/mixing                                                  | Native treatment, explicit optional metering/DAW limits                                                        |
| Motion Design                                                                         | Native animation and render review; no HyperFrames/FFmpeg runtime dependency                                   |
| Typography and font/layout reference                                                  | Existing bundled IDs and rendered checks; no font installer                                                    |
| Speech-to-Text                                                                        | Local Whisper/source timing; no OpenRouter/cloud route                                                         |
| Text-to-Speech                                                                        | Narration asset/timing workflow; synthesis remains optional and external                                       |
| Music Composition                                                                     | Composition/cue/listening guidance; synthesis adapted to JavaScript sandbox                                    |
| Food Image Editing                                                                    | Inspection and truthfulness generalized to image preparation; generation external                              |
| Engineering, account operations, research, budgeting, marketing and product workflows | Excluded from editing skills because they do not operate LocalCut editing tasks                                |
| YouTube inspection/download/sync workflow descriptions                                | No bundled downloader/cookie tools; reference guidance can use an agent host's authorized retrieval capability |

File/package checks do not prove agents will select or obey a skill. Production Chrome uses a controlled WebMCP harness for discovery, parity and lifetime checks; native browser discovery retains its separate availability limits. No universal agent interoperability or model-quality result is claimed.
