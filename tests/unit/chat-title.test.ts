import { describe, expect, it, vi } from 'vitest';
import { generateChatTitle } from '../../src/ai/chat-title';
import type { ChatRequest, ProviderEvent } from '../../src/ai/types';

const complete = (
  content: string,
): Extract<ProviderEvent, { type: 'complete' }> => ({
  type: 'complete',
  message: { role: 'assistant', content },
});
function provider(events: ProviderEvent[], after?: () => void) {
  return {
    stream: vi.fn(async function* (
      _request: ChatRequest,
      _signal: AbortSignal,
    ) {
      void _request;
      void _signal;
      yield* events;
      after?.();
    }),
  };
}
describe('chat title generation', () => {
  it('uses the configured model with only the first message and no tools', async () => {
    const client = provider([
      { type: 'text', text: 'Partial draft' },
      complete(' “Beach\n trip highlights” '),
    ]);
    const signal = new AbortController().signal;
    await expect(
      generateChatTitle({
        provider: client,
        model: 'configured/model',
        message: 'Edit my beach trip',
        sessionId: 'chat-1',
        signal,
      }),
    ).resolves.toBe('Beach trip highlights');
    expect(client.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'configured/model',
        sessionId: 'chat-1',
        tools: [],
        messages: [
          { role: 'system', content: expect.any(String) },
          { role: 'user', content: 'Edit my beach trip' },
        ],
      }),
      signal,
    );
  });
  it('retains a complete title beyond the former character and output-token caps', async () => {
    const title = 'Long named editing session '.repeat(40).trim();
    const client = provider([complete(title)]);
    await expect(
      generateChatTitle({
        provider: client,
        model: 'configured/model',
        message: 'First message',
        signal: new AbortController().signal,
      }),
    ).resolves.toBe(title);
    expect(client.stream.mock.calls[0]?.[0]).not.toHaveProperty(
      'maxOutputTokens',
    );
  });
  it.each([
    ['empty', [complete('  ')]],
    ['unfinished', [{ type: 'text', text: 'Never finished' }]],
    ['duplicate terminal', [complete('One title'), complete('Another title')]],
    [
      'tool call',
      [
        {
          type: 'complete',
          message: {
            role: 'assistant',
            content: 'A title',
            tool_calls: [
              {
                id: 'untrusted',
                type: 'function',
                function: { name: 'edit', arguments: '{}' },
              },
            ],
          },
        },
      ],
    ],
  ] as [string, ProviderEvent[]][])(
    'rejects %s output',
    async (_name, events) => {
      await expect(
        generateChatTitle({
          provider: provider(events),
          model: 'same/model',
          message: 'First',
          signal: new AbortController().signal,
        }),
      ).rejects.toBeInstanceOf(Error);
    },
  );
  it('does not publish a completed result after cancellation', async () => {
    const controller = new AbortController();
    await expect(
      generateChatTitle({
        provider: provider([complete('Late title')], () => controller.abort()),
        model: 'same/model',
        message: 'First',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    const client = provider([complete('Not requested')]);
    await expect(
      generateChatTitle({
        provider: client,
        model: 'same/model',
        message: 'First',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(client.stream).not.toHaveBeenCalled();
  });
});

it('accounts completed naming usage even when title text is invalid', async () => {
  const onUsage = vi.fn();
  await expect(
    generateChatTitle({
      provider: provider([
        {
          ...complete(''),
          usage: {
            promptTokens: 4,
            completionTokens: 1,
            totalTokens: 5,
            cost: 0.01,
          },
        },
      ]),
      model: 'test/title',
      message: 'First',
      signal: new AbortController().signal,
      onUsage,
    }),
  ).rejects.toBeInstanceOf(Error);
  expect(onUsage).toHaveBeenCalledWith(
    expect.objectContaining({
      source: 'title',
      model: 'test/title',
      usage: expect.objectContaining({ cost: 0.01 }),
    }),
  );
});
