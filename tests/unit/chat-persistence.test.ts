import { describe, expect, it } from 'vitest';
import {
  newChatSession,
  restoreChatSession,
  renameChatSession,
  automaticChatTitle,
  forkChatSession,
  legacyIndexChatScopes,
  legacyOpenRouterChatScopes,
  restoredChatRecovery,
} from '../../src/storage/chats';
import { restoredChatTurns } from '../../src/workspace/chat-transcript';

it('retains a captured retry through reload and fork only for the latest unfinished turn', () => {
  const chat = newChatSession('project:model:private');
  chat.content.messages.push({
    id: 'unfinished',
    role: 'assistant',
    text: 'Already applied',
    status: 'failed',
  });
  chat.content.recovery = {
    kind: 'retry',
    turnId: 'unfinished',
    prompt: 'Original request with captured context',
    assetIds: ['explicit-image'],
  };
  const captured = structuredClone(chat.content.recovery);
  for (const candidate of [restoreChatSession(chat)!, forkChatSession(chat)]) {
    expect(restoredChatRecovery(candidate.content)).toEqual(captured);
    candidate.content.messages.at(-1)!.status = 'complete';
    expect(restoredChatRecovery(candidate.content)).toBeNull();
  }
  chat.content.messages.push({
    id: 'newer',
    role: 'user',
    text: 'New direction',
    status: 'complete',
  });
  expect(restoredChatRecovery(chat.content)).toBeNull();
  expect(chat.content.recovery).toEqual(captured);
  expect(
    restoredChatRecovery(newChatSession('other:scope').content),
  ).toBeNull();
});

it('restores paused explicit recovery without auto-executing old tools or changing legacy records', () => {
  const chat = newChatSession('project:model:private');
  chat.content.messages.push({
    id: 'paused',
    role: 'assistant',
    text: 'Partial',
    status: 'paused',
  });
  chat.content.recovery = {
    kind: 'paused',
    turnId: 'paused',
    prompt: 'Continue the original request',
    assetIds: [],
  };
  expect(restoredChatRecovery(restoreChatSession(chat)!.content)).toEqual(
    chat.content.recovery,
  );
  delete chat.content.recovery;
  expect(restoredChatRecovery(restoreChatSession(chat)!.content)).toBeNull();
});

