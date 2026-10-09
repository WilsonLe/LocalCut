import {
  requiredUrls,
  modelHashes,
  runtimeHashes,
} from './transcription-config';
export async function modelStatus(namespace: string) {
  const name = `${namespace}-asr-v1`;
  if (!(await caches.has(name)))
    return { ready: false, missing: requiredUrls() };
  const cache = await caches.open(name),
    missing: string[] = [];
  for (const url of requiredUrls()) {
    const response = await cache.match(url);
    if (!response || !response.ok) {
      missing.push(url);
      continue;
    }
    const filename = new URL(url).pathname.split('/').pop()!,
      expected = modelHashes[filename] ?? runtimeHashes[filename];
    if (expected) {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        await response.arrayBuffer(),
      );
      if (
        Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join('') !== expected
      )
        missing.push(url);
    } else {
      try {
        await response.json();
      } catch {
        missing.push(url);
      }
    }
  }
  return { ready: missing.length === 0, missing };
}
