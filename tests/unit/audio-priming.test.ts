import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('measures priming when the native AAC encoder returns an ES descriptor', async () => {
  const closes = { encoder: vi.fn(), decoder: vi.fn(), sample: vi.fn() };
  const decoderConfigure = vi.fn();
  vi.stubGlobal(
    'AudioData',
    class {
      close = closes.sample;
    },
  );
  vi.stubGlobal(
    'AudioEncoder',
    class {
      state = 'configured';
      constructor(private callbacks: AudioEncoderInit) {}
      configure() {}
      encode() {}
      async flush() {
        this.callbacks.output({} as EncodedAudioChunk, {
          decoderConfig: {
            codec: 'mp4a.40.2',
            numberOfChannels: 2,
            sampleRate: 48000,
            description: new Uint8Array([
              3, 128, 128, 128, 34, 0, 0, 0, 4, 128, 128, 128, 20, 64, 20, 0,
              24, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 128, 128, 128, 2, 17, 144, 6,
              128, 128, 128, 1, 2,
            ]),
          },
        });
      }
      close = closes.encoder;
    },
  );
  vi.stubGlobal(
    'AudioDecoder',
    class {
      state = 'configured';
      constructor(private callbacks: AudioDecoderInit) {}
      configure(config: AudioDecoderConfig) {
        decoderConfigure(config);
        if (
          (config.description as Uint8Array).length !== 2 ||
          (config.description as Uint8Array)[0] !== 0x11
        )
          throw new DOMException(
            'InternalAudioDecoderCocoa decoding failed',
            'EncodingError',
          );
      }
      decode() {}
      async flush() {
        this.callbacks.output({
          numberOfFrames: 8192,
          timestamp: 0,
          copyTo(data: Float32Array) {
            data[4096 + 2112] = 1;
          },
          close: closes.sample,
        } as unknown as AudioData);
      }
      close = closes.decoder;
    },
  );
  const { audioPrimingFrames } = await import('../../src/media/audio-priming');
  await expect(
    audioPrimingFrames({
      codec: 'mp4a.40.2',
      numberOfChannels: 2,
      sampleRate: 48000,
      bitrate: 192000,
    }),
  ).resolves.toBe(2112);
  expect(decoderConfigure).toHaveBeenCalledWith({
    codec: 'mp4a.40.2',
    numberOfChannels: 2,
    sampleRate: 48000,
    description: new Uint8Array([0x11, 0x90]),
  });
  expect(closes.encoder).toHaveBeenCalledOnce();
  expect(closes.decoder).toHaveBeenCalledOnce();
  expect(closes.sample).toHaveBeenCalledTimes(2);
});