describe('local chat records', () => {
  it('retains safe terminal failures through reload and fork, removing raw diagnostic fields', () => {
    const chat = newChatSession('project:model:private');
    chat.content.messages.push({
      id: 'failed',
      role: 'assistant',
      text: '',
      status: 'failed',
    });
    Object.assign(chat.content.messages[0]!, {
      failure: {
        code: 'INVALID_REQUEST',
        message: 'SECRET',
        details: {
          status: 400,
          stage: 'assistant_response',
          providerReason: 'invalid_tool_call',
          parameter: 'tool_calls',
          raw: 'SECRET',
        },
      },
    });
    for (const saved of [restoreChatSession(chat)!, forkChatSession(chat)]) {
      expect(saved.content.messages[0]!.failure).toEqual({
        code: 'INVALID_REQUEST',
        details: {
          status: 400,
          stage: 'assistant_response',
          providerReason: 'invalid_tool_call',
          parameter: 'tool_calls',
        },
      });
      expect(JSON.stringify(saved)).not.toContain('SECRET');
    }
  });

  it('retains additive cache and reasoning accounting through restore and fork', () => {
    const chat = newChatSession('project:model:private');
    const usage = {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cachedTokens: 8,
      cacheWriteTokens: 2,
      reasoningTokens: 3,
    };
    chat.content.messages.push({
      id: 'reply',
      role: 'assistant',
      text: 'Done',
      status: 'complete',
      usage,
    });
    expect(restoreChatSession(chat)?.content.messages[0]?.usage).toEqual(usage);
    expect(
      restoreChatSession(forkChatSession(chat))?.content.messages[0]?.usage,
    ).toEqual(usage);
  });
  it('retains plain reviewer strings and legacy observations through restore and fork', () => {
    const chat = newChatSession('project:model:private');
    const observations = [
      '  ## Goal\nMove the clip and answer.\n',
      'FULFILLED\nConfirmed by the applied receipt.\n',
      {
        goal: 'Previous goal',
        successConditions: ['Previous outcome'],
        stopConditions: [],
      },
      {
        conditions: [
          { conditionIndex: 0, status: 'met', evidence: 'Previous receipt' },
        ],
        stopReason: null,
      },
    ];
    chat.content.messages.push({
      id: 'review',
      role: 'assistant',
      text: 'Done',
      status: 'complete',
      tools: observations.map((result, index) => ({
        callId: `review-${index}`,
        name: index % 2 === 0 ? 'request_contract' : 'completion_check',
        phase: 'completed',
        result,
      })),
    });
    const original = structuredClone(chat);
    for (const candidate of [chat, forkChatSession(chat)]) {
      expect(
        restoreChatSession(candidate)?.content.messages[0]?.tools?.map(
          (tool) => tool.result,
        ),
      ).toEqual(observations);
    }
    expect(chat).toEqual(original);
  });

  it('retains history and attachments beyond the former workspace caps', () => {
    const chat = newChatSession('project:model:private');
    chat.content.historyTurnIds = Array.from(
      { length: 75 },
      (_, i) => `turn-${i}`,
    );
    chat.content.attachmentIds = Array.from(
      { length: 1001 },
      (_, i) => `image-${i}`,
    );
    const renamed = renameChatSession(chat, 'A'.repeat(300));
    const restored = restoreChatSession(forkChatSession(renamed));
    expect(restored?.content.historyTurnIds).toEqual(
      chat.content.historyTurnIds,
    );
    expect(restored?.content.attachmentIds).toEqual(chat.content.attachmentIds);
    expect(restored?.title).toBe(`Fork of ${renamed.title}`);
  });
  it('restores drafts and completed text while stripping authority and stopping unfinished work', () => {
    const chat = newChatSession('project:model:private');
    const restored = restoreChatSession({
      ...chat,
      credentials: 'secret',
      content: {
        prompt: 'Unsent draft',
        attachmentIds: ['image'],
        messages: [
          {
            id: 'u1',
            role: 'user',
            text: 'Hello',
            status: 'complete',
            proposalIds: ['unsafe'],
          },
          {
            id: 'a1',
            role: 'assistant',
            text: 'Done',
            status: 'complete',
            proposalIds: ['unsafe'],
            tools: [
              {
                callId: 'tool',
                name: 'load_skill',
                phase: 'completed',
                input: { skillId: 'editing' },
                result: { status: 'loaded' },
              },
            ],
          },
          {
            id: 'u2',
            role: 'user',
            text: 'Cancelled question',
            status: 'complete',
          },
          {
            id: 'a2',
            role: 'assistant',
            text: 'Partial',
            status: 'streaming',
            tools: [
              { callId: 'unfinished', name: 'propose_edits', phase: 'started' },
            ],
          },
        ],
      },
    });
    expect(restored?.content.prompt).toBe('Unsent draft');
    expect(restored?.content.attachmentIds).toEqual(['image']);
    expect(restored).not.toHaveProperty('credentials');
    expect(restored?.content.messages[1]).not.toHaveProperty('proposalIds');
    expect(restored?.content.messages[3]).toMatchObject({
      status: 'interrupted',
      tools: [{ phase: 'failed', error: { code: 'CANCELLED' } }],
    });
    expect(restoredChatTurns(restored!.content.messages)).toMatchObject([
      { id: 'a1', user: 'Hello', assistant: 'Done' },
      {
        id: 'a2',
        user: 'Cancelled question',
        assistant: expect.stringContaining('interrupted before completion'),
        interrupted: true,
      },
    ]);
    const interrupted = restoredChatTurns(restored!.content.messages, [
      'a1',
    ]).at(-1)!;
    expect(interrupted.interrupted).toBe(true);
    expect(JSON.stringify(interrupted.exchange)).toContain('propose_edits');
  });
  it('rejects malformed and unknown-version records and assigns distinct session identities', () => {
    const a = newChatSession('scope'),
      b = newChatSession('scope');
    expect(a.id).not.toBe(b.id);
    expect(restoreChatSession({ ...a, version: 2 })).toBeNull();
    expect(
      restoreChatSession({
        ...a,
        content: { ...a.content, attachmentIds: [42] },
      }),
    ).toBeNull();
    expect(restoreChatSession(null)).toBeNull();
  });
});

