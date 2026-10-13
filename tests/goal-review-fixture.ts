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
      content: JSON.stringify({
        goal: data.initialRequest,
        successConditions: ['Fulfill the user request'],
        stopConditions: [],
      }),
    };
  }
  if (instruction.startsWith('LocalCut completion review:')) {
    const data = JSON.parse(request.messages[1]!.content!);
    return {
      role: 'assistant',
      content: JSON.stringify({
        conditions: data.requestContract.successConditions.map(
          (_: string, conditionIndex: number) => ({
            conditionIndex,
            status: 'met',
            evidence: 'Scripted legacy scenario result',
          }),
        ),
        stopReason: null,
      }),
    };
  }
}
