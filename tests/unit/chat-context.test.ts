import { describe, expect, it, vi } from 'vitest';
import {
  executionHistory,
  compactHistory,
  contextTokens,
  compactWorkingContext,
  workingContextTokens,
  chatExchangeSchema,
} from '../../src/ai/chat-context';
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

describe('persistent working context compaction', () => {
  const archive = () => [
    user('Original source ' + 'x'.repeat(700_000)),
    {
      role: 'assistant' as const,
      content: null,
      tool_calls: [
        {
          id: 'paid',
          type: 'function' as const,
          function: { name: 'generate_speech', arguments: '{}' },
        },
      ],
    },
    {
      role: 'tool' as const,
      tool_call_id: 'paid',
      content: '{"status":"completed","assetId":"voice-1"}',
    },
    {
      role: 'assistant' as const,
      content: 'Narration saved; do not synthesize again.',
    },
    user('Continue mixing'),
  ];
  it('preserves the archive and paired receipts, reuses a persisted checkpoint, then compacts only new growth', async () => {
    const messages = archive(),
      original = structuredClone(messages);
    const summarize = vi.fn(async (evidence: { fragment: string }) => {
      expect(evidence.fragment.length).toBeGreaterThan(0);
      return 'Narration asset voice-1 already completed. Continue mixing; do not repeat paid synthesis.';
    });
    const onStart = vi.fn(),
      check = vi.fn();
    const first = await compactWorkingContext({
      messages,
      summarize,
      onStart,
      check,
    });
    expect(first.compacted).toBe(true);
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(messages).toEqual(original);
    expect(chatExchangeSchema.safeParse(first.messages).success).toBe(true);
    expect(workingContextTokens(first.messages)).toBeLessThan(192000);
    const calls = summarize.mock.calls.length;
    const checkpoint = JSON.parse(JSON.stringify(first.checkpoint));
    const followup = await compactWorkingContext({
      messages: [...messages, user('New direction')],
      checkpoint,
      summarize,
      onStart,
      check,
    });
    expect(followup.compacted).toBe(false);
    expect(summarize).toHaveBeenCalledTimes(calls);
    expect(followup.messages[0]!.content).toContain('voice-1');
    expect(followup.messages.at(-1)).toEqual(user('New direction'));
    const growth = await compactWorkingContext({
      messages: [...messages, user('y'.repeat(700000))],
      checkpoint,
      summarize,
      onStart,
      check,
    });
    expect(growth.compacted).toBe(true);
    expect(growth.checkpoint!.coveredMessages).toBeGreaterThan(
      checkpoint.coveredMessages,
    );
    expect(
      summarize.mock.calls
        .slice(calls)
        .every((call) => !call[0].fragment.includes('Original source')),
    ).toBe(true);
    expect(onStart).toHaveBeenCalledTimes(2);
  });
  it('invalidates altered history or an earlier fork without trusting a stale summary', async () => {
    const messages = archive();
    const summarize = vi.fn(async () => 'Retained legitimate context.');
    const options = { summarize, check: () => {}, onStart: () => {} };
    const first = await compactWorkingContext({ ...options, messages });
    const fork = await compactWorkingContext({
      ...options,
      messages: [user('Different earlier branch')],
      checkpoint: first.checkpoint,
    });
    expect(fork.checkpoint).toBeUndefined();
    expect(fork.messages).toEqual([user('Different earlier branch')]);
    const changed = await compactWorkingContext({
      ...options,
      messages: [user('changed ' + 'z'.repeat(700000)), ...messages.slice(1)],
      checkpoint: first.checkpoint,
    });
    expect(changed.compacted).toBe(true);
    expect(changed.checkpoint!.sourceHash).not.toBe(
      first.checkpoint!.sourceHash,
    );
  });
  it('does not publish incomplete, empty or cancelled summaries', async () => {
    const messages = archive(),
      before = structuredClone(messages);
    await expect(
      compactWorkingContext({
        messages,
        summarize: async () => '',
        check: () => {},
        onStart: () => {},
      }),
    ).rejects.toThrow('usable working summary');
    let cancelled = false;
    await expect(
      compactWorkingContext({
        messages,
        summarize: async () => {
          cancelled = true;
          return 'late';
        },
        check: () => {
          if (cancelled) throw new Error('cancelled');
        },
        onStart: () => {},
      }),
    ).rejects.toThrow('cancelled');
    expect(messages).toEqual(before);
  });
});

it('keeps opaque reasoning out of summaries while hashing and preserving its original archive', async () => {
  const messages: ChatMessage[] = [
    user('Original request'),
    {
      role: 'assistant',
      content: 'Verified visible reply',
      reasoning: 'HIDDEN_REASONING',
      reasoning_content: 'HIDDEN_CONTENT',
      reasoning_details: [
        { type: 'reasoning.encrypted', data: 'HIDDEN_SIGNATURE' },
      ],
    },
    user('z'.repeat(700000)),
  ];
  const original = structuredClone(messages);
  const fragments: string[] = [];
  const result = await compactWorkingContext({
    messages,
    summarize: async (evidence) => {
      fragments.push(evidence.fragment);
      return 'Verified visible reply.';
    },
    check: () => {},
    onStart: () => {},
  });
  expect(fragments.join('')).toContain('Verified visible reply');
  expect(fragments.join('')).not.toContain('HIDDEN_');
  expect(JSON.stringify(result.checkpoint)).not.toContain('HIDDEN_');
  expect(messages).toEqual(original);
});

it('avoids semantic inference for redundant snapshots while preserving the archive', async () => {
  const snapshot = (todos: string): ChatMessage => ({
    role: 'system',
    content: JSON.stringify({
      selectedProject: { id: 'film', revision: 9 },
      availableAssetIds: ['voice'],
      capabilityMap: { repeated: 'catalog '.repeat(50000) },
      sessionTodos: todos,
    }),
  });
  const messages: ChatMessage[] = [
    user('Keep completed narration and change the ending.'),
    snapshot('Narration completed; ending blocked.'),
    snapshot('Narration completed; ending fixed at revision 9.'),
    user('Unrecognized source evidence stays complete. ' + 'z'.repeat(5000)),
  ];
  const before = structuredClone(messages);
  const summarize = vi.fn(async (evidence: { fragment: string }) => {
    expect(evidence.fragment).toContain('ending blocked');
    expect(evidence.fragment).toContain('ending fixed');
    expect(evidence.fragment).not.toContain('catalog catalog');
    expect(evidence.fragment.length).toBeLessThan(
      JSON.stringify(before).length / 20,
    );
    return 'Narration completed. Ending fixed at revision 9.';
  });
  const result = await compactWorkingContext({
    messages,
    summarize,
    check: () => {},
    onStart: () => {},
  });
  expect(summarize).not.toHaveBeenCalled();
  expect(messages).toEqual(before);
  expect(result.checkpoint).toBeUndefined();
  expect(executionHistory(result.messages)).toEqual([messages[0], messages[3]]);
  expect(JSON.stringify(result.messages)).toContain('z'.repeat(5000));
  const followup = [...messages, user('Verify without synthesis.')];
  const reused = await compactWorkingContext({
    messages: followup,
    checkpoint: result.checkpoint,
    summarize,
    check: () => {},
    onStart: () => {},
  });
  expect(summarize).not.toHaveBeenCalled();
  expect(reused.messages.slice(0, result.messages.length)).toEqual(
    result.messages,
  );
});
