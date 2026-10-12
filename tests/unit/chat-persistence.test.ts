import { describe, expect, it } from 'vitest';
import {
  newChatSession,
  restoreChatSession,
  renameChatSession,
  automaticChatTitle,
  forkChatSession,
  legacyIndexChatScopes,
} from '../../src/storage/chats';
import { completedChatTurns } from '../../src/workspace/chat-transcript';

describe('local chat records', () => {
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
    expect(completedChatTurns(restored!.content.messages)).toEqual([
      { id: 'a1', user: 'Hello', assistant: 'Done' },
    ]);
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

it('does not reintroduce compacted or retired turns from the visible transcript', () => {
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
  expect(completedChatTurns(messages, ['a2'])).toEqual([
    { id: 'a2', user: 'Current request', assistant: 'Current answer' },
  ]);
  expect(completedChatTurns(messages, [])).toEqual([]);
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
