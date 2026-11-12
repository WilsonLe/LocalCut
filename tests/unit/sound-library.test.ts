import { afterEach, describe, expect, it, vi } from 'vitest';
import { SoundCatalogSchema, findSounds } from '../../src/core/sound-library';
import type { LibrarySound, SoundCatalog } from '../../src/core/sound-library';
import {
  loadSoundCatalog,
  loadSoundFile,
} from '../../src/workspace/sound-library';

const sound: LibrarySound = {
  id: 'test-whoosh',
  name: 'Air sweep',
  category: 'Transitions',
  tags: ['whoosh', 'movement'],
  sourceId: 'test-source',
  sha256: 'a'.repeat(64),
  size: 48,
  durationUs: 1000,
  sampleRate: 48000,
  channels: 1,
};
const catalog: SoundCatalog = {
  version: 1,
  license: 'CC0-1.0',
  sources: [
    {
      id: 'test-source',
      name: 'Test collection',
      creator: 'Créator',
      url: 'https://example.test/sounds',
    },
  ],
  sounds: [
    sound,
    {
      ...sound,
      id: 'test-footstep',
      name: 'Gravel step',
      category: 'Footsteps',
      tags: ['walk', 'gravel'],
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe('sound library catalogue', () => {
  it('searches all terms across sound tags and source metadata within the chosen category', () => {
    expect(
      findSounds(catalog, ' CREATOR whoosh ', 'Transitions').map((s) => s.id),
    ).toEqual(['test-whoosh']);
    expect(findSounds(catalog, 'walk gravel', '').map((s) => s.id)).toEqual([
      'test-footstep',
    ]);
    expect(findSounds(catalog, 'whoosh', 'Footsteps')).toEqual([]);
    expect(findSounds(catalog, 'missing', '')).toEqual([]);
  });

  it('rejects ambiguous provenance, unsupported licences and unsafe identifiers or sources', () => {
    expect(SoundCatalogSchema.parse(catalog)).toEqual(catalog);
    for (const value of [
      { ...catalog, license: 'royalty-free' },
      { ...catalog, sounds: [sound, sound] },
      { ...catalog, sources: [...catalog.sources, catalog.sources[0]] },
      { ...catalog, sounds: [{ ...sound, sourceId: 'unknown' }] },
      { ...catalog, sounds: [{ ...sound, id: '../outside' }] },
      { ...catalog, sounds: [{ ...sound, name: 'path/name' }] },
      { ...catalog, sounds: [{ ...sound, size: 100_000_000 }] },
      { ...catalog, sounds: [{ ...sound, durationUs: 0 }] },
      {
        ...catalog,
        sources: [{ ...catalog.sources[0], url: 'javascript:alert(1)' }],
      },
    ])
      expect(SoundCatalogSchema.safeParse(value).success).toBe(false);
  });
});

describe('verified sound downloads', () => {
  it('revalidates a stale catalogue and exposes network or schema failures before use', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(catalog)));
    vi.stubGlobal('fetch', fetcher);
    expect(await loadSoundCatalog(new AbortController().signal)).toEqual(
      catalog,
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-cache' });
    fetcher.mockResolvedValueOnce(new Response('Missing', { status: 404 }));
    await expect(
      loadSoundCatalog(new AbortController().signal),
    ).rejects.toThrow('could not load');
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ ...catalog, license: 'unknown' })),
    );
    await expect(
      loadSoundCatalog(new AbortController().signal),
    ).rejects.toThrow();
  });

  it('revalidates corrupt cached bytes once and publishes only the matching file', async () => {
    const bytes = new Uint8Array(48).fill(12);
    const hash = Buffer.from(
      await crypto.subtle.digest('SHA-256', bytes),
    ).toString('hex');
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(new Uint8Array(48)))
      .mockResolvedValueOnce(new Response(bytes));
    vi.stubGlobal('fetch', fetcher);
    const file = await loadSoundFile(
      { ...sound, sha256: hash },
      new AbortController().signal,
    );
    expect(file.name).toBe('Air sweep.wav');
    expect(file.type).toBe('audio/wav');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
    expect(fetcher.mock.calls.map((call) => call[1].cache)).toEqual([
      'default',
      'reload',
    ]);
    expect(fetcher.mock.calls[0]?.[0]).toContain(`/audio/${hash}.wav`);
  });

  it('rejects wrong length, repeated corrupt content and cancellation after retrieval', async () => {
    const bytes = new Uint8Array(48).fill(12);
    const hash = Buffer.from(
      await crypto.subtle.digest('SHA-256', bytes),
    ).toString('hex');
    const fetcher = vi.fn().mockImplementation(async () => new Response(bytes));
    vi.stubGlobal('fetch', fetcher);
    await expect(
      loadSoundFile(
        { ...sound, sha256: hash, size: 50 },
        new AbortController().signal,
      ),
    ).rejects.toThrow('file check');
    await expect(
      loadSoundFile(sound, new AbortController().signal),
    ).rejects.toThrow('file check');
    const controller = new AbortController();
    fetcher.mockImplementationOnce(async () => {
      controller.abort();
      return new Response(bytes);
    });
    await expect(
      loadSoundFile({ ...sound, sha256: hash }, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
