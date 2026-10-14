import { z } from 'zod';
import { EditorError } from '../core/errors';
import { safeChatFailure } from '../core/error-diagnostics';
import { Jobs } from '../services/jobs';
import type { Editor } from '../editor';
import {
  padSpeechTranscript,
  retimeSpeechTranscript,
} from '../core/transcript-timing';
import { AiError, aiInvariant } from './errors';
import type { AiErrorCode } from './errors';
import type { SpeechTaskInput } from './speech-task-contract';
import { SPEECH_LIMITS, speechBody } from './speech';
import { elevenLabsSchema } from './elevenlabs';
import {
  savedVoices,
  voiceReference,
  saveGeneratedVoice,
  settingsOf,
  voiceVersion,
} from './voice-reuse';
import { REFERENCE_SPEECH_MODEL } from './speech';
import type { VoicePreset } from './voice-presets';
import { registerSpeechTasks } from './speech-tasks';
import {
  speechRoute,
  speechTaskKind,
  speechTimingRoute,
} from './speech-task-contract';
import type {
  SpeechConnection,
  SpeechTaskResult,
} from './speech-task-contract';

export const speechGenerationSchema = z
  .object({
    voiceVersion: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    voicePresetId: z.string().min(1).max(80).optional(),
    reuseMode: z.enum(['settings', 'reference']).optional(),
    saveVoiceName: z.string().trim().min(1).max(100).optional(),
    generationId: z.string().min(1).max(200).optional(),
    script: z
      .string()
      .min(1)
      .max(SPEECH_LIMITS.scriptCharacters)
      .refine(
        (script) => !!script.trim(),
        'Provide a nonempty narration script.',
      ),
    model: z.string().min(1).max(256).optional(),
    voice: z.string().min(1).max(80).optional(),
    languages: z.array(z.string().min(1).max(80)).max(8).optional(),
    instructions: z
      .string()
      .max(SPEECH_LIMITS.instructionsCharacters)
      .optional(),
    elevenlabs: elevenLabsSchema.optional(),
    timing: z
      .discriminatedUnion('mode', [
        z
          .object({
            mode: z.literal('speed'),
            speed: z.number().min(0.5).max(2),
          })
          .strict(),
        z
          .object({
            mode: z.literal('duration'),
            durationSeconds: z.number().positive(),
          })
          .strict(),
      ])
      .optional(),
    name: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type SpeechGeneration = z.infer<typeof speechGenerationSchema>;
export interface GeneratedSpeech {
  voicePresetId?: string;
  referenceSaved?: boolean;
  projectId: string;
  generationId: string;
  assetId: string;
  transcriptId: string;
  libraryRevision: number;
  durationUs: number;
  sampleRate: number;
  channels: number;
  model: string;
  voice: string;
}
export interface AssistantSpeech {
  disclosure: string;
  inspect(signal: AbortSignal): Promise<{
    models: import('./types').SpeechModel[];
    selectedModel?: string;
    selectedVoice?: string;
    savedVoices?: (VoicePreset & { version?: string })[];
    timingReady: boolean;
    timingRoute: string;
  }>;
  generate(
    projectId: string,
    input: SpeechGeneration,
  ): import('../services/jobs').Job<GeneratedSpeech>;
}

/** Host-owned route. No provider credentials, source uploads or voice references in tools. */
export function createAssistantSpeech(
  editor: Editor,
  connection: SpeechConnection,
  selected:
    | { model?: string; voice?: string }
    | (() => { model?: string; voice?: string } | undefined) = {},
): AssistantSpeech {
  const localTiming =
    connection.provider.transcriptionDisclosure.includes('runs locally');
  const inspect: AssistantSpeech['inspect'] = async (signal) => {
    const models = await connection.provider.listSpeechModels(signal);
    signal.throwIfAborted();
    const timingReady =
      !localTiming || (await editor.transcription.status()).ready;
    signal.throwIfAborted();
    const selection =
      (typeof selected === 'function' ? selected() : selected) ?? {};
    return {
      models,
      savedVoices: await Promise.all(
        savedVoices().map(async (preset) => ({
          ...preset,
          version: await voiceVersion(preset),
        })),
      ),
      selectedModel: selection.model,
      selectedVoice: selection.voice,
      timingReady,
      timingRoute: connection.provider.transcriptionDisclosure,
    };
  };
  return {
    disclosure:
      'Sends the authored narration script, language and voice settings to the connected OpenRouter TTS model. Phrase timing uses the configured STT route, which may send newly generated audio to OpenRouter. Provider charges may apply. A specifically selected saved generated speaker reference and its matching transcript may be sent for reference-model reuse. Original project media is never uploaded.',
    inspect,
    generate(projectId, value) {
      let generationId: string | undefined;
      const job = new Jobs().start<GeneratedSpeech>(
        async (signal, progress) => {
          const input = speechGenerationSchema.parse(value);
          if (input.generationId) {
            const task = await editor.tasks.get(input.generationId);
            const original = (await editor.tasks.input(input.generationId)) as
              SpeechTaskInput | undefined;
            aiInvariant(
              task?.projectId === projectId &&
                task.kind === speechTaskKind(connection) &&
                original?.route === speechRoute(connection) &&
                original.timingRoute === speechTimingRoute(connection),
              'INVALID_REQUEST',
              'The saved generation does not belong to this project and configured speech route.',
            );
            const requested = {
              ...original.request,
              script: input.script,
              ...(input.model ? { model: input.model } : {}),
              ...(input.voice ? { voice: input.voice } : {}),
              ...(input.languages ? { languages: input.languages } : {}),
              ...(input.instructions !== undefined
                ? { instructions: input.instructions }
                : {}),
              ...(input.elevenlabs ? { elevenlabs: input.elevenlabs } : {}),
            };
            aiInvariant(
              speechBody(requested) === speechBody(original.request) &&
                (!input.timing ||
                  JSON.stringify(input.timing) ===
                    JSON.stringify(original.timing)) &&
                (input.reuseMode !== 'reference' ||
                  original.request.model === REFERENCE_SPEECH_MODEL),
              'INVALID_REQUEST',
              'Recover a saved take with its original script, model, voice and timing settings.',
            );
            if (task.state === 'completed') {
              const cached = (await editor.tasks.checkpoint(task.id)) as
                SpeechTaskResult | undefined;
              if (
                cached?.publication?.voicePresetId &&
                savedVoices().some(
                  (p) => p.id === cached.publication!.voicePresetId,
                )
              ) {
                aiInvariant(
                  !input.voicePresetId ||
                    input.voicePresetId === cached.publication.voicePresetId,
                  'INVALID_REQUEST',
                  'This saved take belongs to a different voice configuration.',
                );
                const asset = await editor.assets.inspect(
                  cached.publication.assetId,
                );
                signal.throwIfAborted();
                aiInvariant(
                  asset.status === 'ready',
                  'EDIT_REJECTED',
                  'The saved narration asset is unavailable. Restore it before placement.',
                );
                return cached.publication;
              }
            }
          }
          const state = await inspect(signal);
          const preset = input.voicePresetId
            ? state.savedVoices?.find(
                (p) => p.id === input.voicePresetId && !p.archived,
              )
            : undefined;
          aiInvariant(
            !input.voicePresetId || preset,
            'INVALID_REQUEST',
            'The saved voice is missing or archived. Inspect saved voices and choose an active stable ID.',
          );
          aiInvariant(
            !input.voiceVersion || input.voiceVersion === preset?.version,
            'REVISION_CONFLICT',
            'The saved voice settings changed. Inspect the current voice and request a fresh proposal before synthesis.',
          );
          const referenceReuse =
            input.reuseMode === 'reference' ||
            preset?.model === REFERENCE_SPEECH_MODEL;
          aiInvariant(
            !referenceReuse || preset,
            'INVALID_REQUEST',
            'Reference reuse requires a specifically selected saved generated voice.',
          );
          const modelId =
            input.model ||
            (referenceReuse ? REFERENCE_SPEECH_MODEL : preset?.model) ||
            state.selectedModel ||
            state.models.find((m) => !m.referenceVoice)?.id;
          const model = state.models.find((m) => m.id === modelId);
          aiInvariant(
            model && (!model.referenceVoice || !!preset?.referenceId),
            'MODEL_REQUIRED',
            'Choose an advertised speech model. Reference synthesis requires a selected saved generated voice.',
          );
          aiInvariant(
            input.reuseMode !== 'reference' || model.referenceVoice,
            'INVALID_REQUEST',
            'Reference reuse requires an advertised reference-capable model; do not substitute ordinary preset synthesis.',
          );
          const voice =
            (model.referenceVoice
              ? 'reference'
              : input.voice || preset?.voice) ||
            (model.id === state.selectedModel
              ? state.selectedVoice
              : undefined) ||
            model.voices[0];
          aiInvariant(
            voice &&
              (model.referenceVoice
                ? voice === 'reference'
                : model.voices.includes(voice)),
            'INVALID_REQUEST',
            'Choose an advertised voice for this speech model.',
          );
          aiInvariant(
            state.timingReady,
            'MODEL_REQUIRED',
            'Prepare the selected local transcription model before generating narration, or explicitly change the STT route in AI settings.',
          );
          const timing = input.timing ??
            (preset?.timing?.mode === 'speed' ? preset.timing : undefined) ?? {
              mode: 'speed' as const,
              speed: 1,
            };
          const languages = input.languages ?? preset?.languages ?? [];
          const instructions = model.referenceVoice
            ? undefined
            : (input.instructions ?? preset?.instructions ?? '');
          const elevenlabs =
            input.elevenlabs ??
            (model.id === preset?.model ? preset?.elevenlabs : undefined);
          connection.api.validateSpeechTiming(timing);
          const request = {
            model: model.id,
            voice,
            script: input.script,
            languages,
            instructions,
            elevenlabs,
            ...(model.referenceVoice
              ? { reference: await voiceReference(preset!, signal) }
              : {}),
          };
          speechBody(request); // Validate before any paid submission.
          const settings = {
            model: request.model,
            voice: request.voice,
            languages,
            instructions: instructions ?? '',
            timing,
            elevenlabs,
          };
          aiInvariant(
            (state.savedVoices?.length ?? 0) < 100 ||
              state.savedVoices?.some(
                (p) =>
                  !p.archived &&
                  (!input.saveVoiceName || p.name === input.saveVoiceName) &&
                  JSON.stringify(settingsOf(p)) ===
                    JSON.stringify(settingsOf(settings)),
              ),
            'INVALID_REQUEST',
            'The saved voice library is full. Reuse an active matching voice configuration before generating another voice.',
          );
          const unregister = registerSpeechTasks(editor, connection);
          try {
            let queued: import('../services/jobs').Job<SpeechTaskResult>;
            if (input.generationId) {
              const task = await editor.tasks.get(input.generationId);
              const original = (await editor.tasks.input(
                input.generationId,
              )) as SpeechTaskInput | undefined;
              aiInvariant(
                task?.projectId === projectId &&
                  task.kind === speechTaskKind(connection) &&
                  original?.route === speechRoute(connection) &&
                  original.timingRoute === speechTimingRoute(connection),
                'INVALID_REQUEST',
                'The saved take does not belong to this project and configured speech route.',
              );
              aiInvariant(
                speechBody(original.request) === speechBody(request) &&
                  JSON.stringify(original.timing) === JSON.stringify(timing),
                'INVALID_REQUEST',
                'Retry a saved take with its original script, model, voice and timing settings.',
              );
              if (task.state === 'completed') {
                const result = await editor.tasks.result<SpeechTaskResult>(
                  task.id,
                );
                queued = {
                  id: task.id,
                  completion: Promise.resolve(result),
                  cancel() {},
                  subscribe: () => () => {},
                };
              } else {
                signal.throwIfAborted();
                generationId = task.id;
                queued = (await editor.tasks.retry(
                  task.id,
                )) as import('../services/jobs').Job<SpeechTaskResult>;
              }
            } else {
              queued = editor.tasks.enqueue<SpeechTaskResult>(
                speechTaskKind(connection),
                {
                  request,
                  timing,
                  projectId,
                  route: speechRoute(connection),
                  timingProvider: 'configured',
                  timingRoute: speechTimingRoute(connection),
                },
                { label: 'Generating narration', projectId },
              );
            }
            generationId = queued.id;
            const abort = () => queued.cancel();
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
            const unsubscribe = queued.subscribe((event) => progress(event));
            let take: SpeechTaskResult;
            try {
              signal.throwIfAborted();
              take = await queued.completion;
            } finally {
              signal.removeEventListener('abort', abort);
              unsubscribe();
            }
            signal.throwIfAborted();
            const savedTake = (await editor.tasks.checkpoint(queued.id)) as
              SpeechTaskResult | undefined;
            if (savedTake?.publication) {
              aiInvariant(
                savedTake.publication.projectId === projectId,
                'INVALID_REQUEST',
                'The saved narration belongs to another project.',
              );
              const existing = await editor.assets.inspect(
                savedTake.publication.assetId,
              );
              aiInvariant(
                existing.status === 'ready',
                'EDIT_REJECTED',
                'The saved narration asset is unavailable. Restore it before placement.',
              );
              const publication = await saveGeneratedVoice(
                connection,
                take,
                savedTake.publication,
                {
                  model: request.model,
                  voice: request.voice,
                  languages,
                  instructions: instructions ?? '',
                  elevenlabs,
                  timing,
                },
                preset,
                input.saveVoiceName,
                request.script,
                signal,
              );
              await editor.tasks.saveCheckpoint(queued.id, {
                ...take,
                publication,
              });
              return publication;
            }
            progress({ stage: 'Saving narration in Media…' });
            let imported = savedTake?.imported;
            let asset: import('../editor').Asset;
            if (imported) {
              aiInvariant(
                imported.projectId === projectId,
                'INVALID_REQUEST',
                'The imported narration belongs to another project.',
              );
              asset = await editor.assets.inspect(imported.assetId);
              aiInvariant(
                asset.status === 'ready',
                'EDIT_REJECTED',
                'The imported narration asset is unavailable. Restore it before recovery.',
              );
            } else {
              const importing = editor.assets.import(
                take.rendered.file,
                input.name ?? 'Narration.wav',
              );
              const cancelImport = () => importing.cancel();
              signal.addEventListener('abort', cancelImport, { once: true });
              if (signal.aborted) cancelImport();
              try {
                signal.throwIfAborted();
                asset = await importing.completion;
              } finally {
                signal.removeEventListener('abort', cancelImport);
              }
              // A successful import is committed even if cancellation arrived
              // after commit. Retain its identity before observing cancellation.
              imported = { projectId, assetId: asset.id };
              await editor.tasks.saveCheckpoint(queued.id, {
                ...take,
                imported,
              });
            }
            signal.throwIfAborted();
            aiInvariant(
              take.transcript,
              'INVALID_RESPONSE',
              'Generated narration has no measured phrase timing.',
            );
            const originalDurationUs = Math.round(
              (take.audio.samples.length / take.audio.sampleRate) * 1e6,
            );
            const measured = retimeSpeechTranscript(
              take.transcript,
              originalDurationUs,
              asset.durationUs,
            );
            let transcriptId = imported.transcriptId;
            if (!transcriptId) {
              const transcript = await editor.transcription.attach(
                asset.id,
                padSpeechTranscript(measured, asset.durationUs),
                {
                  script: request.script,
                  model: request.model,
                  voice: request.voice,
                  languages: request.languages,
                  instructions: request.instructions,
                  originalDurationUs,
                  measuredCues: measured.cues,
                  paddingUs: 80_000,
                },
              );
              transcriptId = transcript.id;
              imported = { ...imported, transcriptId };
              await editor.tasks.saveCheckpoint(queued.id, {
                ...take,
                imported,
              });
            }
            signal.throwIfAborted();
            const library = await editor.library
              .forProject(projectId)
              .place(asset.id, []);
            const publication = {
              projectId,
              generationId: queued.id,
              assetId: asset.id,
              transcriptId,
              libraryRevision: library.revision,
              durationUs: asset.durationUs,
              sampleRate: asset.sampleRate!,
              channels: asset.channels!,
              model: request.model,
              voice: request.voice,
            };
            await editor.tasks.saveCheckpoint(queued.id, {
              ...take,
              publication,
            });
            const completed = await saveGeneratedVoice(
              connection,
              take,
              publication,
              {
                model: request.model,
                voice: request.voice,
                languages,
                instructions: instructions ?? '',
                elevenlabs,
                timing,
              },
              preset,
              input.saveVoiceName,
              request.script,
              signal,
            );
            await editor.tasks.saveCheckpoint(queued.id, {
              ...take,
              publication: completed,
            });
            return completed;
          } finally {
            unregister();
          }
        },
        {
          acceptCommittedResult: true,
          error: (error) => {
            if (error instanceof AiError)
              return new AiError(error.code, error.message, {
                ...error.details,
                generationId,
                paidSubmission: generationId !== undefined,
              });
            const safe = safeChatFailure(error);
            if (safe.code !== 'UNKNOWN')
              return new AiError(
                safe.code as AiErrorCode,
                'Narration task failed (' +
                  safe.code +
                  '). Retry the saved generation explicitly to reuse its audio checkpoint.',
                {
                  ...safe.details,
                  generationId,
                  paidSubmission: generationId !== undefined,
                },
              );
            if (error instanceof EditorError)
              return new AiError(
                'EDIT_REJECTED',
                error.code === 'QUOTA_EXCEEDED'
                  ? 'Browser storage is full. Free space, then explicitly retry the saved narration generation.'
                  : 'Narration Media publication failed. Explicitly retry the saved generation to reuse its completed audio.',
                {
                  editorCode: error.code,
                  generationId,
                  paidSubmission: generationId !== undefined,
                },
              );
            return new AiError(
              'INVALID_RESPONSE',
              'Narration generation failed. Retry the saved generation explicitly to reuse completed synthesis.',
              { generationId, paidSubmission: generationId !== undefined },
            );
          },
        },
      );
      const completion = job.completion.catch((error: unknown) => {
        // Jobs intentionally replaces abort failures with a generic CANCELLED
        // error. Preserve the saved generation's recovery identity for callers.
        if (error instanceof EditorError && error.code === 'CANCELLED')
          throw new AiError(
            'CANCELLED',
            'Narration generation cancelled. Completed stages remain saved for explicit recovery.',
            {
              generationId,
              paidSubmission: generationId !== undefined,
            },
          );
        throw error;
      });
      void completion.catch(() => {});
      return { ...job, completion };
    },
  };
}
