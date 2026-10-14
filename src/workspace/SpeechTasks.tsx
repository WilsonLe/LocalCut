import { useEffect } from 'react';
import type { Editor } from '../editor';
import type { Connection } from './Conversation';
import { registerSpeechTasks } from '../ai/speech-tasks';
/** Project/connection owns generation; dialog lifetime owns only its preview URL. */
export default function SpeechTasks({
  editor,
  connection,
}: {
  editor: Editor;
  connection: Connection;
}) {
  useEffect(() => {
    const unregister = registerSpeechTasks(editor, connection);
    void editor.tasks.poll().catch(() => {});
    return unregister;
  }, [editor, connection]);
  return null;
}
