// Google's documented prebuilt voice characteristics:
// https://ai.google.dev/gemini-api/docs/speech-generation#voice-options
const geminiVoiceStyles: Record<string, string> = {
  Zephyr: 'Bright',
  Puck: 'Upbeat',
  Charon: 'Informative',
  Kore: 'Firm',
  Fenrir: 'Excitable',
  Leda: 'Youthful',
  Orus: 'Firm',
  Aoede: 'Breezy',
  Callirrhoe: 'Easy-going',
  Autonoe: 'Bright',
  Enceladus: 'Breathy',
  Iapetus: 'Clear',
  Umbriel: 'Easy-going',
  Algieba: 'Smooth',
  Despina: 'Smooth',
  Erinome: 'Clear',
  Algenib: 'Gravelly',
  Rasalgethi: 'Informative',
  Laomedeia: 'Upbeat',
  Achernar: 'Soft',
  Alnilam: 'Firm',
  Schedar: 'Even',
  Gacrux: 'Mature',
  Pulcherrima: 'Forward',
  Achird: 'Friendly',
  Zubenelgenubi: 'Casual',
  Vindemiatrix: 'Gentle',
  Sadachbia: 'Lively',
  Sadaltager: 'Knowledgeable',
  Sulafat: 'Warm',
};

/** Display metadata never changes the advertised voice ID sent to synthesis. */
export function speechVoiceLabel(model: string, voice: string): string {
  const style = model.startsWith('google/gemini-')
    ? Object.hasOwn(geminiVoiceStyles, voice)
      ? geminiVoiceStyles[voice]
      : undefined
    : undefined;
  return style ? `${voice} · ${style}` : voice;
}

/** Guidance only: multilingual word boundaries and a 120–180 wpm narration range. */
export function speechLengthEstimate(script: string) {
  const words = [
    ...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(script),
  ].filter((part) => part.isWordLike).length;
  return {
    words,
    minSeconds: (words / 180) * 60,
    maxSeconds: (words / 120) * 60,
  };
}
