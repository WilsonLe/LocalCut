import type { SavedChatMessage } from '../storage/chats';
import type { RestoredChatTurn } from '../ai';
import { interruptedChatText } from '../ai/chat-context';
/** Restore text context only. Historical tool rows grant no authority. */
export function restoredChatTurns(
  messages: readonly SavedChatMessage[],
  retainedIds?: readonly string[],
  indexScope?: string,
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
          user: interrupted ? (message.continuation?.user ?? user) : user,
          assistant: interrupted
            ? message.continuation &&
              message.continuation.indexScope === indexScope
              ? message.continuation.assistant
              : // Legacy/mismatched display records cannot prove observation provenance.
                interruptedChatText('')
            : message.text,
          ...(interrupted ? { interrupted: true } : {}),
        });
      user = undefined;
    }
  }
  return turns;
}
