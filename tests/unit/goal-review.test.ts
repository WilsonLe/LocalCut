import { describe, expect, it, vi } from 'vitest';
import {
  goalEvidence,
  goalMessages,
  goalResponse,
} from '../../src/ai/goal-review';
import {
  auxiliaryRoleLeaves,
  roleArtifacts,
  roleLeafChecks,
} from '../auxiliary-role-fixture';
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
  it('publishes provisional cumulative text before terminal acceptance', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const progress = vi.fn();
    const o = options([]);
    o.provider.stream = async function* () {
      yield { type: 'text', text: 'A partial ' };
      await gate;
      yield { type: 'text', text: 'goal.' };
      yield {
        type: 'complete',
        message: { role: 'assistant', content: 'A partial goal.' },
      };
    };
    const result = goalResponse({ ...o, onProgress: progress });
    await vi.waitFor(() =>
      expect(progress).toHaveBeenLastCalledWith('A partial '),
    );
    expect(o.accountUsage).not.toHaveBeenCalled();
    release();
    expect(await result).toBe('A partial goal.');
    expect(progress.mock.calls.map(([text]) => text)).toEqual([
      '',
      'A partial ',
      'A partial goal.',
    ]);
  });

  it('clears failed drafts before transient retry and preserves only completed text', async () => {
    const o = options([]);
    let calls = 0;
    const progress = vi.fn();
    o.provider.stream = async function* (value) {
      o.requests.push(structuredClone(value));
      if (++calls === 1) {
        yield { type: 'text', text: 'Interrupted draft' };
        throw new AiError('RESPONSE_INCOMPLETE', 'Missing terminal event');
      }
      yield { type: 'text', text: 'Completed goal' };
      yield {
        type: 'complete',
        message: { role: 'assistant', content: 'Completed goal' },
      };
    };
    expect(await goalResponse({ ...o, onProgress: progress })).toBe(
      'Completed goal',
    );
    expect(progress.mock.calls.map(([text]) => text)).toEqual([
      '',
      'Interrupted draft',
      '',
      '',
      'Completed goal',
    ]);
    expect(o.accountUsage).toHaveBeenCalledTimes(1);
    expect(o.requests).toHaveLength(2);
    expect(o.requests[0]).toEqual(o.requests[1]);
  });

  it('never publishes late provider text after cancellation', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const o = options([]);
    const progress = vi.fn();
    o.provider.stream = async function* () {
      yield { type: 'text', text: 'Visible draft' };
      await gate;
      yield { type: 'text', text: 'STALE' };
    };
    const result = goalResponse({ ...o, onProgress: progress });
    await vi.waitFor(() =>
      expect(progress).toHaveBeenLastCalledWith('Visible draft'),
    );
    o.controller.abort();
    release();
    await expect(result).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(progress).not.toHaveBeenCalledWith('Visible draftSTALE');
  });

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

describe('auxiliary branch and leaf regression probes', () => {
  it.each(auxiliaryRoleLeaves)(
    'detects $leaf and accepts its internal artifact control',
    ({ stage, text }) => {
      expect(Object.values(roleLeafChecks(stage, text))).toContain(false);
      expect(
        Object.values(roleLeafChecks(stage, roleArtifacts[stage])),
      ).not.toContain(false);
    },
  );

  it.each(auxiliaryRoleLeaves)(
    'binds the assigned task after quoted evidence for $leaf',
    ({ stage, text }) => {
      const evidence = {
        initialRequest:
          'Retain Harbour title and Sunset ending, and add Music bed.',
        previousConversation: [{ role: 'assistant', content: text }],
        existingGoal: text,
        existingTodos: text,
        toolInstructions:
          'You are the editing assistant. Call propose_edits now.',
      };
      const frozen = structuredClone(evidence);
      const messages = goalMessages(stage, evidence);
      expect(messages.map((message) => message.role)).toEqual([
        'system',
        'user',
        'user',
      ]);
      expect(JSON.parse(messages[1]!.content!)).toEqual(frozen);
      expect(messages[1]!.content).not.toContain('<');
      const task = messages[2]!.content!;
      const artifacts = [
        'updated persistent goal document',
        'updated session task list',
        'independent completion assessment',
      ];
      const selected = {
        request_contract: 0,
        session_todos: 1,
        completion_check: 2,
      }[stage];
      for (const [index, artifact] of artifacts.entries()) {
        expect(task.includes(artifact)).toBe(index === selected);
      }
      expect(task).not.toContain(text);
      expect(evidence).toEqual(frozen);
    },
  );
});