it('retains canonical interruption context and legacy observations across index changes', () => {
  const chat = restoreChatSession({
    ...newChatSession('scope'),
    content: {
      prompt: '',
      attachmentIds: [],
      historyIndexScope: 'current',
      messages: [
        {
          id: 'user',
          role: 'user',
          text: 'Storyboard for Sydney',
          status: 'complete',
        },
        {
          id: 'partial',
          role: 'assistant',
          text: 'Retired private narration',
          status: 'paused',
          continuation: {
            user: 'Storyboard for Sydney with captured asset IDs',
            assistant: 'Confirmed completed receipt: appliedRevision 57',
            indexScope: 'current',
          },
          tools: [
            {
              callId: 'old',
              name: 'read_asset_index',
              phase: 'completed',
              result: { summary: 'Retired private observation' },
            },
          ],
        },
      ],
    },
  })!;
  const turns = restoredChatTurns(chat.content.messages, [], 'current');
  expect(turns[0]).toMatchObject({
    user: 'Storyboard for Sydney with captured asset IDs',
    interrupted: true,
  });
  expect(turns[0]!.assistant).toContain('appliedRevision 57');
  expect(turns[0]!.assistant).not.toContain('Retired private');
  expect(
    restoredChatTurns(chat.content.messages, [], 'changed')[0]!.assistant,
  ).toContain('appliedRevision');
  const legacy = { ...chat.content.messages[1]!, continuation: undefined };
  expect(
    restoredChatTurns([chat.content.messages[0]!, legacy], [], 'current')[0]!
      .assistant,
  ).toContain('Retired private');
});

it('restores earlier visible turns retired by older builds', () => {
  const messages = [
    {
      id: 'u1',
      role: 'user' as const,
      text: 'Old request',
      status: 'complete' as const,
    },
    {
      id: 'a1',
      role: 'assistant' as const,
      text: 'Old labels',
      status: 'complete' as const,
    },
    {
      id: 'u2',
      role: 'user' as const,
      text: 'Current request',
      status: 'complete' as const,
    },
    {
      id: 'a2',
      role: 'assistant' as const,
      text: 'Current answer',
      status: 'complete' as const,
    },
  ];
  expect(restoredChatTurns(messages, ['a2'])).toEqual([
    { id: 'a1', user: 'Old request', assistant: 'Old labels' },
    { id: 'a2', user: 'Current request', assistant: 'Current answer' },
  ]);
  expect(restoredChatTurns(messages, [])).toEqual(restoredChatTurns(messages));
});

