import { describe, expect, it, vi } from 'vitest';
import { createOpenRouter } from '../../src/ai/openrouter';
import { SPEECH_LIMITS } from '../../src/ai/speech';
import { renderSpeech } from '../../src/ai/speech-audio';
import type { SpeechRequest } from '../../src/ai/types';

const speech = {
  id: 'google/gemini-3.8-flash-tts',
  name: 'Gemini speech',
  context_length: 0,
  supported_parameters: [],
  architecture: { output_modalities: ['speech'] },
  supported_voices: ['Kore', 'Puck'],
};
const request = (): SpeechRequest => ({
  model: speech.id,
  voice: 'Kore',
  script: 'Hello! Xin chào!',
  languages: ['English', 'Vietnamese'],
  instructions: 'Warm and friendly.',
});
const signal = () => new AbortController().signal;
const tone = (seconds = 1) =>
  Float32Array.from(
    { length: seconds * 24000 },
    (_, i) => Math.sin((i * 2 * Math.PI * 220) / 24000) * 0.4,
  );
function pcm(samples = tone()) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  samples.forEach((sample, i) =>
    view.setInt16(i * 2, Math.round(sample * 32767), true),
  );
  return new Response(buffer, { headers: { 'Content-Type': 'audio/pcm' } });
}
function setup(response: () => Response | Promise<Response> = () => pcm()) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (url) =>
    String(url).includes('/models')
      ? Response.json({ data: [speech] })
      : response(),
  );
  const client = createOpenRouter({ fetch });
  client.setKey('synthetic-private-key');
  return { client, fetch };
}
async function samplesOf(file: File) {
  const data = new DataView(await file.arrayBuffer());
  expect(data.getUint32(24, true)).toBe(24000);
  expect(data.getUint16(22, true)).toBe(1);
  return Float32Array.from(
    { length: (data.byteLength - 44) / 2 },
    (_, i) => data.getInt16(44 + i * 2, true) / 32768,
  );
}
function frequency(samples: Float32Array) {
  // Count complete rising crossings away from overlap/endpoint transients.
  const start = 2400,
    end = samples.length - 2400;
  let count = 0;
  for (let i = start; i < end; i++)
    if (samples[i]! <= 0 && samples[i + 1]! > 0) count++;
  return (count * 24000) / (end - start);
}

describe('OpenRouter speech', () => {
  it('discovers speech models without requiring chat context or tools', async () => {
    const { client } = setup();
    expect(await client.listSpeechModels()).toEqual([
      { id: speech.id, name: speech.name, voices: ['Kore', 'Puck'] },
    ]);
    expect(await client.listModels()).toEqual([]);
    client.dispose();
  });
  it('reuses credentials and sends the verbatim script with multilingual delivery separately', async () => {
    const { client, fetch } = setup();
    const audio = await client.synthesizeSpeech(request(), signal());
    expect(audio.samples.length).toBe(24000);
    const [url, init] = fetch.mock.calls.at(-1)!;
    expect(url).toBe('https://openrouter.ai/api/v1/audio/speech');
    expect(init).toMatchObject({
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer synthetic-private-key',
    });
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      model: speech.id,
      voice: 'Kore',
      input: request().script,
      response_format: 'pcm',
      instructions: expect.stringContaining('English, Vietnamese'),
      provider: { data_collection: 'deny' },
    });
    expect(body.instructions).toContain('Warm and friendly.');
    expect(body.instructions).toContain('Do not translate');
    client.dispose();
  });
  it('rejects invalid scripts, languages and catalog voices before a paid request', async () => {
    const { client, fetch } = setup();
    for (const invalid of [
      { script: '' },
      { script: 'a'.repeat(5001) },
      { languages: [] },
      { languages: ['\n'] },
      { voice: 'Missing' },
      { model: 'openrouter/auto' },
    ])
      await expect(
        client.synthesizeSpeech({ ...request(), ...invalid }, signal()),
      ).rejects.toHaveProperty('code');
    expect(
      fetch.mock.calls.every(([url]) => String(url).includes('/models')),
    ).toBe(true);
    client.dispose();
  });
  it.each([
    () => new Response('secret echoed body', { status: 402 }),
    () => Response.json({ error: 'secret echoed body' }),
    () =>
      new Response(new Uint8Array(3), {
        headers: { 'content-type': 'audio/pcm' },
      }),
    () => new Response(null, { headers: { 'content-type': 'audio/pcm' } }),
    () =>
      new Response(new Uint8Array(2), {
        headers: {
          'content-type': 'audio/pcm',
          'content-length': String(SPEECH_LIMITS.audioBytes + 1),
        },
      }),
  ])(
    'rejects malformed/error audio without leaking provider bodies %#',
    async (response) => {
      const { client } = setup(response);
      await expect(
        client.synthesizeSpeech(request(), signal()),
      ).rejects.not.toHaveProperty(
        'message',
        expect.stringContaining('secret'),
      );
      client.dispose();
    },
  );
  it('rejects late completion after disconnect and credential replacement', async () => {
    let deliver!: (response: Response) => void;
    const { client } = setup(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    const work = client.synthesizeSpeech(request(), signal());
    await vi.waitFor(() => expect(deliver).toBeTypeOf('function'));
    client.setKey('replacement-private-key');
    deliver(pcm());
    await expect(work).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(client.status()).toEqual({ connected: true });
    client.dispose();
  });
  it('cancels a stalled response reader without publishing partial audio', async () => {
    let cancelled = false;
    const { client } = setup(
      () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(20));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { 'content-type': 'audio/pcm' } },
        ),
    );
    const abort = new AbortController();
    const work = client.synthesizeSpeech(request(), abort.signal);
    await vi.waitFor(() => expect(client.status().connected).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    abort.abort();
    await expect(work).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(cancelled).toBe(true);
    client.dispose();
  });
});

describe('pitch-preserving speech timing', () => {
  it.each([0.5, 0.8, 1, 1.5, 2])(
    'bakes exact %s× duration into a WAV while preserving a 220 Hz voice tone',
    async (speed) => {
      const result = await renderSpeech(
        { samples: tone(2), sampleRate: 24000 },
        { mode: 'speed', speed },
        signal(),
      );
      const samples = await samplesOf(result.file);
      expect(samples.length).toBe(Math.round(48000 / speed));
      expect(result.durationUs).toBe(Math.round(2e6 / speed));
      expect(frequency(samples)).toBeCloseTo(220, 0);
      expect(Math.max(...samples)).toBeGreaterThan(0.35);
    },
  );
  it('fits the measured total length to the nearest sample without trimming the ending', async () => {
    const samples = tone(2);
    samples.fill(0.25, samples.length - 240);
    const result = await renderSpeech(
      { samples, sampleRate: 24000 },
      { mode: 'duration', durationSeconds: 1.37 },
      signal(),
    );
    expect(result.durationUs).toBe(1370000);
    const output = await samplesOf(result.file);
    expect(output.at(-1)).toBeCloseTo(0.25, 3);
  });
  it('rejects impossible lengths, invalid speeds and cancellation', async () => {
    const audio = { samples: tone(2), sampleRate: 24000 as const };
    for (const speed of [0, NaN, Infinity, 0.49, 2.01])
      await expect(
        renderSpeech(audio, { mode: 'speed', speed }, signal()),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      renderSpeech(audio, { mode: 'duration', durationSeconds: 0.1 }, signal()),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const abort = new AbortController();
    const work = renderSpeech(
      { samples: tone(10), sampleRate: 24000 },
      { mode: 'speed', speed: 0.5 },
      abort.signal,
    );
    abort.abort();
    await expect(work).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
