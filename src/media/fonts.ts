import { EditorError } from '../core/errors';
import type { TextStyleInput } from '../core/text-library';

interface FontManifest {
  family: string;
  files: {
    file: string;
    subset: string;
    sha256: string;
    unicodeRange: string;
  }[];
}
const manifests = new Map<string, Promise<FontManifest>>();
const faces = new Map<string, Promise<void>>();
const prepared = new Map<string, Promise<void>>();
let downloading = 0;
const waiting: (() => void)[] = [];
async function fetchFont(url: URL) {
  if (downloading >= 4)
    await new Promise<void>((resolve) => waiting.push(resolve));
  else downloading++;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Font asset unavailable');
    return await response.arrayBuffer();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else downloading--;
  }
}
// BASE_URL is an origin-relative deployment base, including inside worker chunks.
const fontBase = new URL(
  'fonts/',
  new URL(import.meta.env.BASE_URL, import.meta.url),
);

export function includesText(range: string, text: string) {
  const intervals = range.split(',').map((part) => {
    const [start, end] = part.trim().slice(2).split('-');
    return [parseInt(start!, 16), parseInt(end ?? start!, 16)];
  });
  return [...new Set(Array.from(text, (char) => char.codePointAt(0)!))].some(
    (code) => intervals.some(([start, end]) => code >= start! && code <= end!),
  );
}

function retryable<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  work: () => Promise<T>,
) {
  let promise = cache.get(key);
  if (!promise) {
    promise = work().catch((error) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, promise);
  }
  return promise;
}

/** Each realm owns its FontFaceSet. Workers must prepare independently of the UI. */
export async function ensureTextFont(style: TextStyleInput) {
  if (!style.fontFamily?.startsWith('font-')) return;
  const id = style.fontFamily.slice(5);
  const text = [style.text, ...(style.animation?.variations ?? [])].join('');
  const key = `${id}/${text}`;
  try {
    await retryable(prepared, key, async () => {
      const manifest = await retryable(manifests, id, async () => {
        const bytes = await fetchFont(new URL(`${id}/manifest.json`, fontBase));
        return JSON.parse(new TextDecoder().decode(bytes)) as FontManifest;
      });
      const files = manifest.files.filter((file) =>
        includesText(file.unicodeRange, text),
      );
      await Promise.all(
        files.map((file) =>
          retryable(faces, `${id}/${file.file}`, async () => {
            const bytes = await fetchFont(
              new URL(`${id}/${file.file}`, fontBase),
            );
            const hash = [
              ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
            ]
              .map((byte) => byte.toString(16).padStart(2, '0'))
              .join('');
            if (hash !== file.sha256)
              throw new Error('Font integrity check failed');
            const face = await new FontFace(manifest.family, bytes, {
              unicodeRange: file.unicodeRange,
            }).load();
            const realm = globalThis as unknown as {
              fonts?: FontFaceSet;
              document?: { fonts: FontFaceSet };
            };
            const fontSet = realm.fonts ?? realm.document?.fonts;
            if (!fontSet)
              throw new Error('Font loading is unavailable in this renderer');
            fontSet.add(face);
          }),
        ),
      );
    });
    if (prepared.size > 128) prepared.delete(prepared.keys().next().value!);
  } catch (error) {
    throw new EditorError(
      'MISSING_ASSET',
      `Could not load ${id.replaceAll('-', ' ')}. Retry when the font files are available.`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}
