import { load } from 'exifreader';
import type { MetadataTags } from 'mediabunny';
import { captureTime, captureMetadataSchema } from '../core/capture-metadata';
import type { CaptureMetadata } from '../core/capture-metadata';

const MAX_EXIF_BYTES = 1024 * 1024;
const MAX_CHUNKS = 4096;
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** Locate EXIF without reading compressed pixels, including trailing PNG/WebP chunks. */
async function exifBytes(
  file: Blob,
  type: string,
): Promise<ArrayBuffer | undefined> {
  let offset = type === 'image/jpeg' ? 2 : type === 'image/png' ? 8 : 12;
  for (let i = 0; i < MAX_CHUNKS && offset < file.size; i++) {
    const header = new Uint8Array(
      await file.slice(offset, offset + 12).arrayBuffer(),
    );
    const view = new DataView(header.buffer);
    let length: number, start: number, next: number, exif: boolean;
    if (type === 'image/jpeg') {
      if (
        header.length < 4 ||
        header[0] !== 255 ||
        header[1] === 218 ||
        header[1] === 217
      )
        return;
      if (header[1] === 255) {
        offset++;
        continue;
      }
      length = view.getUint16(2) - 2;
      start = offset + 4;
      next = start + length;
      exif = header[1] === 225 && decode(header.subarray(4, 10)) === 'Exif\0\0';
      if (exif) {
        start += 6;
        length -= 6;
      }
    } else {
      if (header.length < 8) return;
      length = view.getUint32(
        type === 'image/png' ? 0 : 4,
        type !== 'image/png',
      );
      start = offset + 8;
      next = start + length + (type === 'image/png' ? 4 : length % 2);
      exif =
        decode(
          header.subarray(
            type === 'image/png' ? 4 : 0,
            type === 'image/png' ? 8 : 4,
          ),
        ) === (type === 'image/png' ? 'eXIf' : 'EXIF');
    }
    if (length < 0 || next <= offset || next > file.size) return;
    if (exif) {
      if (length > MAX_EXIF_BYTES) return;
      const bytes = new Uint8Array(
        await file.slice(start, start + length).arrayBuffer(),
      );
      return decode(bytes.subarray(0, 6)) === 'Exif\0\0'
        ? bytes.slice(6).buffer
        : bytes.buffer;
    }
    offset = next;
  }
}

export async function imageCapture(
  file: Blob,
  type: string,
): Promise<CaptureMetadata | undefined> {
  try {
    const bytes = await exifBytes(file, type);
    if (!bytes) return;
    const tags = load(bytes, {
      expanded: true,
      includeTags: {
        exif: [
          'DateTimeOriginal',
          'DateTimeDigitized',
          'SubSecTimeOriginal',
          'SubSecTimeDigitized',
          'OffsetTimeOriginal',
          'OffsetTimeDigitized',
          'GPSLatitudeRef',
          'GPSLongitudeRef',
          'GPSAltitudeRef',
        ],
        gps: ['Latitude', 'Longitude', 'Altitude'],
      },
    });
    const exif = tags.exif as
      Record<string, { value?: unknown; description?: unknown }> | undefined;
    const string = (key: string) => {
      const tag = exif?.[key];
      const value =
        typeof tag?.value === 'string'
          ? tag.value
          : Array.isArray(tag?.value) && typeof tag.value[0] === 'string'
            ? tag.value[0]
            : tag?.description;
      return typeof value === 'string'
        ? value.replace(/\0/g, '').trim()
        : undefined;
    };
    const capture: CaptureMetadata = {};
    for (const suffix of ['Original', 'Digitized'] as const) {
      const value = string(`DateTime${suffix}`);
      if (!value) continue;
      const sub = string(`SubSecTime${suffix}`);
      const offset = string(`OffsetTime${suffix}`);
      const time = captureTime(
        `${value}${sub && /^\d{1,9}$/.test(sub) ? '.' + sub : ''}${offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : ''}`,
      );
      if (time) {
        capture.time = {
          value: time,
          source: suffix === 'Original' ? 'exif-original' : 'exif-digitized',
        };
        break;
      }
    }
    const latitude = tags.gps?.Latitude,
      longitude = tags.gps?.Longitude;
    // Missing hemisphere references must not be interpreted as north/east.
    if (
      typeof latitude === 'number' &&
      typeof longitude === 'number' &&
      ['N', 'S'].includes(string('GPSLatitudeRef') ?? '') &&
      ['E', 'W'].includes(string('GPSLongitudeRef') ?? '')
    ) {
      const location = captureMetadataSchema.shape.location.safeParse({
        latitude,
        longitude,
        source: 'exif-gps',
        ...([0, 1].includes(exif?.GPSAltitudeRef?.value as number) &&
        Number.isFinite(tags.gps?.Altitude)
          ? { altitudeMeters: tags.gps!.Altitude }
          : {}),
      });
      if (location.success) capture.location = location.data;
    }
    return capture.time || capture.location ? capture : undefined;
  } catch {
    // Descriptive metadata is optional; malformed tags must not reject decodable media.
    return undefined;
  }
}

