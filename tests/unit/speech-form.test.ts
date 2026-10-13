import { describe, expect, it } from 'vitest';
import {
  speechLengthEstimate,
  speechVoiceLabel,
} from '../../src/workspace/speech-form';

describe('speech form guidance', () => {
  it('uses word boundaries across scripts and ignores empty punctuation', () => {
    expect(speechLengthEstimate('...\n😀')).toEqual({
      words: 0,
      minSeconds: 0,
      maxSeconds: 0,
    });
    expect(speechLengthEstimate('Hello! Xin chào!')).toEqual({
      words: 3,
      minSeconds: 1,
      maxSeconds: 1.5,
    });
    expect(speechLengthEstimate('你好世界').words).toBeGreaterThan(0);
    expect(speechLengthEstimate('word '.repeat(120))).toEqual({
      words: 120,
      minSeconds: 40,
      maxSeconds: 60,
    });
  });
  it('labels supported Gemini voices and preserves unknown/provider-specific names', () => {
    expect(speechVoiceLabel('google/gemini-3.8-flash-tts', 'Kore')).toBe(
      'Kore · Firm',
    );
    expect(speechVoiceLabel('google/gemini-3.8-flash-tts', 'FutureVoice')).toBe(
      'FutureVoice',
    );
    expect(speechVoiceLabel('fish-audio/s2.1-pro', 'reference')).toBe(
      'reference',
    );
    expect(speechVoiceLabel('another/provider', 'Kore')).toBe('Kore');
    expect(speechVoiceLabel('google/gemini-3.8-flash-tts', 'constructor')).toBe(
      'constructor',
    );
  });
});
