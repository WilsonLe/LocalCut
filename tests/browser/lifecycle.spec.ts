import { test, expect } from '@playwright/test';

test('legacy project imports validate references before creating a project', async ({
  page,
}) => {
  await page.goto('/LocalCut/');
  const result = await page.evaluate(async () => {
    const { createEditor } = (await import(
      String('/LocalCut/editor.js')
    )) as typeof import('../../src/editor/index');
    const namespace = 'legacy-' + crypto.randomUUID();
    const editor = await createEditor({ namespace });
    try {
      const canvas = new OffscreenCanvas(16, 16);
      canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
      const asset = await editor.assets.import(await canvas.convertToBlob())
        .completion;
      const project = await editor.projects.create('legacy', {
        width: 16,
        height: 16,
      });
      await editor.commands.apply({
        projectId: project.id,
        requestId: 'setup',
        expectedRevision: 0,
        operations: [
          { type: 'addTrack', track: { id: 'track', kind: 'video' } },
          {
            type: 'insertClip',
            trackId: 'track',
            clip: {
              id: 'clip',
              kind: 'image',
              assetId: asset.id,
              startUs: 0,
              durationUs: 1000000,
              width: 16,
              height: 16,
            },
          },
        ],
      });
      const original = await editor.projects.snapshot(project.id);
      const before = (await editor.projects.list()).length;
      const failures: string[] = [];
      for (const patch of [
        { assetId: 'unknown' },
        { transcriptId: 'unknown-transcript' },
      ]) {
        const invalid = structuredClone(original);
        Object.assign(invalid.tracks[0]!.clips[0]!, patch);
        failures.push(
          await editor.projects.importJSON(JSON.stringify(invalid)).then(
            () => 'unexpected-success',
            (error: { code: string }) => error.code,
          ),
        );
      }
      const afterRejected = (await editor.projects.list()).length;
      const restored = await editor.projects.importJSON(
        JSON.stringify(original),
      );
      return {
        failures,
        before,
        afterRejected,
        restoredRevision: restored.revision,
        differentId: restored.id !== original.id,
        assetId: restored.tracks[0]!.clips[0]!.assetId === asset.id,
        count: (await editor.projects.list()).length,
      };
    } finally {
      await editor.dispose();
    }
  });
  expect(result).toEqual({
    failures: ['MISSING_ASSET', 'INVALID_COMMAND'],
    before: 1,
    afterRejected: 1,
    restoredRevision: 0,
    differentId: true,
    assetId: true,
    count: 2,
  });
});

test('late cancellation discards native exported files and undelivered frames', async ({
  page,
}) => {
  await page.goto('/LocalCut/');
  const result = await page.evaluate(async () => {
    const NativeWorker = globalThis.Worker;
    const descriptor = Object.getOwnPropertyDescriptor(
      NativeWorker.prototype,
      'onmessage',
    )!;
    let onDelivered:
      | ((data: {
          kind?: string;
          data?: { path?: string; image?: ImageBitmap };
        }) => void)
      | undefined;
    globalThis.Worker = new Proxy(NativeWorker, {
      construct(Target, args) {
        const worker = Reflect.construct(Target, args) as Worker;
        let handler: Worker['onmessage'] = null;
        Object.defineProperty(worker, 'onmessage', {
          configurable: true,
          get: () => handler,
          set(value: Worker['onmessage']) {
            handler = value;
            descriptor.set!.call(worker, (event: MessageEvent) => {
              handler?.call(worker, event);
              onDelivered?.(event.data);
            });
          },
        });
        return worker;
      },
    });
    const { createEditor } = (await import(
      String('/LocalCut/editor.js')
    )) as typeof import('../../src/editor/index');
    const namespace = 'delivery-' + crypto.randomUUID();
    const editor = await createEditor({ namespace });
    try {
      const project = await editor.projects.create('delivery', {
        width: 32,
        height: 32,
      });
      await editor.commands.apply({
        projectId: project.id,
        requestId: 'text',
        expectedRevision: 0,
        operations: [
          { type: 'addTrack', track: { id: 'overlay', kind: 'overlay' } },
          {
            type: 'insertClip',
            trackId: 'overlay',
            clip: {
              id: 'text',
              kind: 'text',
              startUs: 0,
              durationUs: 250000,
              width: 32,
              height: 32,
              text: { text: 'A', fontSize: 16 },
            },
          },
        ],
      });
      const failures: string[] = [];
      for (const format of ['mp4', 'webm'] as const) {
        const job = editor.exports.start(project.id, { format });
        onDelivered = (message) => {
          if (
            message.kind === 'result' &&
            message.data?.path?.startsWith('export-')
          )
            job.cancel();
        };
        failures.push(
          await job.completion.then(
            async (artifact) => {
              await artifact.dispose();
              return 'unexpected-success';
            },
            (error: { code: string }) => error.code,
          ),
        );
        onDelivered = undefined;
      }
      let bitmap: ImageBitmap | undefined;
      const frame = editor.preview.frame(project.id, 0);
      onDelivered = (message) => {
        if (message.kind === 'result' && message.data?.image) {
          bitmap = message.data.image;
          frame.cancel();
        }
      };
      failures.push(
        await frame.completion.then(
          (value) => {
            value.image.close();
            return 'unexpected-success';
          },
          (error: { code: string }) => error.code,
        ),
      );
      onDelivered = undefined;
      const root = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle(namespace);
      const files: string[] = [];
      for await (const [name] of root) files.push(name);
      return {
        failures,
        exports: files.filter((name) => name.startsWith('export-')),
        bitmapWidth: bitmap?.width,
      };
    } finally {
      onDelivered = undefined;
      await editor.dispose();
      globalThis.Worker = NativeWorker;
    }
  });
  expect(result).toEqual({
    failures: ['CANCELLED', 'CANCELLED', 'CANCELLED'],
    exports: [],
    bitmapWidth: 0,
  });
});
