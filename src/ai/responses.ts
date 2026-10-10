import { AiError, aiInvariant } from './errors';
import { dataEvents, PROTOCOL_LIMITS } from './protocol';
import { validateRequest } from './openrouter';
import type {
  AssistantMessage,
  ChatRequest,
  ProviderEvent,
  ToolCall,
} from './types';
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export function responsesBody(request: ChatRequest): string {
  validateRequest(request, true);
  const input: object[] = [];
  for (const message of request.messages) {
    if (message.role === 'tool')
      input.push({
        type: 'function_call_output',
        call_id: message.tool_call_id,
        output: message.content,
      });
    else {
      if (message.content)
        input.push({
          role: message.role === 'system' ? 'developer' : message.role,
          content: message.content,
        });
      if (message.role === 'assistant')
        for (const call of message.tool_calls ?? [])
          input.push({
            type: 'function_call',
            call_id: call.id,
            name: call.function.name,
            arguments: call.function.arguments,
          });
    }
  }
  const body = JSON.stringify({
    model: request.model,
    input,
    tools: request.tools.map((t) => ({
      type: 'function',
      ...t.function,
      strict: false,
    })),
    max_output_tokens: request.maxOutputTokens,
    store: false,
    stream: true,
    parallel_tool_calls: false,
  });
  aiInvariant(
    new TextEncoder().encode(body).length <= 2097152,
    'INVALID_REQUEST',
    'AI request exceeded the size limit.',
  );
  return body;
}
/** The terminal completed response is validated fully before executable calls are exposed. */
export async function* parseResponses(
  response: Response,
  signal: AbortSignal,
): AsyncGenerator<ProviderEvent> {
  let complete: ProviderEvent | undefined;
  let textSize = 0;
  for await (const data of dataEvents(response, signal)) {
    if (data === '[DONE]') continue;
    let event: unknown;
    try {
      event = JSON.parse(data) as unknown;
    } catch {
      throw new AiError('INVALID_RESPONSE', 'Invalid ChatGPT response.');
    }
    aiInvariant(
      object(event) && typeof event.type === 'string' && !complete,
      'INVALID_RESPONSE',
      'Invalid ChatGPT response sequence.',
    );
    if (event.type === 'response.output_text.delta') {
      aiInvariant(
        typeof event.delta === 'string',
        'INVALID_RESPONSE',
        'Invalid ChatGPT text.',
      );
      textSize += event.delta.length;
      aiInvariant(
        textSize <= PROTOCOL_LIMITS.textCharacters,
        'RESPONSE_LIMIT',
        'ChatGPT text exceeded the limit.',
      );
      yield { type: 'text', text: event.delta };
    } else if (event.type === 'response.refusal.delta')
      throw new AiError('PROVIDER_REFUSAL', 'ChatGPT declined this request.');
    else if (
      ['response.failed', 'response.incomplete', 'error'].includes(event.type)
    )
      throw new AiError(
        'RESPONSE_INCOMPLETE',
        'ChatGPT did not complete the request.',
      );
    else if (event.type === 'response.completed') {
      const result = event.response;
      aiInvariant(
        object(result) &&
          result.status === 'completed' &&
          Array.isArray(result.output) &&
          result.output.length <= 128,
        'INVALID_RESPONSE',
        'Invalid completed ChatGPT response.',
      );
      let content = '';
      const calls: ToolCall[] = [];
      const ids = new Set<string>();
      for (const item of result.output) {
        aiInvariant(
          object(item),
          'INVALID_RESPONSE',
          'Invalid ChatGPT output.',
        );
        if (item.type === 'message') {
          aiInvariant(
            item.role === 'assistant' && Array.isArray(item.content),
            'INVALID_RESPONSE',
            'Invalid ChatGPT message.',
          );
          for (const part of item.content) {
            aiInvariant(
              object(part),
              'INVALID_RESPONSE',
              'Invalid ChatGPT content.',
            );
            if (part.type === 'refusal')
              throw new AiError(
                'PROVIDER_REFUSAL',
                'ChatGPT declined this request.',
              );
            aiInvariant(
              part.type === 'output_text' && typeof part.text === 'string',
              'INVALID_RESPONSE',
              'Unsupported ChatGPT content.',
            );
            content += part.text;
          }
        } else if (item.type === 'function_call') {
          aiInvariant(
            typeof item.call_id === 'string' &&
              item.call_id.length > 0 &&
              item.call_id.length <= 1024 &&
              !ids.has(item.call_id) &&
              typeof item.name === 'string' &&
              /^[A-Za-z0-9_-]{1,128}$/.test(item.name) &&
              typeof item.arguments === 'string' &&
              item.arguments.length <= PROTOCOL_LIMITS.toolArgumentCharacters &&
              calls.length < PROTOCOL_LIMITS.toolCalls,
            'INVALID_RESPONSE',
            'Invalid ChatGPT function call.',
          );
          ids.add(item.call_id);
          calls.push({
            id: item.call_id,
            type: 'function',
            function: { name: item.name, arguments: item.arguments },
          });
        } else
          aiInvariant(
            item.type === 'reasoning',
            'INVALID_RESPONSE',
            'Unsupported ChatGPT output.',
          );
      }
      aiInvariant(
        content.length <= PROTOCOL_LIMITS.textCharacters,
        'RESPONSE_LIMIT',
        'ChatGPT text exceeded the limit.',
      );
      const message: AssistantMessage = {
        role: 'assistant',
        content: content || null,
        ...(calls.length ? { tool_calls: calls } : {}),
      };
      complete = {
        type: 'complete',
        message,
        ...(typeof result.model === 'string' ? { model: result.model } : {}),
      };
      if (object(result.usage)) {
        const u = result.usage;
        aiInvariant(
          [u.input_tokens, u.output_tokens, u.total_tokens].every(
            (n) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0,
          ),
          'INVALID_RESPONSE',
          'Invalid ChatGPT usage.',
        );
        complete.usage = {
          promptTokens: u.input_tokens as number,
          completionTokens: u.output_tokens as number,
          totalTokens: u.total_tokens as number,
        };
      }
    }
  }
  aiInvariant(
    complete,
    'RESPONSE_INCOMPLETE',
    'ChatGPT stream ended before completion.',
  );
  yield complete;
}
