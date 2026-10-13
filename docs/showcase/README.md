# LocalCut — Every part of your story

An editable 15-second feature showcase: 1920 × 1080, 60 fps, H.264/AAC stereo.
It follows LocalCut's scissors mark from `public/icons/favicon.svg`, its
`#171717` / `#fafafa` monochrome design and system typography. Original landscape
artwork supplies the media accent. The user's requested media, indexing, chat,
advanced video and audio groups all stay within the same 15 seconds.

## Direction and timing

`timeline.json` owns both `motion.js` and `compose.py` timing. At 128 BPM, eight
bars span exactly 15 seconds. Beat-aligned cuts and parallel panels make room for
feature families; this is a rapid showcase, not an individual-control tutorial.

| Time             | Visual                                                     |
| ---------------- | ---------------------------------------------------------- |
| 0–0.9375 s       | Scissors mark and “Every part of your story”               |
| 0.9375–2.8125 s  | Actual media library/timeline plus original media cards    |
| 2.8125–4.6875 s  | Actual saved index dialog, scene evidence and tags         |
| 4.6875–6.5625 s  | Actual retained editing chat and a demo response           |
| 6.5625–8.4375 s  | Color/LUT, blending and chroma key control close-ups       |
| 8.4375–10.3125 s | Mask/tracking controls and motion/text/transition groups   |
| 10.3125–13.125 s | Audio effects controls, waveform, EQ and speed ramp motifs |
| 13.125–15 s      | Brand lockup, feature families and project URL             |

See [feature coverage](coverage.md) for the mapping to current editing owners.

## Provenance

The UI images are actual isolated stable Chrome captures of the editor at base
`77280707375e22b3d35266d0ac7fdf2fac9c2635`, using the development entry and only
original task-owned media. `capture.mjs` creates a project through the editor
facade, separates its video audio through the canonical command, opens actual
property controls and captures them. Some settings shown are uncommitted form
values. These are showcase captures, not production-entry acceptance evidence.

The index scan/evidence and saved-result dialog run locally. Model observations,
chat naming and the chat reply are synthetic, intercepted locally before any
OpenRouter request reaches the network. The index/chat scenes visibly say
**AI DEMO**. The reply describes possible edits; it does not claim committed edits.
No real credentials, paid AI requests, existing browser profiles or private
projects are used.

Color wipes, the moving mask, EQ sliders, waveform and ramp are illustrative
motion graphics. They demonstrate the feature concept; they are not recorded
native effect/tracking output or an audio before/after comparison.

The original score uses warm synth chords, a developing plucked motif, bass,
kick, hats, reverse-air cuts and a resolved ending. No third-party samples,
remote music generation or paid services were used.

## Reproduce

Use Node 22+, Python 3.11+ and FFmpeg/ffprobe on PATH. Rendering dependencies are
pinned and isolated from the application's package and lockfile.

From the repository root:

```sh
npm ci --prefix docs/showcase
python3 -m venv .artifacts/brand-showcase-venv
.artifacts/brand-showcase-venv/bin/pip install -r docs/showcase/requirements.txt
HYPERFRAMES_NO_TELEMETRY=1 node docs/showcase/node_modules/hyperframes/bin/hyperframes.mjs check docs/showcase
.artifacts/brand-showcase-venv/bin/python docs/showcase/render.py --output .artifacts/brand-showcase/expanded
```

The renderer writes the MP4, picture-only intermediate, WAV and decoded media
report into the ignored output folder. For binaries outside PATH, pass
`--ffmpeg /absolute/path/ffmpeg --ffprobe /absolute/path/ffprobe`. Choose a fresh
output folder for each candidate; `--overwrite` explicitly replaces an existing
task-owned final.

Preview the editable composition with HyperFrames `preview docs/showcase`.
The composition itself has no audio element: preview the delivered MP4 to hear
its score. Edit HTML/CSS/JS and the synthesis program, keeping timing changes in
`timeline.json`, then render again.

Artwork can be regenerated with `artwork.py` using the same Python environment.
To recapture the actual editor, install the repository's pinned dependencies,
start `pnpm dev --port 4196 --strictPort`, then generate the owned sample video
and run the capture:

```sh
.artifacts/brand-showcase-venv/bin/python docs/showcase/compose.py --output .artifacts/brand-showcase/sample-score.wav
ffmpeg -y -loop 1 -i docs/showcase/assets/landscape-1.jpg -i .artifacts/brand-showcase/sample-score.wav -t 15 -vf scale=1280:720 -r 30 -c:v libx264 -pix_fmt yuv420p -c:a aac .artifacts/brand-showcase/sample.mp4
node docs/showcase/capture.mjs http://127.0.0.1:4196/LocalCut/ .artifacts/brand-showcase/sample.mp4
```

The script uses a fresh Chrome context and local provider interception. Closing
that context retires its isolated storage. Recapture needs the application
checkout; the ZIP includes the captured assets so rendering alone does not.

## Verification boundaries

Use the decoded final MP4 for frame count, duration, audio and visual review.
HyperFrames checks alone do not prove encoded quality. Inspect readable holds
and boundary frames, and seek A/B/A in the same Chrome session to verify that
animation state does not depend on history.

Author checks cover the expanded candidate's 900 decoded frames, exact duration,
1080p/60 format, AAC stereo, decoded audio levels, frame/transition inspection,
zero runtime/layout errors and deterministic seeks. Subjective listening and
continuous human playback have not been observed in this environment.
Application runtime behavior is unchanged; native export, transcription and
performance suites are outside this artifact's validation scope.

The first candidate received one independent draft-PR review at
`f3ad534073a5526649fa2b0c527aa49f1c09938d`. Its no-finding result is historical;
it does not review this expanded candidate. No merge, release or publication is
included.
