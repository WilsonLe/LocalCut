import type { AssistantMessage, ChatRequest } from '../src/ai/types';

/** Legacy scenario scripts own execution. Supply an explicit successful auxiliary
 * review without consuming their rounds; completion regressions script real verdicts. */
export function goalReviewReply(
  request: Pick<ChatRequest, 'messages' | 'tools'>,
): AssistantMessage | undefined {
  const instruction = request.messages[0]?.content;
  if (typeof instruction !== 'string' || request.tools.length) return;
  if (instruction.startsWith('LocalCut request contract:')) {
    const data = JSON.parse(request.messages[1]!.content!);
    return {
      role: 'assistant',
      content: `Goal: ${data.initialRequest}\nFulfill the user request.`,
    };
  }
  if (instruction.startsWith('LocalCut completion review:')) {
    return {
      role: 'assistant',
      content: 'FULFILLED\nScripted legacy scenario result',
    };
  }
}
