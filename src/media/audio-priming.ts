import { invariant } from '../core/errors';
const delays = new Map<string, Promise<number>>();
/** WebCodecs does not expose AAC priming. Measure the exact native encoder/decoder pair once. */
export function audioPrimingFrames(
  config: AudioEncoderConfig,
): Promise<number> {
  if (config.codec !== 'mp4a.40.2') return Promise.resolve(0);
  const key = JSON.stringify(config);
  let result = delays.get(key);
  if (result) return result;
  result = measure(config);
  delays.set(key, result);
  void result.catch(() => delays.delete(key));
  return result;
}
async function measure(config: AudioEncoderConfig) {
  const impulse = 4096,
    count = 12000,
    channels = config.numberOfChannels,
    data = new Float32Array(count * channels);
  for (let c = 0; c < channels; c++) data[c * count + impulse] = 1;
  const packets: EncodedAudioChunk[] = [];
  let decoderConfig: AudioDecoderConfig | undefined, error: unknown;
  const encoder = new AudioEncoder({
    output(chunk, meta) {
      packets.push(chunk);
      decoderConfig ??= meta?.decoderConfig;
    },
    error(e) {
      error = e;
    },
  });
  let decoder: AudioDecoder | undefined;
  try {
    encoder.configure(config);
    const sample = new AudioData({
      data,
      format: 'f32-planar',
      numberOfChannels: channels,
      numberOfFrames: count,
      sampleRate: config.sampleRate,
      timestamp: 0,
    });
    try {
      encoder.encode(sample);
    } finally {
      sample.close();
    }
    await encoder.flush();
    if (error) throw error;
    invariant(
      decoderConfig,
      'UNSUPPORTED_CODEC',
      'Audio encoder omitted decoder configuration',
    );
    let peak = 0,
      index = -1;
    decoder = new AudioDecoder({
      output(sample) {
        try {
          const pcm = new Float32Array(sample.numberOfFrames);
          sample.copyTo(pcm, { format: 'f32-planar', planeIndex: 0 });
          for (let i = 0; i < pcm.length; i++)
            if (Math.abs(pcm[i]!) > peak) {
              peak = Math.abs(pcm[i]!);
              index =
                Math.round((sample.timestamp * config.sampleRate) / 1e6) + i;
            }
        } finally {
          sample.close();
        }
      },
      error(e) {
        error = e;
      },
    });
    decoder.configure(decoderConfig);
    for (const packet of packets) decoder.decode(packet);
    await decoder.flush();
    if (error) throw error;
    const delay = index - impulse;
    invariant(
      peak > 0.01 && delay >= 0 && delay <= 8192,
      'UNSUPPORTED_CODEC',
      'Cannot measure native AAC priming',
    );
    return delay;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    if (decoder && decoder.state !== 'closed') decoder.close();
  }
}
