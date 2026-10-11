import { describe, expect, it, vi } from 'vitest';
import { generateChatTitle } from '../../src/ai/chat-title';
import type { ProviderEvent } from '../../src/ai/types';

const complete = (content: string): ProviderEvent => ({
  type: 'complete',
  message: { role: 'assistant', content },
});
function provider(events: ProviderEvent[], after?: () => void) {
  return {
    stream: vi.fn(async function* () {
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
        signal,
      }),
    ).resolves.toBe('Beach trip highlights');
    expect(client.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'configured/model',
        tools: [],
        maxOutputTokens: 512,
        messages: [
          { role: 'system', content: expect.any(String) },
          { role: 'user', content: 'Edit my beach trip' },
        ],
      }),
      signal,
    );
  });
  it.each([
    ['empty', [complete('  ')]],
    ['oversized', [complete('x'.repeat(81))]],
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
