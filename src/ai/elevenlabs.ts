import { z } from 'zod';

/** OpenRouter's documented ElevenLabs passthrough; never arbitrary provider JSON. */
export const elevenLabsSchema = z
  .object({
    stability: z.number().min(0).max(1).optional(),
    similarity_boost: z.number().min(0).max(1).optional(),
    speed: z.number().min(0.7).max(1.2).optional(),
    style: z.number().min(0).max(1).optional(),
    use_speaker_boost: z.boolean().optional(),
    seed: z.number().int().min(0).max(4294967295).optional(),
    language_code: z
      .string()
      .regex(/^[a-z]{2}$/)
      .optional(),
    apply_text_normalization: z.enum(['auto', 'on', 'off']).optional(),
    apply_language_text_normalization: z.boolean().optional(),
    pronunciation_dictionary_locators: z
      .array(
        z
          .object({
            pronunciation_dictionary_id: z.string().trim().min(1).max(256),
            version_id: z.string().trim().min(1).max(256).optional(),
          })
          .strict(),
      )
      .max(3)
      .optional(),
    previous_text: z.string().max(5000).optional(),
    next_text: z.string().max(5000).optional(),
  })
  .strict();
export type ElevenLabsSettings = z.infer<typeof elevenLabsSchema>;
export const ELEVENLABS_DEFAULT_MODEL = 'elevenlabs/eleven-multilingual-v2';
const models = new Set([
  'elevenlabs/eleven-multilingual-v2',
  'elevenlabs/eleven-v4',
  'elevenlabs/eleven-v4-turbo',
  'elevenlabs/eleven-v3',
  'elevenlabs/eleven-v3-conversational',
  'elevenlabs/eleven-flash-v2.5',
  'elevenlabs/eleven-turbo-v2.5',
  'elevenlabs/eleven-flash-v2',
  'elevenlabs/eleven-turbo-v2',
]);
export function elevenLabsCapabilities(model: string) {
  if (!models.has(model)) return undefined;
  const v3 = model.includes('/eleven-v3');
  const v4 = model.includes('/eleven-v4');
  return {
    similarity: !v3,
    speed: !v3 && !v4,
    style: !v4,
    speakerBoost: !v3 && !v4,
    language: model !== ELEVENLABS_DEFAULT_MODEL,
  };
}
export function validElevenLabsSettings(
  model: string,
  value: unknown,
): value is ElevenLabsSettings {
  const c = elevenLabsCapabilities(model);
  const parsed = elevenLabsSchema.safeParse(value);
  if (!c || !parsed.success) return false;
  const v = parsed.data;
  return (
    (c.similarity || v.similarity_boost === undefined) &&
    (c.speed || v.speed === undefined) &&
    (c.style || v.style === undefined) &&
    (c.speakerBoost || v.use_speaker_boost === undefined) &&
    (c.language || v.language_code === undefined) &&
    (!v.apply_language_text_normalization || v.language_code === 'ja')
  );
}
/** Retain compatible choices on model changes without sending unsupported controls. */
export function compatibleElevenLabsSettings(
  model: string,
  value: ElevenLabsSettings,
): ElevenLabsSettings {
  const c = elevenLabsCapabilities(model);
  if (!c) return {};
  const {
    similarity_boost,
    speed,
    style,
    use_speaker_boost,
    language_code,
    apply_language_text_normalization,
    ...rest
  } = value;
  return {
    ...rest,
    ...(c.language ? { language_code, apply_language_text_normalization } : {}),
    ...(c.similarity && similarity_boost !== undefined
      ? { similarity_boost }
      : {}),
    ...(c.speed && speed !== undefined ? { speed } : {}),
    ...(c.style && style !== undefined ? { style } : {}),
    ...(c.speakerBoost && use_speaker_boost !== undefined
      ? { use_speaker_boost }
      : {}),
  };
}
export function elevenLabsOptions(settings: ElevenLabsSettings) {
  const {
    stability,
    similarity_boost,
    speed,
    style,
    use_speaker_boost,
    ...options
  } = elevenLabsSchema.parse(settings);
  const voice_settings = {
    stability,
    similarity_boost,
    speed,
    style,
    use_speaker_boost,
  };
  return { ...options, voice_settings };
}
