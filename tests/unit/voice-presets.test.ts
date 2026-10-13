import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  changeVoicePresets,
  parseVoicePresets,
  VOICE_PRESETS_KEY,
} from '../../src/workspace/voice-presets';

const preset = {
  id: 'test-preset',
  name: 'Narrator',
  model: 'google/gemini-3.8-flash-tts',
  voice: 'Kore',
  languages: ['English'],
  instructions: 'Calm',
  archived: false,
};
const record = (presets: unknown) => JSON.stringify({ version: 1, presets });
afterEach(() => vi.unstubAllGlobals());
describe('voice preset persistence', () => {
  it('round-trips ElevenLabs options with explicit zero/false and rejects unsupported or arbitrary settings', () => {
    const saved = {
      ...preset,
      model: 'elevenlabs/eleven-flash-v2.5',
      voice: 'george',
      instructions: '',
      languages: [],
      elevenlabs: {
        seed: 0,
        stability: 0.5,
        similarity_boost: 0.75,
        speed: 0.95,
        style: 0,
        use_speaker_boost: false,
        language_code: 'ja',
        apply_text_normalization: 'off',
        apply_language_text_normalization: true,
        pronunciation_dictionary_locators: [
          { pronunciation_dictionary_id: 'dictionary' },
        ],
        previous_text: 'Before.',
        next_text: 'After.',
      },
    };
    expect(parseVoicePresets(record([saved, preset]))).toEqual([saved]); // duplicate identity
    expect(
      parseVoicePresets(record([saved, { ...preset, id: 'legacy' }])),
    ).toEqual([saved, { ...preset, id: 'legacy' }]);
    for (const invalid of [
      { ...saved, model: preset.model },
      { ...saved, model: 'elevenlabs/eleven-multilingual-v2' },
      { ...saved, model: 'elevenlabs/eleven-v4' },
      { ...saved, elevenlabs: { seed: 1.5 } },
      { ...saved, elevenlabs: { speed: 0.6 } },
      { ...saved, elevenlabs: { apiKey: 'secret' } },
    ])
      expect(parseVoicePresets(record([invalid]))).toEqual([]);
    const reference = {
      ...saved,
      model: 'fish-audio/s2.1-pro',
      voice: 'reference',
      referenceId: 'original-take',
      elevenlabs: undefined,
    };
    expect(parseVoicePresets(record([reference]))).toEqual([
      { ...reference, elevenlabs: undefined },
    ]);
    let raw = record([saved]);
    vi.stubGlobal('localStorage', {
      getItem: () => raw,
      setItem: (_key: string, value: string) => {
        raw = value;
      },
    });
    changeVoicePresets((items) =>
      items.map((item) => ({
        ...item,
        archived: true,
        name: 'Reused narrator',
      })),
    );
    expect(parseVoicePresets(raw)).toEqual([
      { ...saved, archived: true, name: 'Reused narrator' },
    ]);
    changeVoicePresets((items) =>
      items.map((item) => ({
        ...item,
        model: preset.model,
        voice: 'Kore',
        languages: ['English'],
        elevenlabs: undefined,
      })),
    );
    expect(parseVoicePresets(raw)[0]).not.toHaveProperty('elevenlabs');
  });
  it('rejects invalid data and duplicates, and strips non-preset fields', () => {
    for (const raw of [
      null,
      '{',
      '[]',
      JSON.stringify({ version: 2, presets: [preset] }),
    ])
      expect(parseVoicePresets(raw)).toEqual([]);
    expect(
      parseVoicePresets(
        record([
          {
            ...preset,
            script: 'private script',
            apiKey: 'secret',
            name: ' Narrator ',
          },
          preset,
          { ...preset, id: 'bad', voice: '' },
          { ...preset, id: 'bad2', languages: [] },
          { ...preset, id: 'bad3', instructions: 'a'.repeat(1501) },
        ]),
      ),
    ).toEqual([preset]);
    expect(
      parseVoicePresets(record([{ ...preset, archived: true }]))[0]?.archived,
    ).toBe(true);
  });
  it('patches current storage and preserves unrelated and archived presets', () => {
    let raw = record([preset]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === VOICE_PRESETS_KEY ? raw : null),
      setItem: (_key: string, value: string) => {
        raw = value;
      },
    });
    changeVoicePresets((items) => [
      ...items,
      { ...preset, id: 'second', archived: true },
    ]);
    changeVoicePresets((items) =>
      items.map((item) =>
        item.id === preset.id ? { ...item, name: 'Renamed' } : item,
      ),
    );
    expect(parseVoicePresets(raw)).toEqual([
      { ...preset, name: 'Renamed' },
      { ...preset, id: 'second', archived: true },
    ]);
    expect(() => changeVoicePresets((items) => [...items, preset])).toThrow(
      'valid voice settings',
    );
  });
  it('preserves reference identity through rename/archive and rejects malformed reference IDs', () => {
    const saved = { ...preset, referenceId: 'saved-voice' };
    expect(parseVoicePresets(record([saved]))).toEqual([saved]);
    expect(
      parseVoicePresets(
        record([{ ...saved, name: 'Renamed', archived: true }]),
      ),
    ).toEqual([{ ...saved, name: 'Renamed', archived: true }]);
    expect(
      parseVoicePresets(
        record([{ ...saved, referenceId: 'https://remote.test/audio' }]),
      ),
    ).toEqual([]);
    // Legacy settings survive; they are not upgraded to a fictional voice profile.
    expect(parseVoicePresets(record([preset]))).toEqual([preset]);
  });
  it('retains timing independently of transcripts and strips nested content', () => {
    for (const timing of [
      { mode: 'speed', speed: 1.35 },
      { mode: 'duration', durationSeconds: 12.5 },
    ]) {
      const saved = { ...preset, timing };
      expect(
        parseVoicePresets(
          record([
            {
              ...saved,
              transcript: 'private',
              script: 'private',
              audio: 'bytes',
              timing: { ...timing, script: 'private', transcript: 'private' },
            },
          ]),
        ),
      ).toEqual([saved]);
    }
    for (const timing of [
      null,
      {},
      { mode: 'speed', speed: 0.4 },
      { mode: 'speed', speed: 2.1 },
      { mode: 'speed', speed: '1' },
      { mode: 'duration', durationSeconds: 0 },
      { mode: 'duration', durationSeconds: -2 },
      { mode: 'duration', durationSeconds: '12' },
    ]) {
      expect(parseVoicePresets(record([{ ...preset, timing }]))).toEqual([]);
    }
  });
  it('fails visibly on denied reads or writes without silently replacing records', () => {
    const write = vi.fn(() => {
      throw new Error('QuotaExceededError');
    });
    vi.stubGlobal('localStorage', {
      getItem: () => record([preset]),
      setItem: write,
    });
    expect(() => changeVoicePresets(() => [])).toThrow('Allow browser storage');
    expect(write).toHaveBeenCalledTimes(1);
    write.mockClear();
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: write,
    });
    expect(() => changeVoicePresets(() => [])).toThrow('Allow browser storage');
    expect(write).not.toHaveBeenCalled();
  });
});
