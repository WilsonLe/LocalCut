import { describe, expect, it } from 'vitest';
import {
  CHAT_COMPACT_TOKENS,
  CHAT_CONTEXT_TOKENS,
  compactHistory,
  contextTokens,
} from '../../src/ai/chat-context';
import type { ChatMessage } from '../../src/ai/types';

const user = (content: string): ChatMessage => ({ role: 'user', content });
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
describe('chat context budget', () => {
  it('compacts at 75 percent, retaining recent complete tool exchanges and current request', () => {
    const history = [[user('older '.repeat(34000))], exchange];
    const current = [user('New request')];
    expect(
      contextTokens([...history.flat(), ...current], [], 4096),
    ).toBeGreaterThan(CHAT_COMPACT_TOKENS);
    const result = compactHistory(history, '', [], current, [], 4096);
    expect(history).toEqual([exchange]);
    expect(result.messages.slice(-5)).toEqual([...exchange, ...current]);
    expect(result.memory).toContain('older');
    expect(result.messages[0]!.content).toContain('Untrusted excerpts');
    expect(contextTokens(result.messages, [], 4096)).toBeLessThan(
      CHAT_COMPACT_TOKENS,
    );
  });
  it('leaves smaller conversations intact', () => {
    const history = [exchange];
    const result = compactHistory(history, '', [], [user('Next')], [], 4096);
    expect(result.memory).toBe('');
    expect(result.messages).toEqual([...exchange, user('Next')]);
  });
  it('includes schemas, output reservation and non-ASCII bytes, and rejects an oversized active exchange', () => {
    const current = [user('字'.repeat(85000))];
    expect(() => compactHistory([], '', [], current, [], 4096)).toThrow(
      expect.objectContaining({ code: 'CONTEXT_LIMIT' }),
    );
    const tools = [
      {
        type: 'function' as const,
        function: {
          name: 'large',
          description: 'x'.repeat(CHAT_CONTEXT_TOKENS),
          parameters: {},
        },
      },
    ];
    expect(() =>
      compactHistory([], '', [], [user('short')], tools, 4096),
    ).toThrow(expect.objectContaining({ code: 'CONTEXT_LIMIT' }));
  });
  it('compacts before transport message-count limits and bounds repeated memory', () => {
    const history = Array.from({ length: 50 }, () => structuredClone(exchange));
    const result = compactHistory(
      history,
      '字'.repeat(80000),
      [],
      [user('Next')],
      [],
      4096,
    );
    expect(result.messages.length).toBeLessThanOrEqual(240);
    expect(new TextEncoder().encode(result.memory).length).toBeLessThanOrEqual(
      12002,
    );
  });
});