it('keeps manual titles authoritative and supports old records without lifecycle fields', () => {
  const chat = newChatSession('scope');
  const { archived: _archived, titleLocked: _locked, ...legacy } = chat;
  expect([_archived, _locked]).toEqual([false, false]);
  expect(restoreChatSession(legacy)).toMatchObject({
    archived: false,
    titleLocked: false,
  });
  const renamed = renameChatSession(chat, '  My edit  ');
  expect(renamed.title).toBe('My edit');
  expect(automaticChatTitle(renamed, 'Delayed generated title')).toBe(renamed);
  expect(() => renameChatSession(chat, '   ')).toThrow();
  expect(renameChatSession(chat, 'x'.repeat(121)).title).toBe('x'.repeat(121));
});
it('forks an independent active snapshot without unfinished authority', () => {
  const source = {
    ...newChatSession('scope'),
    archived: true,
    content: {
      prompt: 'Draft',
      attachmentIds: ['image'],
      historyTurnIds: ['done'],
      historyIndexScope: 'current-index',
      messages: [
        {
          id: 'partial',
          role: 'assistant' as const,
          status: 'paused' as const,
          text: 'Partial reply',
        },
      ],
    },
  };
  const fork = forkChatSession(source);
  expect(fork.id).not.toBe(source.id);
  expect(fork).toMatchObject({
    archived: false,
    titleLocked: true,
    title: 'Fork of New chat',
    content: {
      historyTurnIds: ['done'],
      historyIndexScope: 'current-index',
      messages: [{ status: 'interrupted' }],
    },
  });
  fork.content.attachmentIds.push('other');
  fork.content.messages[0]!.text = 'Changed';
  expect(source.content.attachmentIds).toEqual(['image']);
  expect(source.content.messages[0]!.text).toBe('Partial reply');
});

it('merges only legacy indexing scopes and keeps every other identity boundary', () => {
  const parts = [
    'project',
    [{ providerId: 'openrouter', model: 'test/model' }],
    [{ id: 'openrouter', kind: 'openrouter' }],
    'test/model',
    false,
    true,
    false,
  ];
  for (const suffix of [[], ['capture-metadata']]) {
    const scope = JSON.stringify([...parts, ...suffix]);
    expect(legacyIndexChatScopes(scope)).toEqual([
      JSON.stringify([...parts, true, ...suffix]),
      JSON.stringify([...parts, false, ...suffix]),
    ]);
  }
  for (const raw of [
    '{',
    'scope',
    'null',
    JSON.stringify([...parts, false]),
    JSON.stringify([...parts, 'other-sharing']),
    JSON.stringify([...parts.slice(0, 4), 'false', true, false]),
  ])
    expect(legacyIndexChatScopes(raw)).toEqual([]);
  expect(
    legacyIndexChatScopes(
      JSON.stringify(['another-project', ...parts.slice(1)]),
    ),
  ).not.toEqual(legacyIndexChatScopes(JSON.stringify(parts)));
});

it('recovers prior sharing variants only into an explicitly OpenRouter-authorized identity', () => {
  const prefix = [
    'project',
    [{ providerId: 'router', model: 'test/model' }],
    [{ id: 'router', kind: 'openrouter' }],
    'test/model',
  ];
  const scope = JSON.stringify([...prefix, 'openrouter-context-v1']);
  const legacy = legacyOpenRouterChatScopes(scope);
  expect(legacy).toHaveLength(48);
  expect(new Set(legacy).size).toBe(48);
  for (const text of [false, true])
    for (const names of [false, true])
      for (const transcripts of [false, true])
        for (const capture of [[], ['capture-metadata']]) {
          const old = [...prefix, text, names, transcripts];
          expect(legacy).toContain(JSON.stringify([...old, ...capture]));
          for (const indexes of [false, true])
            expect(legacy).toContain(
              JSON.stringify([...old, indexes, ...capture]),
            );
        }
  for (const raw of [
    '{',
    'null',
    JSON.stringify([...prefix, false, false, false]),
    JSON.stringify([...prefix, 'other']),
    JSON.stringify(['project', {}, [], '', 'openrouter-context-v1']),
  ])
    expect(legacyOpenRouterChatScopes(raw)).toEqual([]);
  for (const index of [0, 1, 2, 3]) {
    const other = [...prefix];
    other[index] = index === 1 || index === 2 ? [] : 'different';
    expect(
      legacyOpenRouterChatScopes(
        JSON.stringify([...other, 'openrouter-context-v1']),
      ).some((item) => legacy.includes(item)),
    ).toBe(false);
  }
});
