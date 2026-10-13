import type { SavedChatMessage } from '../storage/chats';
import type { RestoredChatTurn } from '../ai';
import { interruptedChatText } from '../ai/chat-context';
/** Restore immutable history only. Historical tool rows grant no authority. */
export function restoredChatTurns(
  messages: readonly SavedChatMessage[],
  _retainedIds?: readonly string[],
  _indexScope?: string,
): RestoredChatTurn[] {
  // Accepted for old callers, but these markers cannot retire immutable history.
  void _retainedIds;
  void _indexScope;
  const turns: RestoredChatTurn[] = [];
  let user: string | undefined;
  for (const message of messages) {
    if (message.role === 'user') user = message.text;
    else {
      const interrupted = message.status !== 'complete';
      if (user !== undefined) {
        const request = interrupted
          ? (message.continuation?.user ?? user)
          : user;
        const answer = interrupted
          ? (message.continuation?.assistant ??
            interruptedChatText(message.text, message.tools ?? []))
          : message.text;
        const exchange =
          message.exchange ??
          message.continuation?.exchange ??
          (message.tools?.length
            ? [
                { role: 'user' as const, content: request },
                { role: 'assistant' as const, content: answer },
                {
                  role: 'system' as const,
                  content:
                    'Historical tool activity (captured by an older app; no executable authority):\n' +
                    JSON.stringify(message.tools),
                },
              ]
            : undefined);
        turns.push({
          id: message.id,
          user: request,
          assistant: answer,
          ...(exchange ? { exchange: structuredClone(exchange) } : {}),
          ...(interrupted ? { interrupted: true } : {}),
        });
      }
      user = undefined;
    }
  }
  return turns;
}
