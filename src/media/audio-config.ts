import { EditorError } from '../core/errors';

/**
 * WebKit can emit an ES_Descriptor instead of the AAC AudioSpecificConfig.
 * Our direct encoder path must normalize it before both decoding and muxing.
 * https://bugs.webkit.org/show_bug.cgi?id=302253
 */
export function normalizeAudioDecoderConfig(
  config: AudioDecoderConfig,
): AudioDecoderConfig {
  if (!config.codec.startsWith('mp4a.40.') || !config.description)
    return config;
  const source = config.description;
  const bytes = ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);
  // AudioSpecificConfig starts with a nonzero 5-bit audio object type.
  // Only the invalid object-type-zero envelope needs this workaround.
  if (bytes.length < 2 || bytes[0]! >> 3 !== 0) return config;
  const fail = () => {
    throw new EditorError(
      'UNSUPPORTED_CODEC',
      'The AAC encoder returned an invalid audio configuration',
      { codec: config.codec, stage: 'audio-configuration' },
    );
  };
  const descriptor = (offset: number, end: number, expectedTag: number) => {
    if (bytes[offset++] !== expectedTag) return fail();
    let length = 0;
    for (let i = 0; i < 4; i++) {
      if (offset >= end) return fail();
      const value = bytes[offset++]!;
      length = length * 128 + (value & 0x7f);
      if (!(value & 0x80)) {
        if (length > end - offset) return fail();
        return { start: offset, end: offset + length };
      }
    }
    return fail();
  };
  const es = descriptor(0, bytes.length, 3);
  let offset = es.start + 2; // ES_ID
  if (offset >= es.end) return fail();
  const flags = bytes[offset++]!;
  if (flags & 0x80) offset += 2; // dependsOn_ES_ID
  if (flags & 0x40) {
    if (offset >= es.end) return fail();
    offset += 1 + bytes[offset]!; // URLlength and URLstring
  }
  if (flags & 0x20) offset += 2; // OCR_ES_Id
  const decoder = descriptor(offset, es.end, 4);
  // objectTypeIndication, streamType/flags, bufferSizeDB, max/avgBitrate.
  if (decoder.end - decoder.start < 13) return fail();
  if (![0x40, 0x67].includes(bytes[decoder.start]!)) return fail();
  const specific = descriptor(decoder.start + 13, decoder.end, 5);
  if (specific.end - specific.start < 2 || bytes[specific.start]! >> 3 === 0)
    return fail();
  return { ...config, description: bytes.slice(specific.start, specific.end) };
}

export function normalizeEncodedAudioMetadata(
  metadata: EncodedAudioChunkMetadata | undefined,
): EncodedAudioChunkMetadata | undefined {
  if (!metadata?.decoderConfig) return metadata;
  return {
    ...metadata,
    decoderConfig: normalizeAudioDecoderConfig(metadata.decoderConfig),
  };
}
