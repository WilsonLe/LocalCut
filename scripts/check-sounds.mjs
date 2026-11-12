import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  SOUND_CATEGORIES,
  SoundCatalogSchema,
} from '../src/core/sound-library.ts';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const lock = JSON.parse(
  await readFile(new URL('./sound-library.lock.json', import.meta.url), 'utf8'),
);

/** Validate every shipped WAV and its reviewed source/recipe, without network or decoding. */
export async function checkSounds(directory = 'public/sounds') {
  assert.equal(
    sha256(await readFile(new URL('./prepare-sounds.py', import.meta.url))),
    lock.preparationSha256,
    'Sound preparation recipe changed without review',
  );
  const catalog = SoundCatalogSchema.parse(
    JSON.parse(await readFile(join(directory, 'catalog.json'), 'utf8')),
  );
  assert.deepEqual(
    catalog.sources,
    lock.sources.map(({ id, name, creator, url }) => ({
      id,
      name,
      creator,
      url,
    })),
  );
  assert.deepEqual(
    catalog.sounds.map((sound) => sound.id),
    lock.sounds.map((sound) => sound.id),
  );
  const measurements = JSON.parse(
    await readFile(join(directory, 'measurements.json'), 'utf8'),
  );
  assert.equal(measurements.length, catalog.sounds.length);
  for (const source of lock.sources)
    assert.equal(
      await readFile(join(directory, 'licenses', source.id + '.txt'), 'utf8'),
      source.notice,
      'Source licence notice changed',
    );
  const files = new Set();
  let bytes = 0;
  for (const [index, sound] of catalog.sounds.entries()) {
    assert(sound.tags.length >= 4, 'Insufficient search tags: ' + sound.id);
    assert(
      sound.tags.every((tag) => tag === tag.toLowerCase()),
      'Tags must use a consistent lowercase vocabulary',
    );
    const source = lock.sounds[index];
    for (const key of ['id', 'name', 'category', 'tags', 'sourceId'])
      assert.deepEqual(
        sound[key],
        source[key],
        'Catalogue differs from reviewed selection: ' + key,
      );
    assert(
      lock.downloads.some(
        (download) =>
          download.file === source.download &&
          /^[a-f0-9]{64}$/.test(download.sha256),
      ),
    );
    assert(/^[a-f0-9]{64}$/.test(source.inputSha256));
    const file = sound.sha256 + '.wav';
    files.add(file);
    const wav = await readFile(join(directory, 'audio', file));
    assert.equal(wav.length, sound.size, 'Sound size mismatch: ' + sound.id);
    assert.equal(sha256(wav), sound.sha256, 'Sound hash mismatch: ' + sound.id);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.readUInt32LE(4), wav.length - 8);
    assert.equal(wav.toString('ascii', 8, 16), 'WAVEfmt ');
    assert.equal(wav.readUInt32LE(16), 16);
    assert.equal(wav.readUInt16LE(20), 1);
    assert.equal(wav.readUInt16LE(22), sound.channels);
    assert.equal(wav.readUInt32LE(24), 48000);
    assert.equal(wav.readUInt32LE(28), 48000 * sound.channels * 2);
    assert.equal(wav.readUInt16LE(32), sound.channels * 2);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.toString('ascii', 36, 40), 'data');
    assert.equal(wav.readUInt32LE(40), wav.length - 44);
    assert.equal((wav.length - 44) % (sound.channels * 2), 0);
    assert.equal(
      Math.floor(
        (((wav.length - 44) / (sound.channels * 2)) * 1e6 + 24000) / 48000,
      ),
      sound.durationUs,
    );
    let peak = 0;
    for (let offset = 44; offset < wav.length; offset += 2)
      peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)));
    assert(
      peak > 0 && peak / 32768 <= 0.8913,
      'Silent or over-peak audio: ' + sound.id,
    );
    assert.equal(measurements[index].id, sound.id);
    assert.equal(measurements[index].sha256, sound.sha256);
    assert(sound.durationUs <= 20_000_000, 'Unbounded ambience excerpt');
    bytes += wav.length;
  }
  assert.deepEqual(
    new Set(await readdir(join(directory, 'audio'))),
    files,
    'Unlisted or missing sound files',
  );
  assert.equal(
    files.size,
    catalog.sounds.length,
    'Duplicate output sound files',
  );
  assert(
    bytes <= 112 * 1024 * 1024,
    'Sound library exceeds its 112 MiB budget',
  );
  for (const category of SOUND_CATEGORIES)
    assert(
      catalog.sounds.some((sound) => sound.category === category),
      'Missing category: ' + category,
    );
  return { sounds: catalog.sounds.length, audioFiles: files.size, bytes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(await checkSounds(process.argv[2]));
