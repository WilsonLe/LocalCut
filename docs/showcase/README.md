# LocalCut — Make the cut

An editable 15-second introduction: 1920 × 1080, 60 fps, H.264/AAC stereo.
The film uses LocalCut's scissors mark from `public/icons/favicon.svg`, its
`#171717` / `#fafafa` monochrome design, system typography and the actual editor.
Warm original landscape artwork supplies the media accent.

## Direction and timing

`timeline.json` is the timing owner for both `motion.js` and `compose.py`.
At 128 BPM, eight bars span exactly 15 seconds.

| Time           | Visual                                               |
| -------------- | ---------------------------------------------------- |
| 0–1.875 s      | Your footage; a scissors sweep cuts across the frame |
| 1.875–3.75 s   | Your rhythm; three original landscape panels         |
| 3.75–7.5 s     | Real LocalCut editor reveal and camera push          |
| 7.5–9.375 s    | Abstract layered timeline, text and waveform         |
| 9.375–11.25 s  | Local media processing motif                         |
| 11.25–13.125 s | Alternating shutters reveal “Make the cut”           |
| 13.125–15 s    | Scissors mark, wordmark and project URL              |

The abstract tracks are motion graphics. The editor image is an actual isolated
Chrome capture of LocalCut at base `77280707375e22b3d35266d0ac7fdf2fac9c2635`,
using the development entry and original task-owned images. It is a showcase
capture, not production-entry acceptance evidence. No AI replies were simulated.

The original score uses warm synth chords, a developing plucked motif, bass,
kick, hats, reverse-air cuts and a resolved ending. No third-party samples,
remote music generation or paid services were used.

## Reproduce

Use Node 22+ for the standalone renderer, Python 3.11+ for the pinned numerical
libraries, and FFmpeg/ffprobe available on PATH. These dependencies are isolated
from the application's package and lockfile.

From the repository root:

```sh
npm ci --prefix docs/showcase
python3 -m venv .artifacts/brand-showcase-venv
.artifacts/brand-showcase-venv/bin/pip install -r docs/showcase/requirements.txt
HYPERFRAMES_NO_TELEMETRY=1 node docs/showcase/node_modules/hyperframes/bin/hyperframes.mjs check docs/showcase
.artifacts/brand-showcase-venv/bin/python docs/showcase/render.py
```

The renderer writes the MP4, picture-only intermediate, WAV and decoded media
report under ignored `.artifacts/brand-showcase/`. To use binaries outside PATH,
pass `--ffmpeg /absolute/path/ffmpeg --ffprobe /absolute/path/ffprobe` to
`render.py`. Choose a fresh `--output` folder for each candidate; `--overwrite`
explicitly replaces an existing task-owned final.

To preview the editable composition, run HyperFrames `preview docs/showcase`.
The film itself has no audio element: preview the delivered MP4 to hear the score.
To change it, edit the timeline, HTML/CSS/JS, or the original synthesis program,
then render a new candidate. Keep timing edits in `timeline.json`.

Artwork can be regenerated with `python docs/showcase/artwork.py` in the same
virtual environment. To recapture the editor, install the root repository's
pinned dependencies, start `pnpm dev --port 4196 --strictPort`, then run:

```sh
node docs/showcase/capture.mjs http://127.0.0.1:4196/LocalCut/
```

The capture uses a fresh Chrome context, the existing editor facade and a sample
project. Closing that context retires its isolated storage. It does not connect
providers or access an existing browser profile.

## Verification boundaries

Use the decoded final MP4 for frame count, duration, audio checks and visual
review. A successful HyperFrames check does not prove encoded-file quality.
Inspect readable holds and transitions, including boundary frames. Seek A/B/A in
the same Chrome session to check that animation state does not depend on history.

The delivered candidate's encoded frames, 900-frame count, 15-second duration,
1080p/60 format and AAC stereo stream were inspected. The decoded audio levels
were measured. Subjective listening and continuous human playback have not been
observed in this environment. Application runtime behavior is unchanged;
transcription, native export and performance suites were outside this artifact's
validation scope. No merge, release or publication is included.
