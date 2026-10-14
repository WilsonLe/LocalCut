import type { Editor } from '../editor';
import type { SpeechConnection } from './speech-task-contract';
import {
  speechRoute,
  speechTaskKind,
  speechTimingRoute,
  SPEECH_TIMING_FAILURE,
} from './speech-task-contract';
import type { SpeechTaskInput, SpeechCheckpoint } from './speech-task-contract';

/** One queue owner for dialog and agent synthesis, timing and rendering. */
const registrations = new WeakMap<
  Editor,
  Map<SpeechConnection, { users: number; unregister: () => void }>
>();
export function registerSpeechTasks(
  editor: Editor,
  connection: SpeechConnection,
) {
  let owners = registrations.get(editor);
  if (!owners) {
    owners = new Map();
    registrations.set(editor, owners);
  }
  let owner = owners.get(connection);
  if (!owner) {
    owner = { users: 0, unregister: registerHandler(editor, connection) };
    owners.set(connection, owner);
  }
  owner.users++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--owner.users === 0) {
      owner.unregister();
      owners.delete(connection);
    }
  };
}
function registerHandler(editor: Editor, connection: SpeechConnection) {
  const kind = speechTaskKind(connection);
  return editor.tasks.register(kind, {
    cache: {
      mode: 'fresh',
      reason:
        'Generate authorizes a provider submission; same-task audio checkpoints prevent resubmission on retry.',
    },
    lane: 'speech',
    recovery: 'manual',
    retryCodes: ['RATE_LIMITED'],
    maxAttempts: 3,
    execute: async (input, context) => {
      const task = input as SpeechTaskInput;
      if (
        task.route !== speechRoute(connection) ||
        (task.timingProvider === 'configured' &&
          task.timingRoute !== speechTimingRoute(connection))
      )
        throw Object.assign(new Error('Speech route changed'), {
          code: 'AUTH_REQUIRED',
        });
      connection.api.validateSpeechTiming(task.timing);
      let audio = (await editor.tasks.checkpoint(context.id)) as
        SpeechCheckpoint | undefined;
      if (!audio) {
        context.progress({ stage: 'Generating speech…' });
        audio = await connection.provider.synthesizeSpeech(
          { ...task.request, sessionId: context.id },
          context.signal,
        );
        await editor.tasks.saveCheckpoint(context.id, audio);
      }
      context.signal.throwIfAborted();
      if (!audio.transcript) {
        context.progress({ stage: 'Measuring phrase timing…' });
        const measurement = editor.transcription.measure(
          audio.samples,
          audio.sampleRate,
          task.timingProvider === 'configured'
            ? { provider: connection.provider.transcribe }
            : {},
        );
        const abort = () => measurement.cancel();
        context.signal.addEventListener('abort', abort, { once: true });
        try {
          context.signal.throwIfAborted();
          audio = { ...audio, transcript: await measurement.completion };
          await editor.tasks.saveCheckpoint(context.id, audio);
        } catch (cause) {
          context.signal.throwIfAborted();
          throw Object.assign(new Error(SPEECH_TIMING_FAILURE, { cause }), {
            code: (cause as { code?: string })?.code ?? 'INVALID_RESPONSE',
          });
        } finally {
          context.signal.removeEventListener('abort', abort);
        }
      }
      context.signal.throwIfAborted();
      context.progress({ stage: 'Adjusting speech…' });
      const rendered = await connection.api.renderSpeech(
        audio,
        task.timing,
        context.signal,
      );
      return { audio, rendered, transcript: audio.transcript };
    },
  });
}
