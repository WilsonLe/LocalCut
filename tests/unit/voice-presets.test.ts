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
