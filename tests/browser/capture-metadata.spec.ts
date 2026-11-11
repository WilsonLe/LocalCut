import { behaviorBases } from './coverage-bases';
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
for (const base of behaviorBases) {
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
    await page.evaluate(async () => window.captureEditor.dispose());
  });
}
