/** Local spectral gate: stationary noise below a user-selected RMS floor. */
export function suppressNoise(
  channels: Float32Array[],
  startFrame: number,
  strength: number,
  floorDb: number,
) {
  if (!strength) return;
  const n = 512,
    hop = 128,
    floor = 10 ** (floorDb / 20) * Math.sqrt((n * 3) / 8);
  const window = Float64Array.from(
    { length: n },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n),
  );
  for (const channel of channels) {
    const output = new Float64Array(channel.length),
      weights = new Float64Array(channel.length);
    const re = new Float64Array(n),
      im = new Float64Array(n);
    for (
      let frame = Math.floor(startFrame / hop) * hop - n + hop;
      frame < startFrame + channel.length;
      frame += hop
    ) {
      const offset = frame - startFrame;
      for (let i = 0; i < n; i++) {
        re[i] = (channel[offset + i] ?? 0) * window[i]!;
        im[i] = 0;
      }
      fft(re, im, false);
      for (let i = 0; i < n; i++) {
        const magnitude = Math.hypot(re[i]!, im[i]!);
        const ratio = Math.min(
          1,
          Math.max(0, (magnitude - floor) / (floor + 1e-12)),
        );
        const gain = 1 - strength * (1 - ratio);
        re[i] = re[i]! * gain;
        im[i] = im[i]! * gain;
      }
      fft(re, im, true);
      for (let i = 0; i < n; i++)
        if (offset + i >= 0 && offset + i < channel.length) {
          output[offset + i] = output[offset + i]! + re[i]! * window[i]!;
          weights[offset + i] = weights[offset + i]! + window[i]! ** 2;
        }
    }
    for (let i = 0; i < channel.length; i++)
      channel[i] = output[i]! / (weights[i] || 1);
  }
}
function fft(re: Float64Array, im: Float64Array, inverse: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let length = 2; length <= n; length *= 2) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / length,
      wr = Math.cos(angle),
      wi = Math.sin(angle);
    for (let offset = 0; offset < n; offset += length) {
      let r = 1,
        m = 0;
      for (let j = 0; j < length / 2; j++) {
        const a = offset + j,
          b = a + length / 2,
          br = re[b]! * r - im[b]! * m,
          bi = re[b]! * m + im[b]! * r;
        re[b] = re[a]! - br;
        im[b] = im[a]! - bi;
        re[a] = re[a]! + br;
        im[a] = im[a]! + bi;
        const next = r * wr - m * wi;
        m = r * wi + m * wr;
        r = next;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      re[i] = re[i]! / n;
      im[i] = im[i]! / n;
    }
}
