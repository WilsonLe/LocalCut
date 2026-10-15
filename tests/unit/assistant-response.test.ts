import { expect, it, vi } from 'vitest';
import { streamAssistantResponse } from '../../src/ai/assistant-response';
import type { ProviderEvent } from '../../src/ai/types';

it('captures terminal content and tool arguments before asynchronous iterator cleanup', async () => {
  const complete: Extract<ProviderEvent, { type: 'complete' }> = {
    type: 'complete',
    message: {
      role: 'assistant',
      content: 'Captured reply',
      tool_calls: [
        {
          id: 'call',
          type: 'function',
          function: { name: 'inspect_project', arguments: '{}' },
        },
      ],
    },
  };
  const result = await streamAssistantResponse({
    provider: {
      stream: () => ({
        [Symbol.asyncIterator](): AsyncIterator<ProviderEvent> {
          let sent = false;
          return {
            async next() {
              if (sent) return { done: true, value: undefined };
              sent = true;
              return { done: false, value: complete };
            },
            async return() {
              queueMicrotask(() => {
                complete.message.content = 'Changed during cleanup';
                complete.message.tool_calls![0]!.function.arguments =
                  '{"changed":true}';
              });
              return { done: true, value: undefined };
            },
          };
        },
      }),
    },
    request: { model: 'synthetic', messages: [], tools: [] },
    signal: new AbortController().signal,
    check: () => {},
    limits: {
      maxRounds: Infinity,
      maxToolCalls: Infinity,
      maxOperations: Infinity,
      maxProposals: Infinity,
      maxHistoryTurns: Infinity,
      maxContextBytes: Infinity,
    },
    output: { outputBytes: 0, partialText: '' },
    emit: () => {},
    local: new Set(),
    id: 'turn',
    model: 'synthetic',
    addUsage: vi.fn(),
  });
  expect(complete.message.content).toBe('Changed during cleanup');
  expect(result.message.content).toBe('Captured reply');
  expect(result.message.tool_calls![0]!.function.arguments).toBe('{}');
});
