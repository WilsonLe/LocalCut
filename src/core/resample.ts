const tables = new Map<number, Float32Array[]>();
export function resampleAt(
  data: Float32Array,
  position: number,
  speed: number,
): number {
  if (speed === 1 && Number.isInteger(position)) return data[position] ?? 0;
  const cutoff = Math.min(1, 1 / speed),
    phase = Math.floor((position - Math.floor(position)) * 1024);
  let table = tables.get(speed);
  if (!table) {
    table = Array.from({ length: 1024 }, (_, p) => {
      const weights = new Float32Array(64);
      let sum = 0;
      for (let k = 0; k < 64; k++) {
        const x = (k - 31 - p / 1024) * cutoff,
          sinc =
            Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
        const window =
          0.5 + 0.5 * Math.cos((Math.PI * (k - 31 - p / 1024)) / 32);
        weights[k] = sinc * window * cutoff;
        sum += weights[k]!;
      }
      for (let k = 0; k < 64; k++) weights[k] = weights[k]! / sum;
      return weights;
    });
    if (tables.size >= 16) tables.delete(tables.keys().next().value!);
    tables.set(speed, table);
  }
  let value = 0;
  const center = Math.floor(position);
  for (let k = 0; k < 64; k++)
    value += (data[center + k - 31] ?? 0) * table[phase]![k]!;
  return value;
}
