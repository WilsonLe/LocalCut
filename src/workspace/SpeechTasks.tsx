import { useEffect } from 'react';
import type { Editor } from '../editor';
import type { Connection } from './Conversation';
import { speechRoute, speechTaskKind, speechTimingRoute } from './speech-tasks';
import type { SpeechTaskInput, SpeechCheckpoint } from './speech-tasks';
/** Project/connection owns generation; dialog lifetime owns only its preview URL. */
export default function SpeechTasks({
  editor,
  connection,
}: {
  editor: Editor;
  connection: Connection;
}) {
  useEffect(() => {
    const kind = speechTaskKind(connection);
    const unregister = editor.tasks.register(kind, {
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
            task.request,
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
    void editor.tasks.poll().catch(() => {});
    return unregister;
  }, [editor, connection]);
  return null;
}
