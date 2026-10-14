import type {
  AssistantMessage,
  ChatMessage,
  ChatRequest,
} from '../src/ai/types';

/** Read the latest main snapshot; auxiliary evidence keeps its own framing. */
export function requestContextMessage(
  request: Pick<ChatRequest, 'messages'>,
): ChatMessage {
  if (!request.messages[0]?.content?.startsWith('LocalCut ')) {
    const snapshot = request.messages
      .slice()
      .reverse()
      .find((message) => {
        if (message.role !== 'system') return false;
        try {
          return !!JSON.parse(message.content).selectedProject;
        } catch {
          return false;
        }
      });
    if (snapshot) return snapshot;
  }
  return request.messages[1]!;
}

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
      const context = JSON.parse(
        requestContextMessage(request)?.content ?? '{}',
      );
      if (context.completionDecision)
        return {
          role: 'assistant',
          content:
            context.candidateResponse ??
            [...request.messages]
              .reverse()
              .find(
                (message) =>
                  message.role === 'assistant' && !message.tool_calls?.length,
              )?.content ??
            'Scripted final answer',
        };
    } catch {
      /* Non-context request, such as chat naming. */
    }
  }
  if (request.tools?.length) return;
  if (instruction.startsWith('LocalCut context compaction:')) {
    return {
      role: 'assistant',
      content:
        'The scripted request continues with current state and confirmed receipts. Historical tool observations are archived. Never replay completed paid actions; inspect current state before any new edit.',
    };
  }
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
      content: `## To-dos\n- [${(data.conversation?.length ?? data.previousConversation?.length ?? 0) > 1 ? 'x' : ' '}] Fulfill the scripted request`,
    };
  }
  if (instruction.startsWith('LocalCut completion review:')) {
    return {
      role: 'assistant',
      content: 'The scripted outcome is supported by the supplied evidence.',
    };
  }
}
