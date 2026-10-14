import type { Editor } from '../editor';
import { aiInvariant } from './errors';
import { renderSpeech } from './speech-audio';
import { REFERENCE_SPEECH_MODEL, SPEECH_REFERENCE_BYTES } from './speech';
import { changeVoicePresets, readVoicePresets } from './voice-presets';

/** Explicit composer capture only. Never reads arbitrary project originals. */
export async function saveDictationVoice(
  editor: Editor,
  projectId: string,
  recordingId: string,
  audio: Blob,
  transcript: string,
  language: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  aiInvariant(
    /^[A-Za-z0-9_-]{1,80}$/.test(recordingId) &&
      !readVoicePresets().some((p) => p.id === recordingId),
    'INVALID_REQUEST',
    'Use a fresh recording identity.',
  );
  aiInvariant(
    transcript.trim() && transcript.length <= 5000,
    'INVALID_REQUEST',
    'This dictation is too long for a voice reference. Record a shorter sample.',
  );
  const decoder = new AudioContext({ sampleRate: 24000 });
  let file: File;
  try {
    const decoded = await decoder.decodeAudioData(await audio.arrayBuffer());
    signal.throwIfAborted();
    aiInvariant(
      decoded.length > 0 && decoded.length * 2 + 44 <= SPEECH_REFERENCE_BYTES,
      'INVALID_REQUEST',
      'This recording is too long for a voice reference. Record a shorter sample.',
    );
    const samples = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const values = decoded.getChannelData(channel);
      for (let i = 0; i < samples.length; i++)
        samples[i]! += values[i]! / decoded.numberOfChannels;
    }
    for (let i = 0; i < samples.length; i++)
      samples[i] = Math.max(-1, Math.min(1, samples[i]!));
    file = (
      await renderSpeech(
        { samples, sampleRate: 24000 },
        { mode: 'speed', speed: 1 },
        signal,
      )
    ).file;
  } finally {
    await decoder.close();
  }
  signal.throwIfAborted();
  const importing = editor.assets.import(file, 'Dictation recording.wav');
  const abortImport = () => importing.cancel();
  signal.addEventListener('abort', abortImport, { once: true });
  let asset: Awaited<ReturnType<Editor['assets']['inspect']>>;
  try {
    signal.throwIfAborted();
    asset = await importing.completion;
  } finally {
    signal.removeEventListener('abort', abortImport);
  }
  // Import commits independently; keep the original even if a later stage fails.
  await editor.library.forProject(projectId).place(asset.id, []);
  signal.throwIfAborted();
  const attached = await editor.transcription.attach(asset.id, {
    model: 'browser/speech-recognition',
    revision: 'dictation-v1',
    language,
    cues: [
      {
        id: recordingId,
        timeUs: 0,
        endUs: asset.durationUs,
        text: transcript.trim(),
      },
    ],
  });
  signal.throwIfAborted();
  const source = {
    projectId,
    assetId: asset.id,
    transcriptId: attached.id,
    generationId: recordingId,
    createdAt: Date.now(),
    kind: 'dictation' as const,
  };
  const settings = {
    model: REFERENCE_SPEECH_MODEL,
    voice: 'reference',
    languages: [],
    instructions: '',
    timing: { mode: 'speed' as const, speed: 1 },
  };
  const { saveVoiceReference, removeVoiceReference } =
    await import('../storage/voice-references');
  await saveVoiceReference(
    recordingId,
    {
      file,
      transcript: transcript.trim(),
      source,
      configuration: settings,
    },
    true,
  );
  try {
    signal.throwIfAborted();
    changeVoicePresets((current) => {
      aiInvariant(
        !current.some((p) => p.id === recordingId),
        'REVISION_CONFLICT',
        'This recording identity is already saved.',
      );
      return [
        ...current,
        {
          ...settings,
          id: recordingId,
          name: `My voice · ${recordingId.slice(0, 8)}`,
          archived: false,
          referenceId: recordingId,
          source,
        },
      ];
    });
  } catch (error) {
    await removeVoiceReference(recordingId);
    throw error;
  }
  return {
    assetId: asset.id,
    transcriptId: attached.id,
    voicePresetId: recordingId,
  };
}
