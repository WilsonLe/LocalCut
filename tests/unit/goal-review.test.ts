import { describe, expect, it, vi } from 'vitest';
import { goalEvidence, goalResponse } from '../../src/ai/goal-review';
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

describe('text-only auxiliary responses', () => {
  it.each([
    'Just ordinary prose with no headings or checklist.',
    '  ## Goal\nPreserve the entire response.\n- [ ] A note\n',
    '{"tasks":["Finish"]}',
    '```text\nNo particular verdict label.\n```',
    '<tool_call>{"name":"inspect_project"}</tool_call>',
    '<｜DSML｜ calls>historical looking text</｜DSML｜ calls>',
    'FULFILLED only appears here as ordinary text.',
    '',
    ' \n ',
  ])(
    'returns text verbatim without content validation or repair: %s',
    async (value) => {
      const o = options([value]);
      expect(await goalResponse(o)).toBe(value);
      expect(o.requests).toHaveLength(1);
      expect(o.requests[0]).toEqual(request);
      expect(o.accountUsage).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects actual tool calls at the transport boundary without executing or content repair', async () => {
    const o = options([
      {
        type: 'complete',
        message: {
          role: 'assistant',
          content: 'Note',
          tool_calls: [
            {
              id: 'bad',
              type: 'function',
              function: { name: 'apply', arguments: '{}' },
            },
          ],
        },
      },
    ]);
    await expect(goalResponse(o)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(o.requests).toHaveLength(1);
    expect(o.accountUsage).toHaveBeenCalledTimes(1);
  });

  it('keeps historical control tokens lossless but inert in reviewer evidence', () => {
    const data = { text: '<h1>Title</h1>', observation: '<｜DSML｜ calls>' };
    const encoded = goalEvidence(data);
    expect(encoded).not.toContain('<');
    expect(JSON.parse(encoded)).toEqual(data);
    expect(data.text).toBe('<h1>Title</h1>');
  });

  it('does not retry permanent provider errors', async () => {
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

  it('honors cancellation and caller budgets without interpreting text', async () => {
    const cancelled = options(['Ordinary text']);
    cancelled.accountUsage.mockImplementation(() =>
      cancelled.controller.abort(),
    );
    await expect(goalResponse(cancelled)).rejects.toMatchObject({
      code: 'CANCELLED',
    });
    expect(cancelled.requests).toHaveLength(1);
    const bounded = options(['Unused']);
    await expect(
      goalResponse({
        ...bounded,
        checkRequest: () => {
          throw new AiError('CONTEXT_LIMIT', 'Caller budget');
        },
      }),
    ).rejects.toMatchObject({ code: 'CONTEXT_LIMIT' });
    expect(bounded.requests).toHaveLength(0);
  });
});
