import { useEffect } from 'react';
import type { Editor } from '../editor';
import type { SpeechAudio } from '../ai';
import type { Connection } from './Conversation';
import { speechRoute, speechTaskKind } from './speech-tasks';
import type { SpeechTaskInput } from './speech-tasks';
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
      lane: 'speech',
      recovery: 'manual',
      retryCodes: ['RATE_LIMITED'],
      maxAttempts: 3,
      execute: async (input, context) => {
        const task = input as SpeechTaskInput;
        if (task.route !== speechRoute(connection))
          throw Object.assign(new Error('Speech route changed'), {
            code: 'AUTH_REQUIRED',
          });
        connection.api.validateSpeechTiming(task.timing);
        let audio = (await editor.tasks.checkpoint(context.id)) as
          SpeechAudio | undefined;
        if (!audio) {
          context.progress({ stage: 'Generating speech…' });
          audio = await connection.provider.synthesizeSpeech(
            task.request,
            context.signal,
          );
          await editor.tasks.saveCheckpoint(context.id, audio);
        }
        context.signal.throwIfAborted();
        context.progress({ stage: 'Adjusting speech…' });
        const rendered = await connection.api.renderSpeech(
          audio,
          task.timing,
          context.signal,
        );
        return { audio, rendered };
      },
    });
    void editor.tasks.poll().catch(() => {});
    return unregister;
  }, [editor, connection]);
  return null;
}
