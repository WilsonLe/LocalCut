import type { SavedChatMessage } from '../storage/chats';
import type { RestoredChatTurn } from '../ai';
/** Restore completed text exchanges only. Historical tool rows grant no authority. */
export function completedChatTurns(
  messages: readonly SavedChatMessage[],
  retainedIds?: readonly string[],
): RestoredChatTurn[] {
  const turns: RestoredChatTurn[] = [];
  let user: string | undefined;
  for (const message of messages) {
    if (message.role === 'user') user = message.text;
    else {
      if (
        user !== undefined &&
        message.status === 'complete' &&
        (!retainedIds || retainedIds.includes(message.id))
      )
        turns.push({ id: message.id, user, assistant: message.text });
      user = undefined;
    }
  }
  return turns;
}
