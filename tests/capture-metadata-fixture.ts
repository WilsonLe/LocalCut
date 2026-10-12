/** Synthetic EXIF with southern latitude, eastern longitude, below-sea-level altitude and original wall time. */
export const captureFixture = {
  time: {
    value: '2024-06-15T12:34:56.125+10:00',
    source: 'exif-original' as const,
  },
  location: {
    latitude: -27.5,
    longitude: 153.25,
    altitudeMeters: -12,
    source: 'exif-gps' as const,
  },
};
export function exifFixture(
  dates: { original?: string; digitized?: string } = {},
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(512),
    v = new DataView(bytes.buffer);
  bytes.set([73, 73, 42, 0, 8, 0, 0, 0]);
  let data = 240;
  function ifd(
    offset: number,
    entries: {
      tag: number;
      type: number;
      count: number;
      value: number | Uint8Array;
    }[],
  ) {
    v.setUint16(offset, entries.length, true);
    entries.forEach((e, i) => {
      const at = offset + 2 + i * 12;
      v.setUint16(at, e.tag, true);
      v.setUint16(at + 2, e.type, true);
      v.setUint32(at + 4, e.count, true);
      if (typeof e.value === 'number') v.setUint32(at + 8, e.value, true);
      else if (e.value.length <= 4) bytes.set(e.value, at + 8);
      else {
        v.setUint32(at + 8, data, true);
        bytes.set(e.value, data);
        data += e.value.length;
      }
    });
  }
  const text = (tag: number, s: string) => ({
    tag,
    type: 2,
    count: s.length + 1,
    value: new TextEncoder().encode(s + '\0'),
  });
  const rational = (tag: number, ns: number[]) => {
    const b = new Uint8Array(ns.length * 8),
      d = new DataView(b.buffer);
    ns.forEach((n, i) => {
      d.setUint32(i * 8, n, true);
      d.setUint32(i * 8 + 4, 1, true);
    });
    return { tag, type: 5, count: ns.length, value: b };
  };
  ifd(8, [
    { tag: 0x8769, type: 4, count: 1, value: 40 },
    { tag: 0x8825, type: 4, count: 1, value: 140 },
  ]);
  ifd(40, [
    text(0x9003, dates.original ?? '2024:06:15 12:34:56'),
    text(0x9011, '+10:00'),
    text(0x9291, '125'),
    ...(dates.digitized
      ? [
          text(0x9004, dates.digitized),
          text(0x9012, '-07:00'),
          text(0x9292, '75'),
        ]
      : []),
  ]);
  ifd(140, [
    text(1, 'S'),
    rational(2, [27, 30, 0]),
    text(3, 'E'),
    rational(4, [153, 15, 0]),
    { tag: 5, type: 1, count: 1, value: 1 },
    rational(6, [12]),
  ]);
  return bytes.slice(0, data);
}
function concat(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
}
export function embedExif(
  original: Uint8Array,
  type: string,
  exif = exifFixture(),
): Uint8Array<ArrayBuffer> {
  if (type === 'image/jpeg') {
    const header = new Uint8Array(10);
    header.set([255, 225]);
    new DataView(header.buffer).setUint16(2, exif.length + 8);
    header.set(new TextEncoder().encode('Exif\0\0'), 4);
    return concat(original.slice(0, 2), header, exif, original.slice(2));
  }
  if (type === 'image/png') {
    const chunk = new Uint8Array(exif.length + 12),
      v = new DataView(chunk.buffer);
    v.setUint32(0, exif.length);
    chunk.set(new TextEncoder().encode('eXIf'), 4);
    chunk.set(exif, 8);
    let crc = 0xffffffff;
    for (const byte of chunk.subarray(4, chunk.length - 4)) {
      crc ^= byte;
      for (let i = 0; i < 8; i++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    v.setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0);
    // EXIF after compressed pixels exercises chunk skipping rather than a prefix read.
    return concat(original.slice(0, -12), chunk, original.slice(-12));
  }
  const chunk = new Uint8Array(8 + exif.length + (exif.length % 2));
  chunk.set(new TextEncoder().encode('EXIF'));
  new DataView(chunk.buffer).setUint32(4, exif.length, true);
  chunk.set(exif, 8);
  const result = concat(original, chunk);
  new DataView(result.buffer).setUint32(4, result.length - 8, true);
  return result;
}
