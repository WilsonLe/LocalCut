import { describe, expect, it, vi } from 'vitest';
import {
  applyDocumentReplacements,
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
      if (stage === 'completion_check')
        expect(messages[0]!.content).toContain(
          'Clip counts, presets, duration, geometry and export success alone do not prove aesthetic or reference fidelity',
        );
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

describe('optional requirement probe meaning controls', () => {
  it.each([
    'Voiceover is not required.',
    'No Voiceover is required.',
    '- [x] Voiceover is required — cancelled by the latest user request.',
    'Earlier claim that Voiceover is required is superseded and excluded.',
    'The old note Voiceover is required is now discarded; Voiceover is not requested.',
    'Reject the historical claim "Voiceover is required".',
    'The old instruction incorrectly said Voiceover is required.',
    'Ignore the unsupported requirement: Voiceover is required.',
  ])(
    'accepts an explicit exclusion or rejected historical claim: %s',
    (observation) => {
      expect(
        roleLeafChecks(
          'session_todos',
          roleArtifacts.session_todos + '\n' + observation,
        ).noInventedRequirements,
      ).toBe(true);
    },
  );
  it.each([
    '- [ ] Voiceover is required before completion.',
    '- [ ] Add Voiceover before finishing.',
    '- [ ] Voiceover must be generated.',
    'Voiceover is required; the historical claim was rejected.',
  ])('rejects a newly required optional action: %s', (observation) => {
    expect(
      roleLeafChecks(
        'session_todos',
        roleArtifacts.session_todos + '\n' + observation,
      ).noInventedRequirements,
    ).toBe(false);
  });
});

describe('task evidence mention controls', () => {
  it('finds completed and blocked evidence after a neutral scope introduction', () => {
    const intro =
      'Harbour title and Music bed are named outcomes. ' +
      'Neutral context. '.repeat(24);
    expect(
      roleLeafChecks(
        'session_todos',
        intro + '\n' + roleArtifacts.session_todos,
      ).completedAndBlockedRetained,
    ).toBe(true);
  });
  it("does not borrow another task's completed status", () => {
    expect(
      roleLeafChecks(
        'session_todos',
        '- [ ] Harbour title — incomplete.\n- [ ] Music bed — blocked: no source.\n- [x] Sunset ending — present.',
      ).completedAndBlockedRetained,
    ).toBe(false);
  });
  it('does not infer a music blocker merely from retaining the task name', () => {
    expect(
      roleLeafChecks(
        'session_todos',
        '- [x] Harbour title — completed.\n- [ ] Music bed — pending.\n- [x] Sunset ending — present.',
      ).completedAndBlockedRetained,
    ).toBe(false);
  });
});

describe('routine confirmation probe meaning controls', () => {
  it.each([
    'Music bed is blocked until a source exists; a fresh say go is not required.',
    'Music bed is waiting for a source without requiring you to say go.',
    'The historical claim Music bed requires explicit go is cancelled.',
    'Do not keep the old requirement: Music bed is blocked until you say go.',
  ])(
    'accepts an excluded or rejected fresh confirmation: %s',
    (observation) => {
      expect(
        roleLeafChecks(
          'session_todos',
          roleArtifacts.session_todos + '\n' + observation,
        ).noRoutineApprovalGate,
      ).toBe(true);
    },
  );
  it.each([
    'Music bed is blocked until you say go.',
    'Music bed requires explicit go; no music source is present.',
    'Music bed is waiting for you to say go.',
    'The old Music bed request requires explicit go and that still applies.',
  ])('rejects an active fresh confirmation: %s', (observation) => {
    expect(
      roleLeafChecks(
        'session_todos',
        roleArtifacts.session_todos + '\n' + observation,
      ).noRoutineApprovalGate,
    ).toBe(false);
  });
});

describe('exact persistent document replacements', () => {
  const document =
    '  ## Notes\n- [ ] Inspect harbour\n- [x] Keep ending — receipt 9\n';
  const edit = (replacements: { oldText: string; newText: string }[]) =>
    JSON.stringify({ replacements });

  it('changes only the requested span, including arbitrary prose and whitespace', async () => {
    const o = options([
      edit([
        {
          oldText: '[ ] Inspect harbour',
          newText: '[x] Inspect harbour — receipt 10',
        },
      ]),
    ]);
    expect(await goalResponse({ ...o, document })).toBe(
      '  ## Notes\n- [x] Inspect harbour — receipt 10\n- [x] Keep ending — receipt 9\n',
    );
    expect(o.accountUsage).toHaveBeenCalledTimes(1);
    expect(await goalResponse({ ...options([edit([])]), document })).toBe(
      document,
    );
  });

  it('inserts, deletes and applies several edits atomically', () => {
    expect(
      applyDocumentReplacements(
        'Alpha\nBeta\nGamma',
        edit([
          { oldText: 'Alpha', newText: 'Alpha\nAdded' },
          { oldText: 'Beta\n', newText: '' },
          { oldText: 'Gamma', newText: 'Updated' },
        ]),
      ),
    ).toBe('Alpha\nAdded\nUpdated');
    expect(
      applyDocumentReplacements('', edit([{ oldText: '', newText: 'First' }])),
    ).toBe('First');
  });

  it.each([
    'Regenerated complete checklist',
    '{}',
    '{"replacements":[],"extra":true}',
    '{"replacements":[{"oldText":"Notes","newText":8}]}',
    edit([{ oldText: 'missing', newText: 'replacement' }]),
    edit([{ oldText: '', newText: 'replacement' }]),
    edit([
      { oldText: 'Notes', newText: 'Changed' },
      { oldText: 'missing', newText: 'Invalid' },
    ]),
  ])(
    'rejects invalid edits without publishing any partial document: %s',
    async (response) => {
      const progress = vi.fn();
      await expect(
        goalResponse({
          ...options([response, response]),
          document,
          onProgress: progress,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
      expect(progress.mock.calls.every(([value]) => value === '')).toBe(true);
      expect(document).toContain('## Notes');
    },
  );

  it.each(['missing', 'ambiguous'])(
    'corrects a %s anchor once against the unchanged document',
    async (match) => {
      const source = 'First: pending\nSecond: pending\nKeep receipt 99.\n';
      const invalid = edit([
        { oldText: 'Keep receipt 99.', newText: 'Keep receipt 99. Verified.' },
        {
          oldText: match === 'missing' ? 'stale target' : 'pending',
          newText: 'done',
        },
      ]);
      const corrected = edit([
        { oldText: 'First: pending', newText: 'First: done' },
      ]);
      const o = options([invalid, corrected]);
      const progress = vi.fn();
      const frozen = structuredClone(o.request);
      expect(
        await goalResponse({ ...o, document: source, onProgress: progress }),
      ).toBe('First: done\nSecond: pending\nKeep receipt 99.\n');
      expect(o.requests).toHaveLength(2);
      expect(o.requests[1]!.messages.slice(0, frozen.messages.length)).toEqual(
        frozen.messages,
      );
      expect(o.requests[1]!.messages.at(-1)!.content).toContain(
        'only corrective attempt',
      );
      expect(JSON.parse(o.requests[1]!.messages.at(-2)!.content!)).toEqual({
        rejectedDocumentUpdate: invalid,
        validation: {
          reason: 'document_update_target',
          replacementIndex: 1,
          match,
        },
      });
      expect(o.request).toEqual(frozen);
      expect(progress.mock.calls.filter(([value]) => value)).toEqual([
        ['First: done\nSecond: pending\nKeep receipt 99.\n'],
      ]);
      expect(o.accountUsage).toHaveBeenCalledTimes(2);
    },
  );

  it('stops after a second invalid target without publishing partial notes', async () => {
    const invalid = edit([{ oldText: 'missing', newText: 'done' }]);
    const o = options([invalid, invalid]);
    const progress = vi.fn();
    await expect(
      goalResponse({ ...o, document, onProgress: progress }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      details: { reason: 'document_update_target' },
    });
    expect(o.requests).toHaveLength(2);
    expect(progress.mock.calls.every(([value]) => value === '')).toBe(true);
  });

  it('rejects a malformed later replacement before considering target correction', async () => {
    const o = options([
      JSON.stringify({
        replacements: [
          { oldText: 'missing', newText: 'changed' },
          { oldText: 'Notes', newText: 7 },
        ],
      }),
    ]);
    await expect(goalResponse({ ...o, document })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(o.requests).toHaveLength(1);
  });

  it('checks the corrective request budget before inference', async () => {
    const o = options([edit([{ oldText: 'missing', newText: 'done' }])]);
    await expect(
      goalResponse({
        ...o,
        document,
        checkRequest: (candidate) => {
          if (candidate.messages.length > request.messages.length)
            throw new AiError('CONTEXT_LIMIT', 'Caller budget');
        },
      }),
    ).rejects.toMatchObject({ code: 'CONTEXT_LIMIT' });
    expect(o.requests).toHaveLength(1);
  });

  it('does not correct cancellation or actual tool calls', async () => {
    const cancelled = options([
      edit([{ oldText: 'missing', newText: 'done' }]),
    ]);
    cancelled.accountUsage.mockImplementation(() =>
      cancelled.controller.abort(),
    );
    await expect(
      goalResponse({ ...cancelled, document }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(cancelled.requests).toHaveLength(1);
    const tools = options([
      {
        type: 'complete',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'forbidden',
              type: 'function',
              function: { name: 'edit', arguments: '{}' },
            },
          ],
        },
      },
    ]);
    await expect(goalResponse({ ...tools, document })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(tools.requests).toHaveLength(1);
  });

  it('rejects ambiguous and overlapping targets', () => {
    expect(() =>
      applyDocumentReplacements(
        'same same',
        edit([{ oldText: 'same', newText: 'new' }]),
      ),
    ).toThrow();
    expect(() =>
      applyDocumentReplacements('aaa', edit([{ oldText: 'aa', newText: 'b' }])),
    ).toThrow();
  });

  it('never displays the patch envelope as a document draft', async () => {
    const response = edit([
      { oldText: 'Inspect harbour', newText: 'Inspect city' },
    ]);
    const o = options([]);
    o.provider.stream = async function* () {
      yield { type: 'text', text: response.slice(0, 20) };
      yield { type: 'text', text: response.slice(20) };
      yield {
        type: 'complete',
        message: { role: 'assistant', content: response },
      };
    };
    const progress = vi.fn();
    const result = await goalResponse({ ...o, document, onProgress: progress });
    expect(progress.mock.calls).toEqual([[''], [result]]);
    expect(result).toContain('Inspect city');
  });
});

it('retries the same frozen replacement request and never applies a partial attempt', async () => {
  const o = options([
    new AiError('RESPONSE_INCOMPLETE', 'Interrupted patch'),
    '{"replacements":[{"oldText":"pending","newText":"done"}]}',
  ]);
  expect(
    await goalResponse({ ...o, document: 'Task pending. Keep evidence.' }),
  ).toBe('Task done. Keep evidence.');
  expect(o.requests).toHaveLength(2);
  expect(o.requests[1]).toEqual(o.requests[0]);
});

it('never applies a replacement completed after cancellation', async () => {
  const o = options([]);
  const response = '{"replacements":[{"oldText":"pending","newText":"done"}]}';
  o.provider.stream = async function* () {
    yield { type: 'text', text: response };
    o.controller.abort();
    yield {
      type: 'complete',
      message: { role: 'assistant', content: response },
    };
  };
  const progress = vi.fn();
  await expect(
    goalResponse({ ...o, document: 'pending', onProgress: progress }),
  ).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(progress).not.toHaveBeenCalledWith('done');
});
