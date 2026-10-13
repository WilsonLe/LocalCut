"""Render and mux the standalone film using its pinned HyperFrames backend."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, default=root.parents[1] / '.artifacts' / 'brand-showcase')
parser.add_argument('--ffmpeg', default=os.environ.get('HYPERFRAMES_FFMPEG_PATH') or shutil.which('ffmpeg'))
parser.add_argument('--ffprobe', default=os.environ.get('HYPERFRAMES_FFPROBE_PATH') or shutil.which('ffprobe'))
parser.add_argument('--overwrite', action='store_true')
args = parser.parse_args()
node = shutil.which('node')
cli = root / 'node_modules' / 'hyperframes' / 'bin' / 'hyperframes.mjs'
for label, binary in [('Node', node), ('FFmpeg', args.ffmpeg), ('FFprobe', args.ffprobe)]:
    if not binary or not Path(binary).is_file():
        parser.error(f'{label} is unavailable; supply its executable path.')
if not cli.is_file():
    parser.error('Install the pinned renderer first: cd docs/showcase && npm ci')
output = args.output.resolve()
final = output / 'LocalCut-showcase.mp4'
if final.exists() and not args.overwrite:
    parser.error('Final already exists; choose a new output folder or use --overwrite.')
output.mkdir(parents=True, exist_ok=True)
score = output / 'score.wav'
picture = output / 'picture.mp4'
env = {**os.environ, 'HYPERFRAMES_NO_TELEMETRY': '1', 'HYPERFRAMES_FFMPEG_PATH': str(Path(args.ffmpeg).resolve()), 'HYPERFRAMES_FFPROBE_PATH': str(Path(args.ffprobe).resolve())}
subprocess.run([sys.executable, str(root / 'compose.py'), '--output', str(score)], check=True)
subprocess.run([node, str(cli), 'render', str(root), '--quality', 'delivery', '--output', str(picture)], env=env, check=True)
timing = json.loads((root / 'timeline.json').read_text())
subprocess.run([args.ffmpeg, '-y', '-i', str(picture), '-i', str(score), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-t', str(timing['duration']), '-movflags', '+faststart', str(final)], check=True)
probe = subprocess.check_output([args.ffprobe, '-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', str(final)], text=True)
metadata = json.loads(probe)
video = next(s for s in metadata['streams'] if s['codec_type'] == 'video')
audio = next(s for s in metadata['streams'] if s['codec_type'] == 'audio')
assert (video['width'], video['height']) == (timing['width'], timing['height'])
assert int(video['nb_read_frames']) == round(timing['duration'] * timing['fps'])
assert video['avg_frame_rate'] == f"{timing['fps']}/1"
assert abs(float(metadata['format']['duration']) - timing['duration']) < .04
assert audio['channels'] == 2
(output / 'media-report.json').write_text(probe)
print(final)
