import { SoundCatalogSchema } from '../core/sound-library';
import type { LibrarySound } from '../core/sound-library';

export function soundLibraryUrl(path: string) {
  return `${import.meta.env.BASE_URL}sounds/${path}`;
}

export async function loadSoundCatalog(signal: AbortSignal) {
  const response = await fetch(soundLibraryUrl('catalog.json'), {
    signal,
    cache: 'no-cache',
  });
  if (!response.ok) throw new Error('Sound effects could not load. Try again.');
  const catalog = SoundCatalogSchema.parse(await response.json());
  signal.throwIfAborted();
  return catalog;
}

/** Verify the actual bytes before preview or the ordinary immutable-original import. */
export async function loadSoundFile(sound: LibrarySound, signal: AbortSignal) {
  for (const cache of ['default', 'reload'] as const) {
    const response = await fetch(soundLibraryUrl(`audio/${sound.sha256}.wav`), {
      signal,
      cache,
    });
    if (!response.ok)
      throw new Error('This sound could not download. Try again.');
    const bytes = await response.arrayBuffer();
    signal.throwIfAborted();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    signal.throwIfAborted();
    const hash = Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, '0'),
    ).join('');
    if (bytes.byteLength === sound.size && hash === sound.sha256)
      return new File([bytes], `${sound.name}.wav`, { type: 'audio/wav' });
  }
  throw new Error(
    'This sound failed its file check. Reload LocalCut and try again.',
  );
}
