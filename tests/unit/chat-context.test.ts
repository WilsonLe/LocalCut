import { describe, expect, it } from 'vitest';
import { compactHistory, contextTokens } from '../../src/ai/chat-context';
import type { ChatMessage } from '../../src/ai/types';
const user = (content: string): ChatMessage => ({ role: 'user', content });
describe('uncapped chat context', () => {
  it('retains full large history, complete tool exchanges and active input without compaction', () => {
    const exchange: ChatMessage[] = [
      user('Keep the blue clip'),
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'read',
            type: 'function',
            function: { name: 'inspect_project', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', content: '{}', tool_call_id: 'read' },
      { role: 'assistant', content: 'Blue clip retained.' },
    ];
    const history = Array.from({ length: 70 }, () => structuredClone(exchange));
    history.unshift([user('字'.repeat(800000))]);
    const current = [user('Next')];
    const before = structuredClone(history);
    const result = compactHistory(history, '', [], current);
    expect(result.messages).toEqual([...before.flat(), ...current]);
    expect(history).toEqual(before);
    expect(result.memory).toBe('');
    expect(result.messages.length).toBeGreaterThan(256);
    expect(contextTokens(result.messages, [])).toBeGreaterThan(2 * 1024 * 1024);
  });
  it('preserves legacy untrusted memory without generating or truncating it', () => {
    const memory = '字'.repeat(80000);
    const result = compactHistory([], memory, [], [user('Current')]);
    expect(result.memory).toBe(memory);
    expect(result.messages[0]!.content).toContain(memory);
    expect(result.messages.at(-1)).toEqual(user('Current'));
  });
});
