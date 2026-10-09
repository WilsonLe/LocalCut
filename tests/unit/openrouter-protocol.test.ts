import { describe, expect, it } from 'vitest';
import {
  parseChatStream,
  PROTOCOL_LIMITS,
  readJson,
} from '../../src/ai/protocol.ts';
import type { ProviderEvent } from '../../src/ai/types.ts';

const encoder = new TextEncoder();
const signal = () => new AbortController().signal;
const frame = (
  delta: Record<string, unknown>,
  finish_reason: string | null = null,
  extra: Record<string, unknown> = {},
) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }], ...extra })}\n\n`;
const done = 'data: [DONE]\n\n';
function response(text: string, size = 7) {
  const bytes = encoder.encode(text);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += size)
          controller.enqueue(bytes.slice(i, i + size));
        controller.close();
      },
    }),
  );
}
async function collect(input: Response, abort = signal()) {
  const events: ProviderEvent[] = [];
  for await (const event of parseChatStream(input, abort)) events.push(event);
  return events;
}

describe('OpenRouter SSE protocol', () => {
  it('assembles split UTF-8, comments, CRLF and multiline data, accepting accounting finish repetition', async () => {
    const first = frame({ role: 'assistant', content: 'Café 🌊' });
    const terminal = frame({}, 'stop');
    const accounting = frame({ content: '', role: 'assistant' }, 'stop', {
      usage: {
        prompt_tokens: 2,
        completion_tokens: 4,
        total_tokens: 6,
        cost: 0.001,
      },
      model: 'vendor/model',
    });
    const multiline = first.replace(',"delta"', ',\ndata: "delta"');
    const events = await collect(
      response(
        (
          ': keepalive\n\n' +
          multiline +
          terminal +
          accounting +
          done
        ).replaceAll('\n', '\r\n'),
        1,
      ),
    );
    expect(events).toEqual([
      { type: 'text', text: 'Café 🌊' },
      {
        type: 'complete',
        message: { role: 'assistant', content: 'Café 🌊' },
        usage: {
          promptTokens: 2,
          completionTokens: 4,
          totalTokens: 6,
          cost: 0.001,
        },
        model: 'vendor/model',
      },
    ]);
  });
  it('supports CR-only events, comments and unknown SSE fields', async () => {
    const events = await collect(
      response(
        (
          'event: message\nid: opaque\nretry: 20\n: comment\n' +
          frame({ content: 'ok' }, 'stop') +
          done
        ).replaceAll('\n', '\r'),
        1,
      ),
    );
    expect(events.at(-1)).toMatchObject({
      type: 'complete',
      message: { content: 'ok' },
    });
  });
  it('assembles interleaved tool calls by index and split name/arguments', async () => {
    const events = await collect(
      response(
        frame({
          tool_calls: [
            {
              index: 1,
              id: 'second',
              type: 'function',
              function: { name: 'read_', arguments: '{' },
            },
            {
              index: 0,
              id: 'first',
              type: 'function',
              function: { name: 'propose', arguments: '{"x":' },
            },
          ],
        }) +
          frame(
            {
              tool_calls: [
                { index: 1, function: { name: 'project', arguments: '}' } },
                { index: 0, function: { arguments: '1}' } },
              ],
            },
            'tool_calls',
          ) +
          done,
      ),
    );
    expect(events).toEqual([
      {
        type: 'complete',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'first',
              type: 'function',
              function: { name: 'propose', arguments: '{"x":1}' },
            },
            {
              id: 'second',
              type: 'function',
              function: { name: 'read_project', arguments: '{}' },
            },
          ],
        },
      },
    ]);
  });
  it('accepts an empty choices usage frame after completion', async () => {
    const events = await collect(
      response(
        frame({ content: 'ok' }, 'stop') +
          'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n' +
          done,
      ),
    );
    expect(events.at(-1)).toMatchObject({
      type: 'complete',
      usage: { totalTokens: 2 },
    });
  });
  it.each([
    [
      'missing DONE',
      frame({ content: 'partial' }, 'stop'),
      'RESPONSE_INCOMPLETE',
    ],
    [
      'missing terminal',
      frame({ content: 'partial' }) + done,
      'RESPONSE_INCOMPLETE',
    ],
    [
      'missing event separator',
      frame({}, 'stop') + 'data: [DONE]',
      'RESPONSE_INCOMPLETE',
    ],
    ['token limit', frame({}, 'length') + done, 'RESPONSE_INCOMPLETE'],
    [
      'refusal',
      frame({ refusal: 'sensitive reason' }, 'stop') + done,
      'PROVIDER_REFUSAL',
    ],
    ['filtered', frame({}, 'content_filter') + done, 'PROVIDER_REFUSAL'],
    ['invalid JSON', 'data: {broken\n\n' + done, 'INVALID_RESPONSE'],
    ['invalid payload', 'data: []\n\n' + done, 'INVALID_RESPONSE'],
    [
      'multiple candidates',
      'data: {"choices":[{},{}]}\n\n' + done,
      'INVALID_RESPONSE',
    ],
    [
      'wrong candidate index',
      'data: {"choices":[{"index":1,"delta":{},"finish_reason":"stop"}]}\n\n' +
        done,
      'INVALID_RESPONSE',
    ],
    [
      'legacy call',
      frame({ function_call: {} }, 'stop') + done,
      'INVALID_RESPONSE',
    ],
    [
      'duplicate terminal',
      frame({}, 'stop') + frame({}, 'stop') + done,
      'INVALID_RESPONSE',
    ],
    [
      'postterminal content',
      frame({}, 'stop') +
        frame({ content: 'late' }, 'stop', {
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }) +
        done,
      'INVALID_RESPONSE',
    ],
    [
      'negative usage',
      frame({}, 'stop', {
        usage: { prompt_tokens: -1, completion_tokens: 0, total_tokens: 0 },
      }) + done,
      'INVALID_RESPONSE',
    ],
    ['unknown finish', frame({}, 'unexpected') + done, 'INVALID_RESPONSE'],
    [
      'sensitive provider error',
      'data: {"error":{"code":502,"message":"SECRET"}}\n\n' + done,
      'PROVIDER_UNAVAILABLE',
    ],
    [
      'unclassified provider error',
      'data: {"error":{"code":"bad","message":"SECRET"}}\n\n' + done,
      'PROVIDER_UNAVAILABLE',
    ],
  ])('rejects %s without a complete event', async (_name, stream, code) => {
    const events: ProviderEvent[] = [];
    let failure: unknown;
    try {
      for await (const event of parseChatStream(response(stream), signal()))
        events.push(event);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code });
    expect(String(failure)).not.toContain('SECRET');
    expect(events.some((event) => event.type === 'complete')).toBe(false);
  });
  it.each([
    [{ index: 0, id: 'x', function: { name: 'tool', arguments: '{' } }],
    [{ index: 0, id: 'x', function: { name: 'tool', arguments: '[]' } }],
    [{ index: 0, function: { name: 'tool', arguments: '{}' } }],
    [{ index: 0, id: 'x', function: { arguments: '{}' } }],
    [{ index: -1, id: 'x' }],
    [{ index: 0.5, id: 'x' }],
    [{ index: 32, id: 'x' }],
    [{ index: 0, id: 'x', type: 'external' }],
    [{ index: 0, id: 'x', function: { name: 'eval()', arguments: '{}' } }],
    [
      { index: 0, id: 'x', function: { name: 'tool', arguments: '{}' } },
      { index: 1, id: 'x', function: { name: 'tool', arguments: '{}' } },
    ],
  ])('rejects malformed tool calls %#', async (...calls) => {
    await expect(
      collect(response(frame({ tool_calls: calls }, 'tool_calls') + done)),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('rejects a changed tool id and a stop with pending tools', async () => {
    const first = frame({
      tool_calls: [
        { index: 0, id: 'first', function: { name: 'tool', arguments: '{}' } },
      ],
    });
    await expect(
      collect(
        response(
          first +
            frame({ tool_calls: [{ index: 0, id: 'changed' }] }, 'tool_calls') +
            done,
        ),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(
      collect(response(first + frame({}, 'stop') + done)),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('bounds event sizes and tool arguments before publication', async () => {
    await expect(
      collect(
        response('data: ' + 'x'.repeat(PROTOCOL_LIMITS.eventBytes + 1), 65536),
      ),
    ).rejects.toMatchObject({ code: 'RESPONSE_LIMIT' });
    const calls = [
      {
        index: 0,
        id: 'x',
        function: {
          name: 'tool',
          arguments: 'x'.repeat(PROTOCOL_LIMITS.toolArgumentCharacters + 1),
        },
      },
    ];
    await expect(
      collect(
        response(frame({ tool_calls: calls }, 'tool_calls') + done, 65536),
      ),
    ).rejects.toMatchObject({ code: 'RESPONSE_LIMIT' });
  });
  it('rejects malformed UTF-8 and releases stream on caller cancellation', async () => {
    const invalid = new Response(new Uint8Array([0xff]));
    await expect(collect(invalid)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    let cancelled = false;
    const controller = new AbortController();
    const pending = collect(
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      ),
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(cancelled).toBe(true);
  });
  it('releases the response when a consumer stops reading', async () => {
    let cancelled = false;
    const input = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(frame({ content: 'first' })));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
    for await (const event of parseChatStream(input, signal())) {
      expect(event.type).toBe('text');
      break;
    }
    expect(cancelled).toBe(true);
  });
  it('bounds ordinary JSON and handles abort/parse failures', async () => {
    await expect(
      readJson(response('{"ok":true}'), signal(), 2),
    ).rejects.toMatchObject({ code: 'RESPONSE_LIMIT' });
    await expect(readJson(response('{broken'), signal())).rejects.toMatchObject(
      { code: 'INVALID_RESPONSE' },
    );
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      readJson(response('{}'), aborted.signal),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });
  it('reports network read failures without exposing remote error text', async () => {
    const body = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError('SECRET'));
          },
        }),
      );
    await expect(collect(body())).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
    await expect(readJson(body(), signal())).rejects.toThrow(
      'AI connection ended unexpectedly.',
    );
  });
  it('bounds aggregate text and total stream bytes', async () => {
    const part = frame({ content: 'x'.repeat(65536) });
    await expect(
      collect(response(part.repeat(17), 65536)),
    ).rejects.toMatchObject({ code: 'RESPONSE_LIMIT' });
    const comment = ': ' + 'x'.repeat(65536) + '\n\n';
    await expect(
      collect(response(comment.repeat(129), 65536)),
    ).rejects.toMatchObject({ code: 'RESPONSE_LIMIT' });
  });
  it('preserves ordered indexed reasoning, late signatures, opaque data, summaries and legacy aliases', async () => {
    const stream =
      frame({
        reasoning: 'hidden ',
        reasoning_content: 'alias ',
        reasoning_details: [
          {
            type: 'reasoning.text',
            text: 'Think ',
            id: null,
            signature: null,
            index: 7,
          },
          {
            type: 'reasoning.encrypted',
            data: 'opaque-',
            id: 'encrypted',
            format: 'openai-responses-v1',
            index: 2,
          },
          { type: 'reasoning.summary', summary: 'First ', index: 9 },
        ],
      }) +
      frame({
        reasoning: 'thought',
        reasoning_content: 'text',
        reasoning_details: [
          {
            index: 7,
            text: 'carefully',
            id: 'thought',
            format: 'anthropic-claude-v1',
          },
          { index: 2, data: 'state' },
          { index: 9, summary: 'summary' },
        ],
      }) +
      frame({ reasoning_details: [{ index: 7, signature: 'signed-' }] }) +
      frame(
        {
          content: 'Visible',
          reasoning_details: [{ index: 7, signature: 'value', id: null }],
        },
        'stop',
      ) +
      done;
    expect(await collect(response(stream, 1))).toEqual([
      { type: 'text', text: 'Visible' },
      {
        type: 'complete',
        message: {
          role: 'assistant',
          content: 'Visible',
          reasoning: 'hidden thought',
          reasoning_content: 'alias text',
          reasoning_details: [
            {
              type: 'reasoning.text',
              text: 'Think carefully',
              id: 'thought',
              signature: 'signed-value',
              index: 7,
              format: 'anthropic-claude-v1',
            },
            {
              type: 'reasoning.encrypted',
              data: 'opaque-state',
              id: 'encrypted',
              format: 'openai-responses-v1',
              index: 2,
            },
            { type: 'reasoning.summary', summary: 'First summary', index: 9 },
          ],
        },
      },
    ]);
  });
  it('retains unindexed consecutive reasoning blocks without inventing fields', async () => {
    const one = {
      type: 'reasoning.text',
      text: 'one',
      signature: null,
      id: null,
    };
    const two = { type: 'reasoning.encrypted', data: '[REDACTED]' };
    const events = await collect(
      response(
        frame({ reasoning_details: [one] }) +
          frame({ reasoning_details: [two] }, 'stop') +
          done,
      ),
    );
    expect(events).toEqual([
      {
        type: 'complete',
        message: {
          role: 'assistant',
          content: null,
          reasoning_details: [one, two],
        },
      },
    ]);
  });
  it.each([
    { reasoning: 3 },
    { reasoning_content: {} },
    { reasoning_details: 'invalid' },
    { reasoning_details: [{ type: 'unexpected', text: 'x' }] },
    { reasoning_details: [{ type: 'reasoning.text', text: 2 }] },
    {
      reasoning_details: [{ type: 'reasoning.text', text: 'x', extra: 'bad' }],
    },
    {
      reasoning_details: [
        { type: 'reasoning.encrypted', data: 'x', signature: 'bad' },
      ],
    },
    { reasoning_details: [{ type: 'reasoning.text', text: 'x', index: -1 }] },
    { reasoning_details: [{ type: 'reasoning.text', text: 'x', index: 0.5 }] },
    { reasoning_details: [{ type: 'reasoning.text', text: 'x', id: 3 }] },
    {
      reasoning_details: [
        { type: 'reasoning.text', signature: 'signature-only' },
      ],
    },
  ])('rejects malformed reasoning metadata %#', async (delta) => {
    await expect(
      collect(response(frame(delta, 'stop') + done)),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('rejects conflicting block identities and post-terminal reasoning', async () => {
    const first = frame({
      reasoning_details: [
        { type: 'reasoning.text', text: 'x', index: 0, id: 'one' },
      ],
    });
    const conflict = frame(
      { reasoning_details: [{ index: 0, id: 'two' }] },
      'stop',
    );
    await expect(
      collect(response(first + conflict + done)),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
    await expect(
      collect(
        response(
          frame({}, 'stop') +
            frame({ reasoning: 'late' }, 'stop', { usage }) +
            done,
        ),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(
      collect(
        response(
          frame({}, 'stop') +
            frame(
              { reasoning_details: [{ type: 'reasoning.text', text: 'late' }] },
              'stop',
              { usage },
            ) +
            done,
        ),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('bounds reasoning bytes across blocks and aliases and bounds block count', async () => {
    const part = frame({
      reasoning: 'x'.repeat(65536),
      reasoning_content: 'x'.repeat(65536),
    });
    await expect(
      collect(response(part.repeat(9), 65536)),
    ).rejects.toMatchObject({ code: 'RESPONSE_LIMIT' });
    const block = frame({
      reasoning_details: [
        { type: 'reasoning.encrypted', data: 'x'.repeat(65536), index: 0 },
      ],
    });
    await expect(
      collect(response(block.repeat(17), 65536)),
    ).rejects.toMatchObject({ code: 'RESPONSE_LIMIT' });
    await expect(
      collect(
        response(
          frame(
            {
              reasoning_details: Array.from({ length: 129 }, () => ({
                type: 'reasoning.text',
                text: 'x',
              })),
            },
            'stop',
          ) + done,
        ),
      ),
    ).rejects.toMatchObject({ code: 'RESPONSE_LIMIT' });
  });
});
