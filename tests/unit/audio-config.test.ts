import { expect, it } from 'vitest';
import {
  normalizeAudioDecoderConfig,
  normalizeEncodedAudioMetadata,
} from '../../src/media/audio-config';

// Captured from Safari 27.0's native 48 kHz stereo AAC encoder using a
// synthetic impulse. The AudioSpecificConfig is nested inside ES/decoder tags.
const webkitDescription = new Uint8Array([
  3, 128, 128, 128, 34, 0, 0, 0, 4, 128, 128, 128, 20, 64, 20, 0, 24, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 5, 128, 128, 128, 2, 17, 144, 6, 128, 128, 128, 1, 2,
]);
const config = (description: AllowSharedBufferSource): AudioDecoderConfig => ({
  codec: 'mp4a.40.2',
  sampleRate: 48000,
  numberOfChannels: 2,
  description,
});

it('extracts Safari AAC configuration for the decoder and muxer without mutating metadata', () => {
  const metadata = { decoderConfig: config(webkitDescription) };
  const normalized = normalizeEncodedAudioMetadata(metadata)!;
  expect(
    new Uint8Array(normalized.decoderConfig!.description as ArrayBuffer),
  ).toEqual(new Uint8Array([0x11, 0x90]));
  expect(normalized.decoderConfig).toMatchObject({
    codec: 'mp4a.40.2',
    sampleRate: 48000,
    numberOfChannels: 2,
  });
  expect(metadata.decoderConfig.description).toBe(webkitDescription);
  expect(normalized.decoderConfig).not.toBe(metadata.decoderConfig);
});

it('respects an encoded description view offset', () => {
  const buffer = new Uint8Array(webkitDescription.length + 6);
  buffer.set(webkitDescription, 3);
  const normalized = normalizeAudioDecoderConfig(
    config(new DataView(buffer.buffer, 3, webkitDescription.length)),
  );
  expect(normalized.description).toEqual(new Uint8Array([0x11, 0x90]));
});

it('preserves valid Chrome AAC and non-AAC configurations', () => {
  const chrome = config(new Uint8Array([0x11, 0x90]));
  expect(normalizeAudioDecoderConfig(chrome)).toBe(chrome);
  const opus = { ...config(webkitDescription), codec: 'opus' };
  expect(normalizeAudioDecoderConfig(opus)).toBe(opus);
  expect(normalizeEncodedAudioMetadata(undefined)).toBeUndefined();
  expect(normalizeEncodedAudioMetadata({})).toEqual({});
});

it.each([
  webkitDescription.slice(0, -1),
  new Uint8Array([3, 0xff, 0xff, 0xff, 0xff]),
  new Uint8Array([3, 1, 0]),
  new Uint8Array([0, 0]),
])('rejects malformed AAC descriptors explicitly: %j', (description) => {
  expect(() => normalizeAudioDecoderConfig(config(description))).toThrowError(
    'The AAC encoder returned an invalid audio configuration',
  );
});
