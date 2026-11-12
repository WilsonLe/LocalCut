import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newProject } from '../../src/core/model';
import { findSounds, SoundCatalogSchema } from '../../src/core/sound-library';
import { Jobs } from '../../src/services/jobs';
import { projectTools } from '../../src/workspace/webmcp/tools';
import type { Editor } from '../../src/editor';
import type {
  ProjectView,
  SiteToolHost,
} from '../../src/workspace/webmcp/types';

const catalog = SoundCatalogSchema.parse(
  JSON.parse(await readFile('public/sounds/catalog.json', 'utf8')),
);
const sound = catalog.sounds.find((sound) => sound.name === 'Deep whoosh')!;
const bytes = await readFile(`public/sounds/audio/${sound.sha256}.wav`);
const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(disposers.splice(0).map((dispose) => dispose()));
});

function fixture() {
  const project = newProject('Sound tools');
  let current: ProjectView | null = {
    project,
    version: null,
    selectedClipIds: [],
    playheadUs: 0,
    busy: false,
  };
  const engineJobs = new Jobs();
  const imported = vi.fn((file: File) =>
    engineJobs.start(async () => ({ id: 'imported', name: file.name })),
  );
  const place = vi.fn(async () => ({ revision: 3 }));
  const forProject = vi.fn(() => ({ place }));
  const host: SiteToolHost = {
    editor: {
      assets: { import: imported },
      library: { forProject },
    } as unknown as Editor,
    projectId: project.id,
    getView: () => current,
    seek: vi.fn(),
    select: vi.fn(),
    playback: vi.fn(),
    refresh: vi.fn(async () => {}),
    onError: vi.fn(),
  };
  const lifetime = new AbortController();
  const bridge = projectTools(host, lifetime.signal);
  disposers.push(() => bridge.dispose());
  const invoke = (
    name: string,
    input: unknown,
    signal = new AbortController().signal,
  ) =>
    bridge.tools
      .find((tool) => tool.name === `localcut_${name}`)!
      .execute(input, { signal });
  const fetcher = vi.fn(
    async (url: string) =>
      new Response(
        url.endsWith('catalog.json') ? JSON.stringify(catalog) : bytes,
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  return {
    project,
    host,
    current,
    lifetime,
    imported,
    forProject,
    place,
    fetcher,
    invoke,
    setView: (view: ProjectView | null) => {
      current = view;
    },
  };
}

describe('agent sound library', () => {
  it('finds useful semantic choices in the shipped catalogue and discloses licence, tags, facets and pagination without audio retrieval', async () => {
    for (const [query, expected] of [
      ['paper page turn', 'Book flip'],
      ['pavement walking', 'Footstep concrete'],
      ['retro victory', 'Retro'],
      ['cards shuffle', 'Card shuffle'],
      ['retro laser blaster', 'Retro'],
      ['river stream', 'Park river'],
    ] as const)
      expect(
        findSounds(catalog, query, '').some((sound) =>
          sound.name.startsWith(expected),
        ),
      ).toBe(true);
    expect(
      findSounds(catalog, 'phase jump sweep', 'Transitions').map(
        (sound) => sound.id,
      ),
    ).toContain('kenney-digital-audio-phase-jump4');
    const f = fixture();
    expect(f.fetcher).not.toHaveBeenCalled();
    const result = await f.invoke('catalog', {
      kind: 'sounds',
      query: 'whoosh',
      tags: ['movement'],
      maxDurationUs: sound.durationUs,
      offset: 0,
      limit: 1,
    });
    expect(result).toMatchObject({
      total: expect.any(Number),
      offset: 0,
      items: [
        expect.objectContaining({
          license: 'CC0-1.0',
          source: expect.objectContaining({ creator: 'Woven SFX' }),
          tags: expect.arrayContaining(['movement']),
        }),
      ],
      facets: {
        tags: expect.arrayContaining([
          { tag: 'whoosh', count: expect.any(Number) },
        ]),
      },
    });
    expect(
      f.fetcher.mock.calls.every(([url]) => url.endsWith('catalog.json')),
    ).toBe(true);
    expect(f.imported).not.toHaveBeenCalled();
    expect(
      await f.invoke('catalog', {
        kind: 'sounds',
        category: 'Footsteps',
        tags: ['not-a-tag'],
      }),
    ).toMatchObject({ items: [], total: 0, nextOffset: null });
  });

  it('imports the verified choice with friendly name through existing jobs and captured folder placement', async () => {
    const f = fixture();
    const started = (await f.invoke('import_media', {
      projectId: f.project.id,
      soundId: sound.id,
      parentId: 'folder',
    })) as { jobId: string };
    const file = f.imported.mock.calls[0]![0];
    expect(file.name).toBe('Deep whoosh.wav');
    expect(Buffer.from(await file.arrayBuffer())).toEqual(bytes);
    expect(
      await f.invoke('job', {
        projectId: f.project.id,
        jobId: started.jobId,
        action: 'wait',
      }),
    ).toMatchObject({
      state: 'completed',
      result: { asset: { id: 'imported' }, libraryRevision: 3 },
    });
    expect(f.forProject).toHaveBeenCalledWith(f.project.id);
    expect(f.place).toHaveBeenCalledWith('imported', [], 'folder');
  });

  it('rejects ambiguous file input, unknown IDs, corrupt bytes and historical imports before mutation', async () => {
    const f = fixture();
    const input = { projectId: f.project.id, soundId: sound.id };
    for (const extra of [
      { base64: 'eA==' },
      { relinkAssetId: 'other' },
      { name: 'override.wav' },
    ])
      expect(
        await f.invoke('import_media', { ...input, ...extra }),
      ).toMatchObject({ isError: true });
    expect(
      await f.invoke('import_media', { ...input, soundId: '../outside' }),
    ).toMatchObject({ error: { code: 'NOT_FOUND' } });
    f.fetcher.mockImplementation(
      async (url: string) =>
        new Response(
          url.endsWith('catalog.json')
            ? JSON.stringify(catalog)
            : new Uint8Array(bytes.length),
        ),
    );
    expect(await f.invoke('import_media', input)).toMatchObject({
      isError: true,
      error: { message: expect.stringContaining('file check') },
    });
    f.setView({
      ...f.current!,
      version: { id: 'past' } as ProjectView['version'],
    });
    expect(await f.invoke('import_media', input)).toMatchObject({
      isError: true,
    });
    expect(f.imported).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'navigation', 'busy'])(
    'retires a downloaded sound before import on %s',
    async (change) => {
      const f = fixture();
      const controller = new AbortController();
      f.fetcher.mockImplementation(async (url: string) => {
        if (url.endsWith('catalog.json'))
          return new Response(JSON.stringify(catalog));
        if (change === 'cancel') controller.abort();
        else if (change === 'navigation') f.setView(null);
        else f.setView({ ...f.current!, busy: true });
        return new Response(bytes);
      });
      expect(
        await f.invoke(
          'import_media',
          { projectId: f.project.id, soundId: sound.id },
          controller.signal,
        ),
      ).toMatchObject({ isError: true });
      expect(f.imported).not.toHaveBeenCalled();
    },
  );
});
