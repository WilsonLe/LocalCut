import { expect, test } from '@playwright/test';
import type { ClipInput } from '../../src/core/model';

test('production image imports, transitions, transforms and resolution-scaled effects', async ({
  page,
}) => {
  await page.goto('/LocalCut/');
  const result = await page.evaluate(async () => {
    const { createEditor } = (await import(
      String('/LocalCut/editor.js')
    )) as typeof import('../../src/editor/index');
    const namespace = 'test-media-' + crypto.randomUUID();
    const editor = await createEditor({ namespace });
    const canvas = new OffscreenCanvas(128, 128);
    const context = canvas.getContext('2d')!;
    const source = async (color: string) => {
      context.fillStyle = color;
      context.fillRect(0, 0, 128, 128);
      return editor.assets.import(
        new File([await canvas.convertToBlob()], color + '.png', {
          type: 'image/png',
        }),
      ).completion;
    };
    const framePixels = async (
      projectId: string,
      timeUs: number,
      points: number[][],
      size = 128,
    ) => {
      const frame = await editor.preview.frame(projectId, timeUs, {
        width: size,
        height: size,
      }).completion;
      const target = new OffscreenCanvas(size, size);
      const draw = target.getContext('2d')!;
      try {
        draw.drawImage(frame.image, 0, 0);
        return points.map(([x, y]) => [
          ...draw.getImageData(x!, y!, 1, 1).data,
        ]);
      } finally {
        frame.image.close();
      }
    };
    try {
      const imports = [];
      context.fillStyle = '#ff0000';
      context.fillRect(0, 0, 128, 128);
      for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
        const blob = await canvas.convertToBlob({ type, quality: 1 });
        const file = new File([blob], 'image.' + type.split('/')[1]);
        const asset = await editor.assets.import(file).completion;
        const project = await editor.projects.create(type, {
          width: 128,
          height: 128,
        });
        await editor.commands.apply({
          projectId: project.id,
          requestId: 'image',
          expectedRevision: 0,
          operations: [
            { type: 'addTrack', track: { id: 't', kind: 'video' } },
            {
              type: 'insertClip',
              trackId: 't',
              clip: {
                id: 'c',
                kind: 'image',
                assetId: asset.id,
                startUs: 0,
                durationUs: 1000000,
                width: 128,
                height: 128,
              },
            },
          ],
        });
        imports.push({
          requested: type,
          inputType: file.type,
          kind: asset.kind,
          dimensions: [asset.width, asset.height],
          pixel: (await framePixels(project.id, 0, [[64, 64]]))[0]!,
        });
      }

      const red = await source('red');
      const blue = await source('blue');
      const green = await source('lime');
      const transitions = await editor.projects.create('image transitions', {
        width: 128,
        height: 128,
      });
      await editor.commands.apply({
        projectId: transitions.id,
        requestId: 'assemble',
        expectedRevision: 0,
        operations: [
          { type: 'addTrack', track: { id: 'lower', kind: 'video' } },
          {
            type: 'insertClip',
            trackId: 'lower',
            clip: {
              id: 'lower-image',
              kind: 'image',
              assetId: green.id,
              startUs: 0,
              durationUs: 1500000,
              width: 128,
              height: 128,
            },
          },
          { type: 'addTrack', track: { id: 'upper', kind: 'video' } },
          ...[red, blue].map((asset, index) => ({
            type: 'insertClip' as const,
            trackId: 'upper',
            clip: {
              id: index === 0 ? 'a' : 'b',
              kind: 'image' as const,
              assetId: asset.id,
              startUs: index * 500000,
              durationUs: 1000000,
              width: 128,
              height: 128,
            },
          })),
          {
            type: 'addTransition',
            transition: {
              id: 'blend',
              trackId: 'upper',
              fromClipId: 'a',
              toClipId: 'b',
              kind: 'crossfade',
            },
          },
        ],
      });
      const crossfade = await framePixels(transitions.id, 750000, [[64, 64]]);
      await editor.commands.apply({
        projectId: transitions.id,
        requestId: 'black',
        expectedRevision: 1,
        operations: [
          { type: 'removeTransition', transitionId: 'blend' },
          {
            type: 'addTransition',
            transition: {
              id: 'black',
              trackId: 'upper',
              fromClipId: 'a',
              toClipId: 'b',
              kind: 'black',
            },
          },
        ],
      });
      const black = await framePixels(transitions.id, 750000, [[64, 64]]);

      for (const [color, x, y] of [
        ['red', 0, 0],
        ['lime', 64, 0],
        ['blue', 0, 64],
        ['white', 64, 64],
      ] as const) {
        context.fillStyle = color;
        context.fillRect(x, y, 64, 64);
      }
      const quadrants = await editor.assets.import(
        new File([await canvas.convertToBlob()], 'quadrants.png', {
          type: 'image/png',
        }),
      ).completion;
      const edited = await editor.projects.create('image transforms', {
        width: 128,
        height: 128,
      });
      let revision = 0;
      const change = async (patch: Partial<ClipInput>) => {
        await editor.commands.apply({
          projectId: edited.id,
          requestId: 'edit-' + revision,
          expectedRevision: revision++,
          operations: [{ type: 'updateClip', clipId: 'image', patch }],
        });
      };
      await editor.commands.apply({
        projectId: edited.id,
        requestId: 'create',
        expectedRevision: revision++,
        operations: [
          { type: 'addTrack', track: { id: 't', kind: 'video' } },
          {
            type: 'insertClip',
            trackId: 't',
            clip: {
              id: 'image',
              kind: 'image',
              assetId: quadrants.id,
              startUs: 0,
              durationUs: 1000000,
              width: 64,
              height: 128,
              x: 32,
              crop: { x: 0, y: 0, width: 0.5, height: 1 },
            },
          },
        ],
      });
      const crop = await framePixels(edited.id, 0, [
        [16, 32],
        [48, 32],
        [48, 96],
        [112, 32],
      ]);
      await change({
        width: 128,
        x: 0,
        rotation: 90,
        crop: { x: 0, y: 0, width: 1, height: 1 },
      });
      const rotation = await framePixels(edited.id, 0, [
        [32, 32],
        [96, 32],
        [32, 96],
        [96, 96],
      ]);
      const solid = await source('rgb(100, 140, 180)');
      await change({ assetId: solid.id, rotation: 0, contrast: 2 });
      const contrast = await framePixels(edited.id, 0, [[64, 64]]);
      await change({ contrast: 1, saturation: 0 });
      const saturation = await framePixels(edited.id, 0, [[64, 64]]);
      await change({ brightness: 1.2, contrast: 0.5, saturation: 0 });
      const orderedEffects = await framePixels(edited.id, 0, [[64, 64]]);

      context.fillStyle = 'black';
      context.fillRect(0, 0, 64, 128);
      context.fillStyle = 'white';
      context.fillRect(64, 0, 64, 128);
      const edge = await editor.assets.import(
        new File([await canvas.convertToBlob()], 'edge.png', {
          type: 'image/png',
        }),
      ).completion;
      await change({
        assetId: edge.id,
        brightness: 1,
        contrast: 1,
        saturation: 1,
        blur: 8,
      });
      const halfPoints = Array.from({ length: 16 }, (_, i) => [24 + i, 32]);
      const fullBlur = await framePixels(
        edited.id,
        0,
        halfPoints.map(([x]) => [x! * 2 + 1, 64]),
      );
      const halfBlur = await framePixels(edited.id, 0, halfPoints, 64);
      return {
        imports,
        crossfade,
        black,
        crop,
        rotation,
        contrast,
        saturation,
        orderedEffects,
        fullBlur,
        halfBlur,
      };
    } finally {
      await editor.dispose();
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(namespace + '-v1');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      await (
        await navigator.storage.getDirectory()
      ).removeEntry(namespace, {
        recursive: true,
      });
    }
  });
  for (const image of result.imports) {
    expect(image.inputType).toBe('');
    expect(image.kind).toBe('image');
    expect(image.dimensions).toEqual([128, 128]);
    expect(image.pixel[0]).toBeGreaterThan(245);
    expect(image.pixel[1]).toBeLessThan(10);
    expect(image.pixel[2]).toBeLessThan(10);
  }
  expect(result.crossfade[0]![0]).toBeCloseTo(128, -1);
  expect(result.crossfade[0]![1]).toBe(0);
  expect(result.crossfade[0]![2]).toBeCloseTo(128, -1);
  expect(result.black[0]).toEqual([0, 0, 0, 255]);
  expect(result.crop).toEqual([
    [0, 0, 0, 255],
    [255, 0, 0, 255],
    [0, 0, 255, 255],
    [0, 0, 0, 255],
  ]);
  expect(result.rotation).toEqual([
    [0, 0, 255, 255],
    [255, 0, 0, 255],
    [255, 255, 255, 255],
    [0, 255, 0, 255],
  ]);
  for (const [actual, expected] of result.contrast[0]!.slice(0, 3).map(
    (value, channel) => [value, [73, 153, 233][channel]!],
  )) {
    expect(Math.abs(actual! - expected!)).toBeLessThanOrEqual(2);
  }
  for (const channel of result.saturation[0]!.slice(0, 3))
    expect(Math.abs(channel - 134)).toBeLessThanOrEqual(2);
  for (const channel of result.orderedEffects[0]!.slice(0, 3))
    expect(Math.abs(channel - 144)).toBeLessThanOrEqual(2);
  expect(result.fullBlur[2]![0]).toBeGreaterThan(5);
  expect(result.fullBlur[13]![0]).toBeLessThan(250);
  for (let i = 0; i < result.fullBlur.length; i++)
    expect(
      Math.abs(result.fullBlur[i]![0]! - result.halfBlur[i]![0]!),
    ).toBeLessThanOrEqual(9);
});

