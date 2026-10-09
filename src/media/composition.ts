import { VideoSampleSink } from 'mediabunny';
import type { Input } from 'mediabunny';
import type { Clip, Project, Transcript } from '../core/model';
import { invariant } from '../core/errors';
import { gainAt, mapSourceCue, sourceTimeUs, valueAt } from '../core/timing';
import { resampleAt } from '../core/resample';
import { checkAbort } from '../services/jobs';
import type { Progress } from '../services/jobs';
import type { Store } from '../storage/store';
import { inputFile, convertCache, pcmWindow } from './assets';
export class Renderer {
  readonly canvas: OffscreenCanvas;
  private layers = new Map<string, OffscreenCanvas>();
  private touchedLayers = new Set<string>();
  private audioProgress: (p: Progress) => void = () => {};
  private inputs = new Map<string, Input>();
  private sinks = new Map<string, VideoSampleSink>();
  private images = new Map<string, ImageBitmap>();
  private pcm = new Map<string, File>();
  private leases = new Map<string, () => void>();
  private transcripts = new Map<string, Transcript | undefined>();
  constructor(
    readonly store: Store,
    readonly project: Project,
    width = project.width,
    height = project.height,
  ) {
    this.canvas = new OffscreenCanvas(width, height);
  }
  private layer(id: string) {
    this.touchedLayers.add(id);
    let c = this.layers.get(id);
    if (!c) {
      c = new OffscreenCanvas(this.canvas.width, this.canvas.height);
      this.layers.set(id, c);
    }
    const ctx = c.getContext('2d')!;
    ctx.reset();
    return { canvas: c, ctx };
  }
  private async drawClip(clip: Clip, timeUs: number) {
    const { canvas, ctx } = this.layer(clip.id);
    ctx.scale(
      this.canvas.width / this.project.width,
      this.canvas.height / this.project.height,
    );
    const x = valueAt(clip, 'x', timeUs),
      y = valueAt(clip, 'y', timeUs),
      width = valueAt(clip, 'width', timeUs),
      height = valueAt(clip, 'height', timeUs);
    ctx.translate(x + width / 2, y + height / 2);
    ctx.rotate((valueAt(clip, 'rotation', timeUs) * Math.PI) / 180);
    ctx.translate(-width / 2, -height / 2);
    ctx.filter = 'none';
    if (clip.kind === 'image' || clip.kind === 'video') {
      const asset = await this.store.getAsset(clip.assetId!);
      const crop = clip.crop ?? { x: 0, y: 0, width: 1, height: 1 };
      const sx = crop.x * asset.width,
        sy = crop.y * asset.height,
        sw = crop.width * asset.width,
        sh = crop.height * asset.height;
      const fit = Math.min(width / sw, height / sh),
        dw = sw * fit,
        dh = sh * fit,
        dx = (width - dw) / 2,
        dy = (height - dh) / 2;
      if (clip.kind === 'image') {
        let image = this.images.get(asset.id);
        if (!image) {
          image = await createImageBitmap(await this.store.file(asset.id));
          this.images.set(asset.id, image);
        }
        ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
      } else {
        let sink = this.sinks.get(asset.id);
        if (!sink) {
          const input = inputFile(await this.store.file(asset.id)),
            track = await input.getPrimaryVideoTrack();
          invariant(track, 'UNSUPPORTED_CODEC', 'Asset has no video');
          this.inputs.set(asset.id, input);
          sink = new VideoSampleSink(track);
          this.sinks.set(asset.id, sink);
        }
        const frame = await sink.getSample(sourceTimeUs(clip, timeUs) / 1e6);
        if (frame) {
          try {
            frame.draw(ctx, sx, sy, sw, sh, dx, dy, dw, dh);
          } finally {
            frame.close();
          }
        }
      }
    } else if (clip.kind === 'text' || clip.kind === 'caption') {
      let text = clip.text?.text ?? '';
      if (clip.kind === 'caption') {
        const local = timeUs - clip.startUs;
        text = clip.cues
          .filter((c) => c.timeUs <= local && c.endUs > local)
          .map((c) => c.text)
          .join('\n');
      }
      if (text) {
        const style = clip.text ?? {
          text,
          fontSize: 48,
          color: '#ffffff',
          background: 'rgba(0,0,0,.7)',
          align: 'center' as const,
        };
        ctx.filter = 'none';
        ctx.font = `${style.fontSize}px sans-serif`;
        ctx.textAlign = style.align;
        ctx.textBaseline = 'top';
        const lines: string[] = [];
        for (const paragraph of text.split('\n')) {
          let line = '';
          for (const word of paragraph.split(/\s+/)) {
            const next = line ? line + ' ' + word : word;
            if (line && ctx.measureText(next).width > width) {
              lines.push(line);
              line = word;
            } else line = next;
          }
          lines.push(line);
        }
        const boxHeight = lines.length * style.fontSize * 1.25;
        ctx.fillStyle = style.background;
        ctx.fillRect(0, 0, width, Math.min(height, boxHeight));
        ctx.fillStyle = style.color;
        for (let i = 0; i < lines.length; i++)
          ctx.fillText(
            lines[i]!,
            style.align === 'center'
              ? width / 2
              : style.align === 'right'
                ? width
                : 0,
            i * style.fontSize * 1.25,
            width,
          );
      }
    }
    if (clip.transcriptId) {
      let transcript = this.transcripts.get(clip.transcriptId);
      if (!this.transcripts.has(clip.transcriptId)) {
        transcript = await this.store.transcript(clip.transcriptId);
        this.transcripts.set(clip.transcriptId, transcript);
      }
      const active = transcript?.cues
        .map((c) => mapSourceCue(c, clip))
        .filter((c) => c && c.timeUs <= timeUs && c.endUs > timeUs);
      if (active?.length) {
        ctx.filter = 'none';
        ctx.resetTransform();
        ctx.scale(
          this.canvas.width / this.project.width,
          this.canvas.height / this.project.height,
        );
        ctx.font = '48px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(0,0,0,.7)';
        ctx.fillRect(0, this.project.height - 100, this.project.width, 100);
        ctx.fillStyle = 'white';
        ctx.fillText(
          active.map((c) => c!.text).join(' '),
          this.project.width / 2,
          this.project.height - 25,
          this.project.width - 80,
        );
      }
    }
    const effectValues = [
      'brightness',
      'contrast',
      'saturation',
      'grayscale',
      'blur',
    ] as const;
    if (
      effectValues.some(
        (name) =>
          valueAt(clip, name, timeUs) !==
          (['grayscale', 'blur'].includes(name) ? 0 : 1),
      )
    ) {
      const { canvas: filtered, ctx } = this.layer('effects-' + clip.id);
      ctx.filter = `brightness(${valueAt(clip, 'brightness', timeUs)}) contrast(${valueAt(clip, 'contrast', timeUs)}) saturate(${valueAt(clip, 'saturation', timeUs)}) grayscale(${valueAt(clip, 'grayscale', timeUs)}) blur(${(valueAt(clip, 'blur', timeUs) * this.canvas.width) / this.project.width}px)`;
      ctx.drawImage(canvas, 0, 0);
      return filtered;
    }
    return canvas;
  }
  async frame(timeUs: number, signal: AbortSignal) {
    checkAbort(signal);
    this.touchedLayers.clear();
    const activeAssets = new Set(
      this.project.tracks.flatMap((t) =>
        t.clips
          .filter(
            (c) =>
              ['video', 'image'].includes(c.kind) &&
              c.assetId &&
              c.startUs <= timeUs &&
              c.startUs + c.durationUs > timeUs,
          )
          .map((c) => c.assetId!),
      ),
    );
    for (const [id, image] of this.images)
      if (!activeAssets.has(id)) {
        image.close();
        this.images.delete(id);
      }
    for (const [id, input] of this.inputs)
      if (!activeAssets.has(id)) {
        input.dispose();
        this.inputs.delete(id);
        this.sinks.delete(id);
      }
    const ctx = this.canvas.getContext('2d')!;
    ctx.reset();
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    for (const track of this.project.tracks) {
      if (track.kind === 'audio') continue;
      const active = track.clips.filter(
        (c) =>
          c.startUs <= timeUs &&
          c.startUs + c.durationUs > timeUs &&
          c.kind !== 'audio',
      );
      const consumed = new Set<string>();
      for (const clip of active) {
        if (consumed.has(clip.id)) continue;
        checkAbort(signal);
        const transition = this.project.transitions.find(
          (t) =>
            t.trackId === track.id &&
            (t.fromClipId === clip.id || t.toClipId === clip.id) &&
            active.some((c) => c.id === t.fromClipId) &&
            active.some((c) => c.id === t.toClipId),
        );
        if (transition) {
          const a = active.find((c) => c.id === transition.fromClipId)!,
            b = active.find((c) => c.id === transition.toClipId)!,
            amount =
              (timeUs - b.startUs) / (a.startUs + a.durationUs - b.startUs);
          const { canvas: group, ctx: g } = this.layer(
            'transition-' + transition.id,
          );
          if (transition.kind === 'crossfade') {
            g.globalCompositeOperation = 'lighter';
            g.globalAlpha = (1 - amount) * valueAt(a, 'opacity', timeUs);
            g.drawImage(await this.drawClip(a, timeUs), 0, 0);
            g.globalAlpha = amount * valueAt(b, 'opacity', timeUs);
            g.drawImage(await this.drawClip(b, timeUs), 0, 0);
          } else {
            g.fillStyle = 'black';
            g.fillRect(0, 0, group.width, group.height);
            g.globalAlpha =
              amount < 0.5
                ? (1 - 2 * amount) * valueAt(a, 'opacity', timeUs)
                : (2 * amount - 1) * valueAt(b, 'opacity', timeUs);
            g.drawImage(
              await this.drawClip(amount < 0.5 ? a : b, timeUs),
              0,
              0,
            );
          }
          ctx.globalAlpha = 1;
          ctx.drawImage(group, 0, 0);
          consumed.add(a.id);
          consumed.add(b.id);
        } else {
          ctx.globalAlpha = valueAt(clip, 'opacity', timeUs);
          ctx.drawImage(await this.drawClip(clip, timeUs), 0, 0);
          consumed.add(clip.id);
        }
      }
    }
    ctx.globalAlpha = 1;
    for (const [id, surface] of this.layers)
      if (!this.touchedLayers.has(id)) {
        surface.width = 1;
        surface.height = 1;
        this.layers.delete(id);
      }
    return this.canvas;
  }
  async prepareAudio(signal: AbortSignal, progress: (p: Progress) => void) {
    checkAbort(signal);
    this.audioProgress = progress;
  }
  async audio(startFrame: number, count: number, signal: AbortSignal) {
    checkAbort(signal);
    const mixed = [new Float32Array(count), new Float32Array(count)];
    const startUs = (startFrame * 1e6) / 48000,
      endUs = ((startFrame + count) * 1e6) / 48000;
    const active = new Set(
      this.project.tracks
        .filter((t) => !t.muted)
        .flatMap((t) =>
          t.clips
            .filter(
              (c) =>
                c.assetId &&
                ['audio', 'video'].includes(c.kind) &&
                !c.muted &&
                c.startUs < endUs &&
                c.startUs + c.durationUs > startUs,
            )
            .map((c) => c.assetId!),
        ),
    );
    for (const [id, release] of this.leases)
      if (!active.has(id)) {
        release();
        this.leases.delete(id);
        this.pcm.delete(id);
      }
    for (const id of active)
      if (!this.pcm.has(id)) {
        const asset = await this.store.getAsset(id);
        if (!asset.audioCodec) continue;
        if (!this.leases.has(id))
          this.leases.set(id, await this.store.lease('asset:' + id));
        this.pcm.set(
          id,
          await convertCache(
            this.store,
            id,
            'pcm',
            signal,
            this.audioProgress,
            crypto.randomUUID(),
          ),
        );
      }

    for (const track of this.project.tracks) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        if (
          !clip.assetId ||
          !['audio', 'video'].includes(clip.kind) ||
          clip.muted ||
          clip.startUs >= endUs ||
          clip.startUs + clip.durationUs <= startUs
        )
          continue;
        const file = this.pcm.get(clip.assetId);
        if (!file) continue;
        const first = Math.max(
            0,
            Math.ceil(((clip.startUs - startUs) * 48000) / 1e6),
          ),
          last = Math.min(
            count,
            Math.ceil(
              ((clip.startUs + clip.durationUs - startUs) * 48000) / 1e6,
            ),
          );
        const sourceStart =
            ((clip.sourceInUs +
              (startUs + (first * 1e6) / 48000 - clip.startUs) * clip.speed) *
              48000) /
            1e6,
          windowStart = Math.floor(sourceStart) - 32,
          windowCount = Math.ceil((last - first) * clip.speed) + 66;
        const channels = await pcmWindow(file, windowStart, windowCount);
        for (let i = first; i < last; i++) {
          const timeUs = ((startFrame + i) * 1e6) / 48000,
            position =
              ((clip.sourceInUs + (timeUs - clip.startUs) * clip.speed) *
                48000) /
                1e6 -
              windowStart,
            gain = gainAt(clip, timeUs);
          for (let channel = 0; channel < 2; channel++)
            mixed[channel]![i] =
              mixed[channel]![i]! +
              resampleAt(channels[channel]!, position, clip.speed) * gain;
        }
      }
    }
    for (const channel of mixed)
      for (let i = 0; i < channel.length; i++)
        channel[i] = Math.max(-1, Math.min(1, channel[i]!));
    return mixed;
  }
  dispose() {
    for (const release of this.leases.values()) release();
    this.leases.clear();
    for (const input of this.inputs.values()) input.dispose();
    for (const image of this.images.values()) image.close();
    this.inputs.clear();
    this.images.clear();
    for (const surface of this.layers.values()) {
      surface.width = 1;
      surface.height = 1;
    }
    this.layers.clear();
    this.sinks.clear();
    this.pcm.clear();
    this.transcripts.clear();
    this.canvas.width = 1;
    this.canvas.height = 1;
  }
}
