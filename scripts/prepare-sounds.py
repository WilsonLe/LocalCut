#!/usr/bin/env python3
"""Rebuild reviewed sound assets offline from the hash-locked original downloads."""

import argparse
import array
import hashlib
import io
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import wave
import zipfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def decode(data, sound_id):
    # A seekable source lets native container probing determine exact duration.
    with tempfile.NamedTemporaryFile(prefix="localcut-sound-") as original:
        original.write(data)
        original.flush()
        probe = json.loads(subprocess.check_output([
            "ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
            "stream=channels,sample_rate:format=duration", "-of", "json", original.name,
        ]))
        channels = probe["streams"][0]["channels"]
        if channels not in [1, 2]:
            raise ValueError("Unsupported source channel layout: " + sound_id)
        duration = float(probe["format"]["duration"])
        filters = ["aresample=48000"]
        excerpt = duration > 20
        if excerpt:
            filters += ["afade=t=in:st=0:d=0.02", "afade=t=out:st=19.98:d=0.02"]
        decoded = subprocess.check_output([
            "ffmpeg", "-v", "error", "-i", original.name, "-map", "0:a:0",
            "-t", "20", "-af", ",".join(filters), "-f", "f32le", "pipe:1",
        ])
    return probe, channels, duration, excerpt, decoded


def prepare(lock, originals, output):
    tool = subprocess.check_output(["ffmpeg", "-version"]).decode().splitlines()[0]
    if tool != lock["ffmpeg"]:
        raise ValueError("Use the recorded FFmpeg version to reproduce the pinned audio.")
    output.mkdir(parents=True, exist_ok=True)
    (output / "audio").mkdir(exist_ok=True)
    (output / "licenses").mkdir(exist_ok=True)
    inputs = {}
    for item in lock["downloads"]:
        data = (originals / item["file"]).read_bytes()
        if digest(data) != item["sha256"]:
            raise ValueError("Original download hash mismatch: " + item["file"])
        inputs[item["file"]] = data
    sources = []
    for source in lock["sources"]:
        sources.append({key: source[key] for key in ["id", "name", "creator", "url"]})
        (output / "licenses" / (source["id"] + ".txt")).write_bytes(
            source["notice"].encode("utf-8")
        )
    catalog = {"version": 1, "license": "CC0-1.0", "sources": sources, "sounds": []}
    measurements = []
    for item in lock["sounds"]:
        data = inputs[item["download"]]
        if item.get("member"):
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                data = archive.read(item["member"])
        if digest(data) != item["inputSha256"]:
            raise ValueError("Source member hash mismatch: " + item["id"])
        probe, channels, duration, excerpt, decoded = decode(data, item["id"])
        samples = array.array("f", decoded)
        if sys.byteorder != "little":
            samples.byteswap()
        if not samples or len(samples) % channels or any(not math.isfinite(v) for v in samples):
            raise ValueError("Invalid decoded samples: " + item["id"])
        peak = max(abs(value) for value in samples)
        if peak < 0.00001:
            raise ValueError("Empty or silent sound: " + item["id"])
        gain = min(1, (10 ** (-1 / 20)) / peak)
        pcm = array.array("h", (round(value * gain * 32767) for value in samples))
        measured_peak = max(abs(value) for value in pcm) / 32768
        rms = math.sqrt(sum((value / 32768) ** 2 for value in pcm) / len(pcm))
        if sys.byteorder != "little":
            pcm.byteswap()
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as target:
            target.setnchannels(channels)
            target.setsampwidth(2)
            target.setframerate(48000)
            target.writeframes(pcm.tobytes())
        wav = buffer.getvalue()
        sha = digest(wav)
        (output / "audio" / (sha + ".wav")).write_bytes(wav)
        record = {key: item[key] for key in ["id", "name", "category", "tags", "sourceId"]}
        record.update({
            "sha256": sha, "size": len(wav),
            "durationUs": (len(samples) // channels * 1000000 + 24000) // 48000,
            "sampleRate": 48000, "channels": channels,
        })
        catalog["sounds"].append(record)
        measurements.append({
            "id": item["id"], "sha256": sha,
            "inputSampleRate": int(probe["streams"][0]["sample_rate"]),
            "inputDurationUs": round(duration * 1000000),
            "excerpt": excerpt, "fadeUs": 20000 if excerpt else 0,
            "gainDb": round(20 * math.log10(gain), 5),
            "samplePeakDbfs": round(20 * math.log10(measured_peak), 5),
            "rmsDbfs": round(20 * math.log10(rms), 5),
        })
    (output / "catalog.json").write_text(json.dumps(catalog, indent=2) + "\n")
    (output / "measurements.json").write_text(json.dumps(measurements, indent=2) + "\n")
    print(json.dumps({"sounds": len(measurements), "bytes": sum(s["size"] for s in catalog["sounds"])}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    lock = json.loads((root / "scripts/sound-library.lock.json").read_text())
    if digest(Path(__file__).read_bytes()) != lock["preparationSha256"]:
        raise ValueError("Preparation script differs from the reviewed lock.")
    prepare(lock, args.sources, args.output)
