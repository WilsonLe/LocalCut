import type { AssistantMessage, ChatRequest } from '../src/ai/types';

/** Legacy scenario scripts own execution. Supply an explicit successful auxiliary
 * review without consuming their rounds; completion regressions script real verdicts. */
export function goalReviewReply(
  request: Pick<ChatRequest, 'messages'> & Partial<Pick<ChatRequest, 'tools'>>,
): AssistantMessage | undefined {
  const instruction = request.messages[0]?.content;
  if (typeof instruction !== 'string') return;
  // Ordinary execution journeys keep their original candidate after the new
  // main-agent decision round. Completion journeys script that decision directly.
  if (!instruction.startsWith('LocalCut ')) {
    try {
      const context = JSON.parse(request.messages[1]?.content ?? '{}');
      if (context.completionDecision)
        return {
          role: 'assistant',
          content:
            [...request.messages]
              .reverse()
              .find(
                (message) =>
                  message.role === 'assistant' && !message.tool_calls?.length,
              )?.content ?? 'Scripted final answer',
        };
    } catch {
      /* Non-context request, such as chat naming. */
    }
  }
  if (request.tools?.length) return;
  if (instruction.startsWith('LocalCut request contract:')) {
    return {
      role: 'assistant',
      content:
        '## Goal\nFulfill the scripted request.\n## Success conditions\n- Scripted outcome completed.\n## Stop conditions\n- None',
    };
  }
  if (instruction.startsWith('LocalCut session to-dos:')) {
    const data = JSON.parse(request.messages[1]!.content!);
    return {
      role: 'assistant',
      content: `## To-dos\n- [${data.conversation?.length > 1 ? 'x' : ' '}] Fulfill the scripted request`,
    };
  }
  if (instruction.startsWith('LocalCut completion review:')) {
    return {
      role: 'assistant',
      content: 'The scripted outcome is supported by the supplied evidence.',
    };
  }
}