test('production audio mixer preserves stereo, overlap, gain envelopes and block continuity', async ({
  page,
}) => {
  await page.goto('/LocalCut/');
  const result = await page.evaluate(async () => {
    const { createEditor } = (await import(
      String('/LocalCut/editor.js')
    )) as typeof import('../../src/editor/index');
    const namespace = 'test-audio-' + crypto.randomUUID();
    const editor = await createEditor({ namespace });
    const audio = new AudioContext({ sampleRate: 48000 });
    const buffers: Float32Array[][] = [];
    const createSource = audio.createBufferSource.bind(audio);
    audio.createBufferSource = () => {
      const source = createSource();
      const start = source.start.bind(source);
      source.start = (when = 0, offset = 0, duration?: number) => {
        buffers.push([
          source.buffer!.getChannelData(0).slice(),
          source.buffer!.getChannelData(1).slice(),
        ]);
        start(when, offset, duration);
      };
      return source;
    };
    let session: ReturnType<typeof editor.preview.session> | undefined;
    const tone = async (
      name: string,
      left: (seconds: number) => number,
      right: (seconds: number) => number,
    ) => {
      const data = new ArrayBuffer(44 + 48000 * 4);
      const view = new DataView(data);
      const text = (offset: number, value: string) => {
        for (let i = 0; i < value.length; i++)
          view.setUint8(offset + i, value.charCodeAt(i));
      };
      text(0, 'RIFF');
      view.setUint32(4, data.byteLength - 8, true);
      text(8, 'WAVE');
      text(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 2, true);
      view.setUint32(24, 48000, true);
      view.setUint32(28, 48000 * 4, true);
      view.setUint16(32, 4, true);
      view.setUint16(34, 16, true);
      text(36, 'data');
      view.setUint32(40, 48000 * 4, true);
      for (let i = 0; i < 48000; i++) {
        view.setInt16(44 + i * 4, Math.round(left(i / 48000) * 32767), true);
        view.setInt16(46 + i * 4, Math.round(right(i / 48000) * 32767), true);
      }
      return editor.assets.import(new File([data], name, { type: 'audio/wav' }))
        .completion;
    };
    const wave = (frequency: number, seconds: number) =>
      Math.sin(2 * Math.PI * frequency * seconds);
    try {
      const first = await tone(
        'first.wav',
        (t) => 0.3 * wave(440, t),
        (t) => 0.22 * wave(880, t),
      );
      const second = await tone(
        'second.wav',
        (t) => 0.1 * wave(660, t),
        (t) => 0.18 * wave(220, t),
      );
      const muted = await tone(
        'muted.wav',
        () => 0.9,
        () => -0.9,
      );
      const project = await editor.projects.create('stereo mix', {
        width: 128,
        height: 128,
      });
      await editor.commands.apply({
        projectId: project.id,
        requestId: 'assembly',
        expectedRevision: 0,
        operations: [
          { type: 'addTrack', track: { id: 'track-a', kind: 'audio' } },
          {
            type: 'insertClip',
            trackId: 'track-a',
            clip: {
              id: 'a',
              kind: 'audio',
              assetId: first.id,
              startUs: 0,
              durationUs: 1000000,
              sourceOutUs: 1000000,
              fadeOutUs: 125000,
              keyframes: {
                gain: [
                  {
                    id: 'gain-start',
                    timeUs: 0,
                    value: 0.8,
                    interpolation: 'linear',
                  },
                  {
                    id: 'gain-loud',
                    timeUs: 500000,
                    value: 5,
                    interpolation: 'hold',
                  },
                ],
              },
            },
          },
          { type: 'addTrack', track: { id: 'track-b', kind: 'audio' } },
          {
            type: 'insertClip',
            trackId: 'track-b',
            clip: {
              id: 'b',
              kind: 'audio',
              assetId: second.id,
              startUs: 125000,
              durationUs: 500000,
              sourceOutUs: 750000,
              speed: 1.5,
              gain: 0.7,
              fadeInUs: 125000,
              fadeOutUs: 125000,
            },
          },
          {
            type: 'addTrack',
            track: { id: 'mute', kind: 'audio', muted: true },
          },
          {
            type: 'insertClip',
            trackId: 'mute',
            clip: {
              id: 'muted',
              kind: 'audio',
              assetId: muted.id,
              startUs: 0,
              durationUs: 1000000,
              sourceOutUs: 1000000,
            },
          },
          { type: 'addTrack', track: { id: 'clip-mute', kind: 'audio' } },
          {
            type: 'insertClip',
            trackId: 'clip-mute',
            clip: {
              id: 'muted-clip',
              kind: 'audio',
              assetId: muted.id,
              startUs: 0,
              durationUs: 1000000,
              sourceOutUs: 1000000,
              muted: true,
            },
          },
        ],
      });
      await audio.resume();
      const presentation = document.createElement('canvas');
      presentation.width = presentation.height = 128;
      session = editor.preview.session(project.id, presentation, audio);
      const errors: string[] = [];
      session.onError((error) => errors.push(error.code));
      await session.play();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      session.pause();
      const count = buffers.reduce(
        (sum, channels) => sum + channels[0]!.length,
        0,
      );
      const mixed = [new Float32Array(count), new Float32Array(count)];
      const joins: number[] = [];
      let offset = 0;
      for (const channels of buffers) {
        if (offset > 0) joins.push(offset);
        mixed[0]!.set(channels[0]!, offset);
        mixed[1]!.set(channels[1]!, offset);
        offset += channels[0]!.length;
      }
      const expected = (frame: number, channel: number) => {
        const t = frame / 48000;
        const gainA =
          Math.min(5, 0.8 + (4.2 * t) / 0.5) * Math.min(1, (1 - t) / 0.125);
        let sample =
          gainA * (channel === 0 ? 0.3 * wave(440, t) : 0.22 * wave(880, t));
        if (t >= 0.125 && t < 0.625) {
          const local = t - 0.125;
          const gainB =
            0.7 *
            Math.min(1, local / 0.125) *
            Math.min(1, (0.5 - local) / 0.125);
          sample +=
            gainB *
            (channel === 0
              ? 0.1 * wave(660, local * 1.5)
              : 0.18 * wave(220, local * 1.5));
        }
        return Math.max(-1, Math.min(1, sample));
      };
      let maxError = 0,
        joinError = 0,
        clipped = 0,
        stereoDifference = 0;
      for (let i = 64; i < count - 64; i += 37) {
        for (let channel = 0; channel < 2; channel++) {
          maxError = Math.max(
            maxError,
            Math.abs(mixed[channel]![i]! - expected(i, channel)),
          );
          if (Math.abs(mixed[channel]![i]!) === 1) clipped++;
        }
        stereoDifference = Math.max(
          stereoDifference,
          Math.abs(mixed[0]![i]! - mixed[1]![i]!),
        );
      }
      for (const join of joins) {
        for (let i = join - 8; i <= join + 8 && i < count; i++) {
          for (let channel = 0; channel < 2; channel++)
            joinError = Math.max(
              joinError,
              Math.abs(mixed[channel]![i]! - expected(i, channel)),
            );
        }
      }
      return {
        count,
        blocks: buffers.length,
        joins: joins.length,
        maxError,
        joinError,
        clipped,
        stereoDifference,
        errors,
      };
    } finally {
      session?.dispose();
      await audio.close();
      await editor.dispose();
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(namespace + '-v1');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      await (
        await navigator.storage.getDirectory()
      ).removeEntry(namespace, { recursive: true });
    }
  });
  expect(result.errors).toEqual([]);
  expect(result.count).toBe(48000);
  expect(result.blocks).toBeGreaterThanOrEqual(4);
  expect(result.joins).toBe(result.blocks - 1);
  expect(result.maxError).toBeLessThan(0.002);
  expect(result.joinError).toBeLessThan(0.002);
  expect(result.clipped).toBeGreaterThan(0);
  expect(result.stereoDifference).toBeGreaterThan(0.5);
});
