# Feature coverage

Coverage follows the current [editing inventory](../ai.md#editing-feature-access-inventory)
and [public API](../api.md). The 15-second limit requires grouped headings and
simultaneous controls. Catalog variants and scalar parameters are represented
by their families rather than receiving separate demonstrations.

| Requested family                  | Film evidence                                                                                                         | Existing owner                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Media                             | Actual library and timeline; video, audio, images, text/captions; drag/drop, screen capture, speech generation labels | `MediaLibrary.tsx`, `assets.import`, capture and speech services                                       |
| Indexing                          | Actual saved scene/evidence dialog; observed tags and summary are a labeled AI demo                                   | `AssetIndexControls.tsx`, `assets.analyze`, `createAssetIndexer`, retained asset indexes               |
| Chat UIs                          | Actual conversation title, messages and export icon; retained sessions, context/skills, edit/export tools             | `Conversation.tsx`, shared requested-mode assistant executor                                           |
| Color and LUTs                    | Actual preset, `.cube` import and strength controls; illustrative grade wipe                                          | `ClipEffectFields.tsx`, shared color catalogs/LUT processor                                            |
| Compositing                       | Actual blending selector; ten-mode family label; actual key color/tolerance/softness/spill controls                   | `ClipEffectFields.tsx`, shared blend/chroma processor                                                  |
| Masks and tracking                | Actual shape, geometry, feather, inversion, motion points and Track mask controls; illustrative translated mask       | `ClipEffectFields.tsx`, local `track_mask` service                                                     |
| Geometry, filters and animation   | Keyframes, transform/crop/opacity/filter/blur labels; mask motion                                                     | `KeyframeEditor.tsx`, clip schema and timing; all 12 scalar keyframe parameters remain a single family |
| Transitions                       | Crossfades, slides, zooms, black and blur-dissolve labels                                                             | Shared transition recipes and `applyTransitionTemplate`                                                |
| Styled/animated text and captions | Styled + animated text, captions/local transcription labels                                                           | Text library/font/animation catalogs, caption/transcription services                                   |
| Timeline structure                | Actual layered timeline and separated audio; groups, ripple, storyboard labels                                        | Canonical track/group/ripple commands and storyboard owner                                             |
| Audio effects                     | Actual mute, stereo balance, fades, three-band EQ, noise reduction and noise floor controls; gain label               | `ClipEffectFields.tsx`, shared audio processor                                                         |
| Time and pitch                    | Speed/keep-pitch labels and illustrative curve; curve/linear/staircase speed ramp families                            | `SpeedRampEditor.tsx`, `setSpeed`, `setSpeedRamp`, shared WSOLA pitch preservation                     |
| Source and phrase editing         | Separate audio, multitrack, trim/split/loop/phrase-edits labels                                                       | `separateAudio`, source-range commands and generated-speech transcript phrase editor                   |

This artifact changes no editing capability. It does not replace runtime codec,
transcription, tracking or provider evidence. AI scenes are local simulations,
and motion graphic results are illustrative, as explained in the [README](README.md#provenance).
