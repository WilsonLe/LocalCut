import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Manifests include the checksum of every binary in this immutable snapshot. */
export function fontSnapshot(directory = 'public/fonts'): string {
  const lock = readFileSync(join(directory, 'catalog-lock.json'));
  const families = JSON.parse(lock.toString()) as {
    families: { id: string }[];
  };
  const digest = createHash('sha256').update(lock);
  // Default string ordering is independent of the build host's locale.
  for (const id of families.families.map((family) => family.id).sort()) {
    digest.update(id).update('\0');
    digest.update(readFileSync(join(directory, id, 'manifest.json')));
  }
  return digest.digest('hex');
}
