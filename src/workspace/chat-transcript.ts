import type { SavedChatMessage } from '../storage/chats';
import type { RestoredChatTurn } from '../ai';
import { interruptedChatText } from '../ai/chat-context';
/** Restore text context only. Historical tool rows grant no authority. */
export function restoredChatTurns(
  messages: readonly SavedChatMessage[],
  retainedIds?: readonly string[],
): RestoredChatTurn[] {
  const turns: RestoredChatTurn[] = [];
  let user: string | undefined;
  for (const message of messages) {
    if (message.role === 'user') user = message.text;
    else {
      const interrupted =
        message.status === 'interrupted' ||
        message.status === 'paused' ||
        message.status === 'streaming' ||
        message.status === 'failed';
      if (
        user !== undefined &&
        (message.status === 'complete' || interrupted) &&
        (!retainedIds ||
          retainedIds.includes(message.id) ||
          // The last unfinished response may predate history retention or a crash.
          (interrupted && message === messages.at(-1)))
      )
        turns.push({
          id: message.id,
          user,
          assistant: interrupted
            ? interruptedChatText(
                message.text,
                (message.tools ?? []).flatMap((tool) =>
                  tool.phase === 'completed' &&
                  tool.name !== 'load_skill' &&
                  // Proposal display rows alone do not prove an action committed.
                  ((tool.name !== 'propose_edits' &&
                    tool.name !== 'propose_action') ||
                    (tool.result &&
                      typeof tool.result === 'object' &&
                      'status' in tool.result &&
                      tool.result.status === 'completed' &&
                      'result' in tool.result))
                    ? [
                        {
                          name: tool.name,
                          input: tool.input,
                          result: tool.result,
                        },
                      ]
                    : [],
                ),
              )
            : message.text,
          ...(interrupted ? { interrupted: true } : {}),
        });
      user = undefined;
    }
  }
  return turns;
}
