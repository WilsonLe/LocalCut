import { describe, expect, it, vi } from 'vitest';
import {
  goalEvidence,
  goalResponse,
  clearedTodos,
} from '../../src/ai/goal-review';
import { AiError } from '../../src/ai/errors';
import type { ChatRequest, ProviderEvent } from '../../src/ai/types';

const request: ChatRequest = {
  model: 'test/review',
  sessionId: 'review-session',
  messages: [
    { role: 'system', content: 'Assess the original request in plain text.' },
    { role: 'user', content: '{"initialRequest":"Continue"}' },
  ],
  tools: [],
};

function options(responses: (string | AiError | ProviderEvent)[]) {
  const requests: ChatRequest[] = [];
  const controller = new AbortController();
  return {
    requests,
    controller,
    request,
    signal: controller.signal,
    interrupt: <T>(promise: Promise<T>) => promise,
    check: () => {
      if (controller.signal.aborted) throw new AiError('CANCELLED', 'Stopped');
    },
    accountBytes: vi.fn(),
    accountUsage: vi.fn(),
    provider: {
      async *stream(value: ChatRequest) {
        requests.push(structuredClone(value));
        const response = responses.shift()!;
        if (response instanceof AiError) throw response;
        yield typeof response === 'string'
          ? {
              type: 'complete' as const,
              message: { role: 'assistant' as const, content: response },
              usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
            }
          : response;
      },
    },
  };
}

describe('tool-free reviewer boundary', () => {
  it.each([
    '<｜DSML｜ calls>\n<｜DSML｜ invoke name="inspect_capabilities">\n</｜DSML｜ calls>',
    '<|tool_calls_section_begin|><|tool_call_begin|>functions.inspect_project',
    '<tool_call>{"name":"inspect_project"}</tool_call>',
    'FULFILLED\n<function_call name="propose_edits">',
  ])(
    'repairs serialized tool protocol without forwarding it: %s',
    async (bad) => {
      const o = options([bad, 'Goal: Continue the unfinished work.']);
      expect(await goalResponse(o)).toBe('Goal: Continue the unfinished work.');
      expect(o.requests).toHaveLength(2);
      expect(o.requests[1]!.messages.slice(0, 2)).toEqual(request.messages);
      expect(JSON.stringify(o.requests[1])).not.toContain(bad);
      expect(o.requests[1]!.tools).toEqual([]);
      expect(o.requests[1]!.sessionId).toBe(request.sessionId);
      expect(o.accountUsage).toHaveBeenCalledTimes(2);
      expect(request.messages).toHaveLength(2);
    },
  );

  it('repairs actual calls privately and stops after three attempts', async () => {
    const call: ProviderEvent = {
      type: 'complete',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'bad',
            type: 'function',
            function: { name: 'apply', arguments: '{}' },
          },
        ],
      },
    };
    const o = options([call, call, call]);
    await expect(goalResponse(o)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      details: { reason: 'reviewer_protocol' },
    });
    expect(o.requests).toHaveLength(3);
    expect(o.requests[1]).toEqual(o.requests[2]);
    expect(
      o.requests.every((r) => r.messages.every((m) => m.role !== 'tool')),
    ).toBe(true);
  });

  it('preserves arbitrary plain prose and Markdown without a JSON schema', async () => {
    const prose =
      '  ## Goal\nExplain why a tool failed.\n- Preserve the draft.\n';
    expect(await goalResponse(options([prose]))).toBe(prose);
  });

  it('keeps malformed historical control tokens lossless but inert in reviewer evidence', () => {
    const data = {
      previousConversation: [
        {
          role: 'assistant',
          content: '<｜DSML｜ calls> private historical observation',
        },
      ],
      text: '<h1>Title</h1>',
    };
    const frozen = structuredClone(data);
    const encoded = goalEvidence(data);
    expect(encoded).not.toContain('<');
    expect(JSON.parse(encoded)).toEqual(frozen);
    expect(data).toEqual(frozen);
  });

  it('does not retry permanent HTTP errors and preserves safe diagnostics', async () => {
    const o = options([
      new AiError('INVALID_REQUEST', 'Rejected', {
        status: 400,
        providerReason: 'invalid_prompt',
      }),
    ]);
    await expect(goalResponse(o)).rejects.toMatchObject({
      details: { status: 400, providerReason: 'invalid_prompt' },
    });
    expect(o.requests).toHaveLength(1);
  });

  it('checks cancellation and caller context budgets before a repair request', async () => {
    const cancelled = options(['<tool_call>inspect</tool_call>', 'Unused']);
    cancelled.accountUsage.mockImplementation(() =>
      cancelled.controller.abort(),
    );
    await expect(goalResponse(cancelled)).rejects.toMatchObject({
      code: 'CANCELLED',
    });
    expect(cancelled.requests).toHaveLength(1);
    const bounded = options(['<tool_call>inspect</tool_call>', 'Unused']);
    await expect(
      goalResponse({
        ...bounded,
        checkRequest: (r) => {
          if (r.messages.length > 2)
            throw new AiError('CONTEXT_LIMIT', 'Caller budget');
        },
      }),
    ).rejects.toMatchObject({ code: 'CONTEXT_LIMIT' });
    expect(bounded.requests).toHaveLength(1);
  });
});

it('only clears a nonempty task list when every item is checked', () => {
  expect(clearedTodos('## To-dos\n- [x] First\n- [X] Second')).toBe(true);
  for (const text of [
    '',
    'All done',
    '## To-dos',
    '- [x] First\n- [ ] Blocked',
    '- [ ] Needs Save',
  ])
    expect(clearedTodos(text)).toBe(false);
});
