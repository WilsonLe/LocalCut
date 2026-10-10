/** Stereo-coherent WSOLA. Retains two 1024-sample grains, never a full clip.
 * Seeking starts a fresh overlap sequence at the requested grain. */
const HOP = 512;
const SEARCH = 384;
export class PitchStretcher {
  private next = -1;
  private previous: Float32Array[] | undefined;
  private block: Float32Array[] | undefined;
  private blockStart = -1;

  async render(
    start: number,
    count: number,
    position: (outputFrame: number) => number,
    read: (sourceFrame: number, count: number) => Promise<Float32Array[]>,
  ) {
    const output = [new Float32Array(count), new Float32Array(count)];
    let offset = 0;
    while (offset < count) {
      const frame = start + offset;
      const grain = Math.floor(frame / HOP) * HOP;
      if (this.blockStart !== grain) {
        if (this.next !== grain) this.previous = undefined;
        const ideal = Math.round(position(grain));
        const source = await read(ideal - SEARCH, 2 * HOP + 2 * SEARCH);
        let shift = SEARCH;
        if (this.previous) {
          // One lag for both channels protects stereo phase, including a silent left channel.
          let best = -Infinity;
          const score = (candidate: number) => {
            let dot = 0,
              energy = 1e-12;
            for (let c = 0; c < 2; c++)
              for (let i = 0; i < HOP; i += 4) {
                const a = this.previous![c]![HOP + i]!,
                  b = source[c]![candidate + i]!;
                dot += a * b;
                energy += b * b;
              }
            return dot / Math.sqrt(energy);
          };
          // Prefer the closest equally good match to avoid drift through silence.
          for (let distance = 0; distance <= SEARCH; distance += 4)
            for (const candidate of distance
              ? [SEARCH - distance, SEARCH + distance]
              : [SEARCH]) {
              const value = score(candidate);
              if (value > best + 1e-8) {
                best = value;
                shift = candidate;
              }
            }
          const coarse = shift;
          for (
            let candidate = Math.max(0, coarse - 3);
            candidate <= Math.min(2 * SEARCH, coarse + 3);
            candidate++
          ) {
            const value = score(candidate);
            if (value > best + 1e-8) {
              best = value;
              shift = candidate;
            }
          }
        }
        const current = source.map((channel) =>
          channel.slice(shift, shift + 2 * HOP),
        );
        this.block = current.map((channel, c) =>
          Float32Array.from({ length: HOP }, (_, i) => {
            if (!this.previous) return channel[i]!;
            const weight = (1 - Math.cos((Math.PI * i) / HOP)) / 2;
            return (
              this.previous[c]![HOP + i]! * (1 - weight) + channel[i]! * weight
            );
          }),
        );
        this.previous = current;
        this.blockStart = grain;
        this.next = grain + HOP;
      }
      const local = frame - grain,
        take = Math.min(count - offset, HOP - local);
      for (let c = 0; c < 2; c++)
        output[c]!.set(this.block![c]!.subarray(local, local + take), offset);
      offset += take;
    }
    return output;
  }
}
