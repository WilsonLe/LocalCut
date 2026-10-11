import type { Asset, Clip, Editor } from '../editor';
import { loopDurationUs } from '../core/speed';
import { sourceTimeUs } from '../core/timing';

export type TimelinePreview = { url: string } | { peaks: Float32Array };
export type PreviewAsset = Pick<
  Asset,
  'id' | 'status' | 'size' | 'width' | 'height'
>;
interface Entry {
  users: number;
  active: boolean;
  promise: Promise<TimelinePreview>;
  start: () => void;
  cancel: () => void;
  url?: string;
}

/** One timeline owns its local previews. Visible clips share analysis and at most
 * two jobs run at once; leaving the viewport releases their native jobs/URLs. */
export class TimelinePreviews {
  private entries = new Map<string, Entry>();
  private queue: Entry[] = [];
  private running = 0;
  private disposed = false;
  constructor(private editor: Editor) {}

  acquire(asset: PreviewAsset, audio: boolean, timeUs: number) {
    const key = `${asset.id}:${asset.status}:${asset.size}:${audio ? 'audio' : timeUs}`;
    let entry = this.entries.get(key);
    if (!entry) {
      let resolve!: (preview: TimelinePreview) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<TimelinePreview>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      // Cancellation can precede the consumer attaching its completion handler.
      void promise.catch(() => {});
      const next: Entry = {
        users: 0,
        active: true,
        promise,
        cancel: () => reject(new Error('Preview cancelled')),
        start: () => {
          this.running++;
          const job = audio
            ? this.editor.assets.waveform(asset.id, 1000)
            : this.editor.assets.thumbnails(
                asset.id,
                [timeUs],
                Math.max(
                  1,
                  Math.round(Math.min(160, (96 * asset.width) / asset.height)),
                ),
              );
          next.cancel = () => {
            job.cancel();
            reject(new Error('Preview cancelled'));
          };
          void job.completion
            .then((result) => {
              if (!next.active) return;
              if (result instanceof Float32Array) resolve({ peaks: result });
              else if (result[0]) {
                next.url = URL.createObjectURL(result[0].blob);
                resolve({ url: next.url });
              } else reject(new Error('No thumbnail'));
            })
            .catch(reject)
            .finally(() => {
              this.running--;
              this.pump();
            });
        },
      };
      entry = next;
      this.entries.set(key, entry);
      this.queue.push(entry);
    }
    entry.users++;
    this.pump();
    let released = false;
    return {
      completion: entry.promise,
      release: () => {
        if (released) return;
        released = true;
        if (--entry.users === 0) {
          this.retire(entry);
          this.entries.delete(key);
        }
      },
    };
  }

  private pump() {
    while (!this.disposed && this.running < 2 && this.queue.length) {
      const next = this.queue.shift()!;
      if (next.active) next.start();
    }
  }

  private retire(entry: Entry) {
    if (!entry.active) return;
    entry.active = false;
    entry.cancel();
    if (entry.url) URL.revokeObjectURL(entry.url);
  }

  dispose() {
    this.disposed = true;
    for (const entry of this.entries.values()) this.retire(entry);
    this.entries.clear();
    this.queue = [];
  }
}

export function timelineWaveformPath(
  clip: Clip,
  durationUs: number,
  peaks: Float32Array,
) {
  return Array.from({ length: 128 }, (_, i) => {
    const fromUs = sourceTimeUs(
      clip,
      clip.startUs + (i * clip.durationUs) / 128,
    );
    const toUs = sourceTimeUs(
      clip,
      clip.startUs + ((i + 1) * clip.durationUs) / 128,
    );
    const cycle = clip.loop ? loopDurationUs(clip) : 0;
    const fromLocal = (i * clip.durationUs) / 128 + (clip.loop?.offsetUs ?? 0);
    const toLocal =
      ((i + 1) * clip.durationUs) / 128 + (clip.loop?.offsetUs ?? 0);
    const ranges =
      cycle && toLocal - fromLocal >= cycle
        ? [[clip.sourceInUs, clip.sourceOutUs!]]
        : cycle && Math.floor(fromLocal / cycle) !== Math.floor(toLocal / cycle)
          ? [
              [fromUs, clip.sourceOutUs!],
              [clip.sourceInUs, toUs],
            ]
          : [[fromUs, toUs]];
    let peak = 0;
    for (const [a, b] of ranges) {
      const from = Math.max(0, Math.floor((a! / durationUs) * peaks.length));
      const to = Math.min(
        peaks.length,
        Math.max(from + 1, Math.ceil((b! / durationUs) * peaks.length)),
      );
      for (let bin = from; bin < to; bin++) peak = Math.max(peak, peaks[bin]!);
    }
    const height = Math.max(0.5, Math.min(1, peak) * 15);
    return `M${i + 0.5} ${16 - height}v${height * 2}`;
  }).join(' ');
}
