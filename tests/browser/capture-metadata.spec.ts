import { expect, test } from '@playwright/test';
import {
  Input,
  BlobSource,
  WEBM,
  Output,
  BufferTarget,
  Mp4OutputFormat,
  MovOutputFormat,
  EncodedPacketSink,
  EncodedVideoPacketSource,
} from 'mediabunny';
import type { Editor } from '../../src/editor';
import { captureFixture, embedExif } from '../capture-metadata-fixture';
import { mediaVideo } from './workspace-video-fixture';

declare global {
  interface Window {
    captureEditor: Editor;
    captureNamespace: string;
    captureProject: string;
    captureAssets: string[];
  }
}
for (const base of ['/', '/LocalCut/']) {
  test(`capture metadata survives native imports, indexes, reload and backups ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const originals = await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(64, 36),
        ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'red';
      ctx.fillRect(0, 0, 64, 36);
      const results = [];
      for (const type of ['image/jpeg', 'image/png', 'image/webp'])
        results.push({
          type,
          bytes: [
            ...new Uint8Array(
              await (await canvas.convertToBlob({ type })).arrayBuffer(),
            ),
          ],
        });
      return results;
    });
    const movie = await mediaVideo(page);
    const input = new Input({
      formats: [WEBM],
      source: new BlobSource(new Blob([movie.buffer])),
    });
    const files = originals.map(({ type, bytes }) => ({
      type,
      bytes: [...embedExif(new Uint8Array(bytes), type)],
    }));
    try {
      const track = (await input.getPrimaryVideoTrack())!;
      for (const format of [
        new Mp4OutputFormat({ metadataFormat: 'mdta' }),
        new MovOutputFormat({ metadataFormat: 'mdta' }),
      ]) {
        const source = new EncodedVideoPacketSource(track.codec!),
          target = new BufferTarget();
        const output = new Output({ format, target });
        output.addVideoTrack(source);
        output.setMetadataTags({
          raw: {
            'com.apple.quicktime.creationdate': '2024-06-15T12:34:56+1000',
            'com.apple.quicktime.location.ISO6709': '-27.5000+153.2500-12.0/',
          },
        });
        await output.start();
        const config = (await track.getDecoderConfig())!;
        for await (const packet of new EncodedPacketSink(track).packets())
          await source.add(packet, { decoderConfig: config });
        source.close();
        await output.finalize();
        files.push({
          type: format.mimeType,
          bytes: [...new Uint8Array(target.buffer!)],
        });
      }
    } finally {
      input.dispose();
    }
    const imported = await page.evaluate(
      async ({ base, files }) => {
        const { createEditor } = (await import(
          base + 'editor.js'
        )) as typeof import('../../src/editor');
        const namespace = 'test-capture-' + crypto.randomUUID(),
          editor = await createEditor({ namespace });
        window.captureEditor = editor;
        window.captureNamespace = namespace;
        const assets = [];
        for (const file of files)
          assets.push(
            await editor.assets.import(
              new File([new Uint8Array(file.bytes)], 'capture', {
                type: file.type,
                lastModified: 1,
              }),
              file.type,
            ).completion,
          );
        window.captureAssets = assets.map((a) => a.id);
        const project = await editor.projects.create('Capture');
        window.captureProject = project.id;
        await editor.commands.apply({
          projectId: project.id,
          expectedRevision: 0,
          requestId: 'assemble',
          operations: [
            { type: 'addTrack', track: { id: 'v', kind: 'video' } },
            ...assets.map((asset, i) => ({
              type: 'insertClip' as const,
              trackId: 'v',
              clip: {
                id: 'c-' + i,
                kind: asset.kind,
                assetId: asset.id,
                startUs: i * 1000000,
                durationUs: asset.kind === 'image' ? 1000000 : asset.durationUs,
                ...(asset.kind === 'video'
                  ? { sourceOutUs: asset.durationUs }
                  : {}),
              },
            })),
          ],
        });
        return assets.map((a) => a.capture);
      },
      { base, files },
    );
    expect(imported.slice(0, 3)).toEqual([
      captureFixture,
      captureFixture,
      captureFixture,
    ]);
    for (const capture of imported.slice(3))
      expect(capture).toEqual({
        time: {
          value: '2024-06-15T12:34:56+10:00',
          source: 'quicktime-creationdate',
        },
        location: { ...captureFixture.location, source: 'quicktime-location' },
      });
    const namespace = await page.evaluate(() => window.captureNamespace);
    try {
      const proof = await page.evaluate(async (base) => {
        const editor = window.captureEditor;
        const { createAssetIndexer } = (await import(
          base + 'ai.js'
        )) as typeof import('../../src/ai');
        const prompts: string[] = [];
        let failSummary = false;
        const label = {
          summary: 'Red image',
          subjects: ['shape'],
          scene: 'plain',
          style: 'flat',
          tags: ['red'],
          sound: 'none',
        };
        const provider = {
          status: () => ({ connected: true }),
          listModels: async () => [
            {
              id: 'synthetic',
              supportsTools: true,
              inputModalities: ['image'],
            },
          ],
          label: async (request: { prompt: string; media: unknown[] }) => {
            prompts.push(request.prompt);
            if (failSummary && !request.media.length)
              throw new Error('Synthetic summary failure');
            const scene = request.media.length
              ? /"sceneId":"([^"]+)"/.exec(request.prompt)?.[1]
              : undefined;
            return {
              text: JSON.stringify(scene ? { sceneId: scene, label } : label),
              model: 'synthetic',
            };
          },
        } as unknown as import('../../src/ai').OpenRouter;
        for (const includeCaptureMetadata of [false, true]) {
          const indexer = createAssetIndexer({
            editor,
            provider,
            model: 'synthetic',
            consent: () => true,
            includeCaptureMetadata,
          });
          try {
            await indexer.run(window.captureAssets[0]!).completion;
          } finally {
            await indexer.dispose();
          }
        }
        let partialRun = '';
        failSummary = true;
        const partial = createAssetIndexer({
          editor,
          provider,
          model: 'synthetic',
          consent: () => true,
          includeCaptureMetadata: true,
          onRunId: (id) => {
            partialRun = id;
          },
        });
        let partialFailed: boolean;
        try {
          partialFailed = await partial
            .run(window.captureAssets[0]!)
            .completion.then(
              () => false,
              () => true,
            );
        } finally {
          await partial.dispose();
        }
        failSummary = false;
        const beforeRetry = prompts.length;
        const retry = createAssetIndexer({
          editor,
          provider,
          model: 'synthetic',
          consent: () => true,
          includeCaptureMetadata: false,
        });
        let retryCode: string | undefined;
        try {
          retryCode = await retry
            .run(window.captureAssets[0]!, partialRun)
            .completion.then(
              () => undefined,
              (error: { code?: string }) => error.code,
            );
        } finally {
          await retry.dispose();
        }
        const indexes = await editor.assets.indexes.list(
          window.captureAssets[0]!,
        );
        const backup = await editor.projects.exportJSON(window.captureProject);
        const restored = await editor.projects.importJSON(backup);
        const restoredAssets = await Promise.all(
          restored.tracks.flatMap((t) =>
            t.clips.map((c) => editor.assets.inspect(c.assetId!)),
          ),
        );
        const workspace = await editor.workspace.snapshot(
          [window.captureProject],
          true,
        );
        const selection = {
          projectIds: [window.captureProject],
          includeVersions: true,
          assetIds: window.captureAssets,
        };
        const file = await editor.workspace.export(selection).completion;
        const { readWorkspaceArchive } = (await import(
          base + 'editor.js'
        )) as typeof import('../../src/editor');
        const archive = await readWorkspaceArchive(file);
        const restoredWorkspace = await editor.workspace.import(
          archive,
          selection,
        ).completion;
        const workspaceAssets = await Promise.all(
          restoredWorkspace[0]!.tracks.flatMap((t) =>
            t.clips.map((c) => editor.assets.inspect(c.assetId!)),
          ),
        );
        return {
          prompts,
          retry: {
            partialFailed,
            retryCode,
            beforeRetry,
            afterRetry: prompts.length,
          },
          indexes: indexes.map((r) => ({
            capture: r.source.capture,
            captureShared: !!r.captureShared,
            manifests: r.requests.map((m) => !!m.captureIncluded),
          })),
          restored: restoredAssets.map((a) => a.capture),
          workspace: workspace.assets.map((a) => a.capture),
          workspaceRestored: workspaceAssets.map((a) => a.capture),
        };
      }, base);
      expect(proof.prompts.slice(0, 2).join(' ')).not.toContain('2024-06-15');
      expect(proof.retry.partialFailed).toBe(true);
      expect(proof.retry.retryCode).toBe('INVALID_COMMAND');
      expect(proof.retry.afterRetry).toBe(proof.retry.beforeRetry);
      expect(
        proof.prompts
          .slice(2)
          .every((p) => p.includes('2024-06-15') && p.includes('153.25')),
      ).toBe(true);
      expect(proof.indexes).toEqual(
        expect.arrayContaining([
          {
            capture: captureFixture,
            captureShared: false,
            manifests: [false, false],
          },
          {
            capture: captureFixture,
            captureShared: true,
            manifests: [true, true],
          },
        ]),
      );
      expect(proof.restored).toEqual(imported);
      expect(proof.workspace).toEqual(expect.arrayContaining(imported));
      expect(proof.workspaceRestored).toEqual(imported);
      await page.evaluate(() => window.captureEditor.dispose());
      await page.reload();
      const reloaded = await page.evaluate(
        async ({ base, namespace }) => {
          const { createEditor } = (await import(
            base + 'editor.js'
          )) as typeof import('../../src/editor');
          const editor = await createEditor({ namespace });
          window.captureEditor = editor;
          return (await editor.projects.list()).length;
        },
        { base, namespace },
      );
      expect(reloaded).toBe(3);
      const retained = await page.evaluate(async () => {
        const editor = window.captureEditor,
          projects = await editor.projects.list(),
          project = await editor.projects.snapshot(projects[0]!.id);
        return Promise.all(
          project.tracks.flatMap((t) =>
            t.clips.map(
              async (c) => (await editor.assets.inspect(c.assetId!)).capture,
            ),
          ),
        );
      });
      expect(retained).toEqual(imported);
    } finally {
      await page.evaluate(async (namespace) => {
        await window.captureEditor?.dispose();
        for (const suffix of ['-v1', '-asset-index-v1', '-tasks-v1'])
          await new Promise<void>((resolve, reject) => {
            const request = indexedDB.deleteDatabase(namespace + suffix);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
          });
        await (
          await navigator.storage.getDirectory()
        ).removeEntry(namespace, { recursive: true });
      }, namespace);
    }
  });
}