export function containerCapture(
  tags: MetadataTags,
): CaptureMetadata | undefined {
  const capture: CaptureMetadata = {};
  const raw = tags.raw ?? {};
  const explicit = captureTime(raw['com.apple.quicktime.creationdate']);
  const generic = [
    '©day',
    'date',
    'DATE_RECORDED',
    'DATE_CREATED',
    'ICRD',
    'TDRC',
  ]
    .map((key) => captureTime(raw[key]))
    .find(Boolean);
  if (explicit || generic)
    capture.time = {
      value: (explicit ?? generic)!,
      source: explicit ? 'quicktime-creationdate' : 'container-date',
    };
  for (const key of ['com.apple.quicktime.location.ISO6709', '©xyz']) {
    let value = raw[key];
    // QuickTime udta location is a length/language-prefixed string.
    if (value instanceof Uint8Array && value.length >= 4) {
      const length = new DataView(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      ).getUint16(0);
      value =
        length <= value.length - 4
          ? decode(value.subarray(4, 4 + length))
          : undefined;
    }
    if (typeof value !== 'string' || value.length > 128) continue;
    const match =
      /^([+-]\d{2}(?:\.\d+)?)([+-]\d{3}(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?\/$/.exec(
        value.trim(),
      );
    if (!match) continue;
    const location = captureMetadataSchema.shape.location.safeParse({
      latitude: +match[1]!,
      longitude: +match[2]!,
      ...(match[3] ? { altitudeMeters: +match[3] } : {}),
      source: 'quicktime-location',
    });
    if (location.success) {
      capture.location = location.data;
      break;
    }
  }
  return capture.time || capture.location ? capture : undefined;
}

/** MP4/MOV movie-header creation time is a container fact, never proof of filming time. */
export async function containerCreation(
  file: Blob,
): Promise<CaptureMetadata['time'] | undefined> {
  let visited = 0;
  async function scan(
    start: number,
    end: number,
    insideMovie: boolean,
  ): Promise<CaptureMetadata['time'] | undefined> {
    for (let offset = start; offset + 8 <= end && visited++ < MAX_CHUNKS;) {
      const bytes = new Uint8Array(
        await file.slice(offset, Math.min(end, offset + 32)).arrayBuffer(),
      );
      const view = new DataView(bytes.buffer);
      let size = view.getUint32(0),
        headerSize = 8;
      const kind = decode(bytes.subarray(4, 8));
      if (size === 1) {
        if (bytes.length < 16) return;
        const large = view.getBigUint64(8);
        if (large > BigInt(Number.MAX_SAFE_INTEGER)) return;
        size = Number(large);
        headerSize = 16;
      } else if (size === 0) size = end - offset;
      if (size < headerSize || offset + size > end) return;
      if (!insideMovie && kind === 'moov') {
        const found = await scan(offset + headerSize, offset + size, true);
        if (found) return found;
      }
      if (insideMovie && kind === 'mvhd') {
        const version = bytes[headerSize];
        const needed = headerSize + (version === 1 ? 12 : 8);
        if (
          (version !== 0 && version !== 1) ||
          size < needed ||
          bytes.length < needed
        )
          return;
        const seconds =
          version === 1
            ? view.getBigUint64(headerSize + 4)
            : BigInt(view.getUint32(headerSize + 4));
        if (seconds === 0n || seconds > 255485174399n) return;
        const date = new Date((Number(seconds) - 2082844800) * 1000);
        const value = captureTime(date.toISOString());
        if (value) return { value, source: 'container-date' };
      }
      offset += size;
    }
  }
  try {
    return await scan(0, file.size, false);
  } catch {
    return undefined;
  }
}
