import { describe, expect, it } from 'vitest';
import { newChatSession, restoreChatSession } from '../../src/storage/chats';
import { completedChatTurns } from '../../src/workspace/chat-transcript';

describe('local chat records', () => {
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
