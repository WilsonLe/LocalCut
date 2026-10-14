import { AiError, aiInvariant } from './errors';
import { REFERENCE_SPEECH_MODEL, SPEECH_REFERENCE_BYTES } from './speech';
import { changeVoicePresets, readVoicePresets } from './voice-presets';
import type { VoicePreset, VoiceSettings } from './voice-presets';
import type {
  SpeechConnection,
  SpeechTaskResult,
} from './speech-task-contract';
import type { GeneratedSpeech } from './agent-speech';

export function savedVoices() {
  try {
    return readVoicePresets();
  } catch {
    throw new AiError(
      'AUTH_STORAGE_UNAVAILABLE',
      'Allow browser storage to read saved voice configurations.',
    );
  }
}

/** Only the existing generated-reference sidecar is readable; never project originals. */
export async function voiceReference(preset: VoicePreset, signal: AbortSignal) {
  aiInvariant(
    preset.referenceId,
    'INVALID_REQUEST',
    'This saved voice has no speaker reference. Reuse its settings or generate a shorter reference take.',
  );
  const { readVoiceReference } = await import('../storage/voice-references');
  const reference = await readVoiceReference(preset.referenceId);
  signal.throwIfAborted();
  aiInvariant(
    reference && reference.file.size <= SPEECH_REFERENCE_BYTES,
    'INVALID_REQUEST',
    'The saved generated voice reference is missing or too large. Restore it or reuse the saved settings.',
  );
  const bytes = new Uint8Array(await reference.file.arrayBuffer());
  signal.throwIfAborted();
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return { data: btoa(binary), transcript: reference.transcript };
}

export const settingsOf = (preset: VoiceSettings): VoiceSettings => ({
  model: preset.model,
  voice: preset.voice,
  languages: preset.languages,
  instructions: preset.instructions,
  timing: preset.timing,
  elevenlabs: preset.elevenlabs,
});

/** Save script-independent settings and an unretimed generated reference separately. */
export async function saveGeneratedVoice(
  connection: SpeechConnection,
  take: SpeechTaskResult,
  publication: GeneratedSpeech,
  settings: VoiceSettings,
  selectedPreset: VoicePreset | undefined,
  name: string | undefined,
  script: string,
  signal: AbortSignal,
): Promise<GeneratedSpeech> {
  const current = savedVoices();
  const matching =
    (selectedPreset && (!name || selectedPreset.name === name)
      ? selectedPreset
      : undefined) ??
    current.find(
      (preset) =>
        !preset.archived &&
        (!name || preset.name === name) &&
        JSON.stringify(settingsOf(preset)) ===
          JSON.stringify(settingsOf(settings)),
    );
  const matches =
    matching &&
    JSON.stringify(settingsOf(matching)) ===
      JSON.stringify(settingsOf(settings));
  const id = matches ? matching.id : publication.generationId;
  const existing = current.find((preset) => preset.id === id);
  aiInvariant(
    !existing?.archived,
    'INVALID_REQUEST',
    'This voice configuration was archived. Restore it or save a new voice.',
  );
  if (existing?.referenceId && existing.source)
    return {
      ...publication,
      voicePresetId: id,
      referenceSaved: !!existing.referenceId,
    };
  let referenceId =
    existing?.referenceId ??
    (selectedPreset?.referenceId &&
    (settings.model === REFERENCE_SPEECH_MODEL ||
      (settings.model === selectedPreset.model &&
        settings.voice === selectedPreset.voice))
      ? selectedPreset.referenceId
      : undefined);
  const { saveVoiceReference, removeVoiceReference } =
    await import('../storage/voice-references');
  let createdReference = false;
  try {
    if (
      !referenceId &&
      take.audio.samples.length * 2 + 44 <= SPEECH_REFERENCE_BYTES
    ) {
      const original = await connection.api.renderSpeech(
        take.audio,
        { mode: 'speed', speed: 1 },
        signal,
      );
      signal.throwIfAborted();
      referenceId = id;
      await saveVoiceReference(id, {
        file: original.file,
        transcript: script,
        timing: take.transcript,
      });
      createdReference = true;
    }
    signal.throwIfAborted();
    changeVoicePresets((presets) => {
      // Another tab can have published this same immutable generation meanwhile.
      const found = presets.find((preset) => preset.id === id);
      aiInvariant(
        !found?.archived,
        'INVALID_REQUEST',
        'The saved voice was archived while generation was running. Restore it before reuse.',
      );
      if (found)
        return presets.map((preset) =>
          preset.id === id
            ? {
                ...preset,
                ...(referenceId ? { referenceId } : {}),
                source: preset.source ?? {
                  projectId: publication.projectId,
                  assetId: publication.assetId,
                  transcriptId: publication.transcriptId,
                  generationId: publication.generationId,
                  createdAt: Date.now(),
                },
              }
            : preset,
        );
      return [
        ...presets,
        {
          ...settingsOf(settings),
          id,
          name: name ?? `Narrator ${settings.voice} ${id.slice(0, 8)}`,
          archived: false,
          ...(referenceId ? { referenceId } : {}),
          source: {
            projectId: publication.projectId,
            assetId: publication.assetId,
            transcriptId: publication.transcriptId,
            generationId: publication.generationId,
            createdAt: Date.now(),
          },
        },
      ];
    });
  } catch (error) {
    if (createdReference) {
      try {
        if (!readVoicePresets().some((p) => p.referenceId === id))
          await removeVoiceReference(id);
      } catch {
        /* Preserve a reference when another publisher may own it. */
      }
    }
    if (signal.aborted || error instanceof AiError) throw error;
    throw new AiError(
      'AUTH_STORAGE_UNAVAILABLE',
      'The narration is saved, but reusable voice metadata could not be stored. Allow browser storage and explicitly retry the saved generation; synthesis will be reused.',
      { assetId: publication.assetId, transcriptId: publication.transcriptId },
    );
  }
  return { ...publication, voicePresetId: id, referenceSaved: !!referenceId };
}
