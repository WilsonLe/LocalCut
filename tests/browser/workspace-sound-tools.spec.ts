import { expect, test } from '@playwright/test';
import type { Asset, Project } from '../../src/editor';
import type { LibrarySound } from '../../src/core/sound-library';
import { behaviorBases } from './coverage-bases';
import {
  call,
  installHarness,
  projectReady,
  workspaceReady,
} from './webmcp-helper';

for (const base of behaviorBases) {
  test(`agent sound search imports tagged choices into a persistent native timeline ${base}`, async ({
    page,
  }) => {
    await installHarness(page);
    await page.goto(base);
    await workspaceReady(page);
    const { project } = await call<{ project: Project }>(page, 'workspace', {
      action: 'create_project',
      name: 'Tagged sounds',
    });
    await projectReady(page, project.id);
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    const sounds: { sound: LibrarySound; asset: Asset }[] = [];
    for (const query of ['cards shuffle', 'retro victory']) {
      const found = await call<{
        items: (LibrarySound & {
          license: string;
          source: { creator: string };
        })[];
        total: number;
        nextOffset: number;
      }>(page, 'catalog', {
        kind: 'sounds',
        query,
        limit: 1,
        maxDurationUs: 4_000_000,
      });
      expect(found.total).toBeGreaterThan(0);
      expect(found.items[0]!.license).toBe('CC0-1.0');
      expect(found.items[0]!.tags.length).toBeGreaterThan(3);
      expect(found.items[0]!.source.creator).toBeTruthy();
      const paged = await call<{ items: LibrarySound[] }>(page, 'catalog', {
        kind: 'sounds',
        query,
        limit: 1,
        offset: 1,
        maxDurationUs: 4_000_000,
      });
      if (found.total > 1)
        expect(paged.items[0]!.id).not.toBe(found.items[0]!.id);
      else expect(paged.items).toEqual([]);
      expect(
        requests.filter((url) => url.includes('/sounds/audio/')),
      ).toHaveLength(sounds.length);
      const sound = found.items[0]!;
      const job = await call<{ jobId: string }>(page, 'import_media', {
        projectId: project.id,
        soundId: sound.id,
      });
      const imported = await call<{ state: string; result: { asset: Asset } }>(
        page,
        'job',
        { projectId: project.id, jobId: job.jobId, action: 'wait' },
      );
      expect(imported.state).toBe('completed');
      expect(imported.result.asset.name).toBe(`${sound.name}.wav`);
      const wave = await call<{ jobId: string }>(page, 'asset', {
        projectId: project.id,
        assetId: imported.result.asset.id,
        action: 'waveform',
        bins: 32,
      });
      const measured = await call<{ state: string; result: number[] }>(
        page,
        'job',
        { projectId: project.id, jobId: wave.jobId, action: 'wait' },
      );
      expect(measured.state).toBe('completed');
      expect(measured.result.every(Number.isFinite)).toBe(true);
      expect(Math.max(...measured.result.map(Math.abs))).toBeGreaterThan(0);
      sounds.push({ sound, asset: imported.result.asset });
    }
    const inspected = await call<{ project: Project; assets: Asset[] }>(
      page,
      'inspect_project',
    );
    expect(inspected.project.tracks).toHaveLength(0);
    expect(inspected.assets).toHaveLength(2);
    expect(
      await call(page, 'apply_edits', {
        projectId: project.id,
        expectedRevision: inspected.project.revision,
        requestId: 'place-tagged-sounds',
        operations: [
          {
            type: 'addTrack',
            track: {
              id: 'effects',
              kind: 'audio',
              clips: sounds.map(({ sound, asset }, i) => ({
                id: `effect-${i}`,
                kind: 'audio',
                assetId: asset.id,
                startUs: i * 4_000_000,
                sourceInUs: 0,
                sourceOutUs: sound.durationUs,
                durationUs: sound.durationUs,
              })),
            },
          },
        ],
      }),
    ).toMatchObject({ appliedRevision: inspected.project.revision + 1 });
    await page.reload();
    await projectReady(page, project.id);
    const restored = await call<{ project: Project; assets: Asset[] }>(
      page,
      'inspect_project',
    );
    expect(
      restored.project.tracks[0]!.clips.map((clip) => clip.assetId),
    ).toEqual(sounds.map(({ asset }) => asset.id));
    expect(restored.assets).toHaveLength(2);
  });

  test(`agent sound imports reject corrupt bytes and retire downloads before project changes ${base}`, async ({
    page,
  }) => {
    await installHarness(page);
    await page.goto(base);
    await workspaceReady(page);
    const { project } = await call<{ project: Project }>(page, 'workspace', {
      action: 'create_project',
      name: 'Safe sound import',
    });
    await projectReady(page, project.id);
    const { items } = await call<{ items: LibrarySound[] }>(page, 'catalog', {
      kind: 'sounds',
      query: 'cards shuffle',
      limit: 1,
    });
    const input = { projectId: project.id, soundId: items[0]!.id };
    let corrupt = 0;
    await page.route('**/sounds/audio/*.wav', async (route) => {
      corrupt++;
      await route.fulfill({ body: Buffer.alloc(items[0]!.size) });
    });
    expect(await call(page, 'import_media', input)).toMatchObject({
      isError: true,
      error: { message: expect.stringContaining('file check') },
    });
    expect(corrupt).toBe(2);
    expect(
      (await call<{ assets: Asset[] }>(page, 'inspect_project')).assets,
    ).toEqual([]);
    await page.unroute('**/sounds/audio/*.wav');
    let arrived!: () => void, release!: () => void;
    const reached = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/sounds/audio/*.wav', async (route) => {
      arrived();
      await gate;
      await route.continue().catch(() => {});
    });
    const importing = call(page, 'import_media', input);
    try {
      await reached;
      await page.goto(`${base}#/projects`);
      await workspaceReady(page);
    } finally {
      release();
    }
    expect(await importing).toMatchObject({ isError: true });
    await call(page, 'workspace', {
      action: 'open_project',
      projectId: project.id,
    });
    await projectReady(page, project.id);
    expect(
      (await call<{ assets: Asset[] }>(page, 'inspect_project')).assets,
    ).toEqual([]);
  });
}
