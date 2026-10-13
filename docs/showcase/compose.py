"""Original 8-bar synth score; the film timeline is the sole timing owner.
Requires numpy; no samples, paid services or external audio.
"""
import argparse
import hashlib
import json
from pathlib import Path
import wave
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
timeline = json.loads(Path(__file__).with_name('timeline.json').read_text())
sr = 48000
beat = 60 / timeline['bpm']
length = round(timeline['duration'] * sr)
mix = np.zeros((length, 2), dtype=np.float64)
rng = np.random.default_rng(213)

def hz(midi):
    return 440 * 2 ** ((midi - 69) / 12)

def add(sound, start, gain=1, pan=0):
    offset = round(start * sr)
    skip = max(0, -offset)
    offset = max(0, offset)
    count = min(len(sound) - skip, length - offset)
    if count <= 0:
        return
    sound = sound[skip:skip + count] * gain
    mix[offset:offset + count, 0] += sound * np.sqrt((1-pan)/2)
    mix[offset:offset + count, 1] += sound * np.sqrt((1+pan)/2)

def synth(note, duration, kind='pluck'):
    t = np.arange(round(sr * duration)) / sr
    f = hz(note)
    if kind == 'pad':
        signal = (np.sin(2*np.pi*f*t) + .32*np.sin(2*np.pi*f*1.003*t) + .12*np.sin(4*np.pi*f*t))
        env = np.minimum(1, t/.13) * np.minimum(1, (duration-t)/.35) * .28
    elif kind == 'bass':
        signal = np.sin(2*np.pi*f*t) + .18*np.sin(4*np.pi*f*t)
        env = np.minimum(1, t/.008) * np.exp(-t*4) * np.minimum(1,(duration-t)/.04)
    else:
        signal = np.sin(2*np.pi*f*t) + .35*np.sin(4*np.pi*f*t)*np.exp(-t*7) + .12*np.sin(6*np.pi*f*t)*np.exp(-t*13)
        env = (1-np.exp(-t*300)) * np.exp(-t*5) * np.minimum(1,(duration-t)/.06)
    return signal * env

chords = [[48,55,58,62,67], [44,51,55,58,63], [51,58,62,65,70], [46,53,57,60,65]]
for i, chord in enumerate(chords):
    for j, note in enumerate(chord):
        add(synth(note, beat*8+.3,'pad'), i*beat*8, .095, (j-2)*.25)
# A compact original motif, developed over the harmonic movement.
patterns = [[72,79,74,75,79,82,79,75], [72,75,79,82,79,75,72,70], [74,79,82,86,82,79,77,74], [77,81,84,81,77,74,72,70]]
for bar in range(8):
    for step,note in enumerate(patterns[bar//2]):
        start=(bar*4+step*.5)*beat
        if bar == 0 and step < 4:
            continue
        if start >= timeline['cues']['brand']:
            continue
        sound=synth(note, .62)
        pan=(-.4 if step%2==0 else .4)
        add(sound,start,.10,pan)
        add(sound,start+beat*.75,.027,-pan)
    for step in [0,1.5,2,3.5]:
        start=(bar*4+step)*beat
        if start < timeline['cues']['brand']:
            add(synth(chords[bar//2][0]-12, .36,'bass'),start,.20)
# Kick with a continuous integrated pitch fall; crisp, restrained noise percussion.
for b in range(28):
    if b < 4 and b%2:
        continue
    t=np.arange(round(.32*sr))/sr
    phase=2*np.pi*(46*t+65*.035*(1-np.exp(-t/.035)))
    add(np.sin(phase)*np.exp(-t*16)*np.minimum(1,t/.002),b*beat,.35)
    if b%2 and b>=4:
        t=np.arange(round(.16*sr))/sr
        n=rng.normal(0,1,len(t)); high=n-np.roll(n,1)
        add(high*np.exp(-t*34)*np.minimum(1,t/.001),b*beat,.048)
for step in range(8,56):
    t=np.arange(round(.065*sr))/sr
    noise=rng.normal(0,1,len(t)); high=noise-np.roll(noise,1)
    add(high*np.exp(-t*95)*np.minimum(1,t/.001),step*beat/2,.018 if step%2 else .026,.5 if step%2 else -.5)
# Soft reverse-air edits and glass accents land on the shared scene markers.
for name,cue in timeline['cues'].items():
    if name in ('footage','end'):
        continue
    t=np.arange(round(.24*sr))/sr
    noise=rng.normal(0,1,len(t)); smooth=np.convolve(noise,np.ones(17)/17,mode='same')
    add(smooth*(t/.24)**2,cue-.24,.16)
    add(synth(84 if name!='brand' else 72,.9),cue,.12)
# Final tonic resolves the sequence and rings into the final lockup hold.
for j,note in enumerate([48,55,60,67,72]):
    add(synth(note,1.8,'pad'),timeline['cues']['brand'],.13,(j-2)*.2)
fade_in=min(round(.014*sr),length)
fade_out=min(round(.42*sr),length)
mix[:fade_in] *= np.linspace(0,1,fade_in)[:,None]
mix[-fade_out:] *= np.linspace(1,0,fade_out)[:,None]
mix=np.tanh(mix*1.3)
mix *= .86 / max(1e-12,np.abs(mix).max())
args.output.parent.mkdir(parents=True,exist_ok=True)
pcm=(mix*32767).astype('<i2')
with wave.open(str(args.output),'wb') as out:
    out.setnchannels(2);out.setsampwidth(2);out.setframerate(sr);out.writeframes(pcm.tobytes())
with wave.open(str(args.output),'rb') as inp:
    decoded=np.frombuffer(inp.readframes(inp.getnframes()),dtype='<i2').astype(float)/32768
    print(json.dumps({'duration':inp.getnframes()/sr,'frames':inp.getnframes(),'sample_rate':sr,'peak':float(np.abs(decoded).max()),'rms':float(np.sqrt(np.mean(decoded**2))),'sha256':hashlib.sha256(args.output.read_bytes()).hexdigest(),'cues':timeline['cues']},indent=2))
