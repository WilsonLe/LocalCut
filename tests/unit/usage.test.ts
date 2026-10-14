import { expect, it } from 'vitest';
import {
  carryRequestUsage,
  priceUsageCall,
  requestUsage,
  summarizeUsage,
  usageCategories,
} from '../../src/ai/usage';
import type { UsageCall } from '../../src/ai/usage';
import {
  newChatSession,
  restoreChatSession,
  forkChatSession,
} from '../../src/storage/chats';
import { captureChatExport } from '../../src/services/chat-export';

const call: UsageCall = {
  id: 'call',
  source: 'main',
  model: 'test/model',
  contextLength: 10000,
  usage: {
    promptTokens: 1000,
    completionTokens: 200,
    totalTokens: 1200,
    cost: 0.007,
    cachedTokens: 400,
    cacheWriteTokens: 100,
    reasoningTokens: 50,
  },
  pricing: {
    prompt: '0.000002',
    input_cache_read: '0.0000002',
    input_cache_write: '0.0000025',
    completion: '0.000004',
  },
};
it('separates cache reads/writes from input and includes reasoning in output exactly once', () => {
  const expected = [
    { label: 'Input', tokens: 500, cost: 0.001 },
    { label: 'Input cache', tokens: 400, cost: 0.00008 },
    { label: 'Cache write', tokens: 100, cost: 0.00025 },
    { label: 'Output', tokens: 200, cost: 0.0008 },
  ];
  const actual = usageCategories(call);
  expected.forEach((row, i) => {
    expect(actual[i]).toMatchObject({ label: row.label, tokens: row.tokens });
    expect(actual[i]!.cost).toBeCloseTo(row.cost, 12);
  });
  expect(summarizeUsage([call, call])).toMatchObject({
    cost: 0.007,
    tokens: 1200,
    partial: false,
  });
});
it('preserves zero pricing and distinguishes unknown counts and partial charges', () => {
  expect(
    usageCategories({ ...call, pricing: { completion: '0' } })[3]!.cost,
  ).toBe(0);
  expect(usageCategories({ ...call, pricing: {} })[1]!.cost).toBeUndefined();
  expect(
    usageCategories({
      ...call,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    })[0]!.tokens,
  ).toBeUndefined();
  expect(
    summarizeUsage([call, { ...call, id: 'missing', usage: undefined }]),
  ).toMatchObject({ cost: 0.007, partial: true });
  expect(summarizeUsage([]).cost).toBeUndefined();
  expect(
    priceUsageCall(call, {
      id: 'different',
      name: 'Other',
      contextLength: 1,
      supportsTools: true,
      supportedParameters: [],
      pricing: { prompt: '999' },
    }).pricing,
  ).toEqual(call.pricing);
});
it('groups recovery attempts and out-of-order background results under the initiating request', () => {
  const groups = requestUsage([
    { id: 'u1', role: 'user', text: 'Original request' },
    {
      id: 'a1',
      role: 'assistant',
      text: '',
      requestId: 'r1',
      usageCalls: [call, { ...call, id: 'late-title', source: 'title' }],
    },
    { id: 'u2', role: 'user', text: 'Retry original' },
    {
      id: 'a2',
      role: 'assistant',
      text: '',
      requestId: 'r1',
      usageCalls: [{ ...call, id: 'retry', source: 'session_todos' }],
    },
    { id: 'u3', role: 'user', text: 'New request' },
    {
      id: 'a3',
      role: 'assistant',
      text: '',
      usageCalls: [{ ...call, id: 'new' }],
    },
  ]);
  expect(groups).toHaveLength(2);
  expect(groups[0]!.prompt).toBe('Original request');
  expect(summarizeUsage(groups[0]!.calls)).toMatchObject({
    cost: 0.021,
    tokens: 3600,
  });
});
it('retains interrupted accounting and saved rates through reload, fork and JSON export', () => {
  const chat = newChatSession('scope');
  chat.content.messages.push({
    id: 'a1',
    requestId: 'r1',
    role: 'assistant',
    text: '',
    status: 'interrupted',
    usageCalls: [call],
  });
  for (const saved of [restoreChatSession(chat)!, forkChatSession(chat)]) {
    expect(saved.content.messages[0]!.usageCalls).toEqual([call]);
    const exported = captureChatExport(
      {
        messages: saved.content.messages.map((message) => ({
          ...message,
          proposalIds: [],
        })),
        proposals: {},
        draft: '',
        attachments: [],
      },
      {
        sessionId: 'session',
        projectId: 'project',
        title: 'Usage',
        exportedAt: 'now',
      },
    );
    expect(exported.messages[0]!.usageCalls).toEqual([call]);
  }
});

it('keeps legacy aggregate totals separate from actual main context snapshots', () => {
  const groups = requestUsage([
    { id: 'old', role: 'assistant', text: '', usage: call.usage },
  ]);
  expect(groups[0]!.calls[0]!.source).toBe('legacy');
  expect(summarizeUsage(groups[0]!.calls).cost).toBe(0.007);
});

it('Resume carries the latest accounting after delayed callbacks and preserves legacy totals', () => {
  const captured = {
    id: 'paused',
    role: 'assistant' as const,
    text: '',
    usageCalls: [call],
  };
  // A callback completes while Resume awaits setup. The updater receives this newer state.
  const current = {
    ...captured,
    usageCalls: [
      ...captured.usageCalls,
      { ...call, id: 'late-title', source: 'title' as const },
    ],
  };
  const response = { id: 'resumed', role: 'assistant' as const, text: '' };
  const resumed = carryRequestUsage(current, response);
  expect(resumed.requestId).toBe('paused');
  expect(summarizeUsage(resumed.usageCalls!)).toMatchObject({
    cost: 0.014,
    tokens: 2400,
  });
  const legacy = carryRequestUsage(
    { id: 'old', role: 'assistant', text: '', usage: call.usage },
    response,
  );
  expect(legacy.usageCalls![0]!.source).toBe('legacy');
  expect(
    summarizeUsage([...legacy.usageCalls!, { ...call, id: 'next' }]).cost,
  ).toBe(0.014);
});

it('weights cache hits by all input tokens and deduplicates calls including writes', () => {
  const large = {
    ...call,
    id: 'large',
    usage: {
      promptTokens: 9000,
      completionTokens: 1,
      totalTokens: 9001,
      cachedTokens: 0,
    },
  };
  expect(summarizeUsage([call, call, large]).cacheHitRate).toBe(0.04);
  expect(summarizeUsage([call]).cacheHitRate).toBe(0.4);
  expect(summarizeUsage([large]).cacheHitRate).toBe(0);
});

it('leaves empty, missing, inconsistent and zero-input cache ratios unavailable', () => {
  expect(summarizeUsage([]).cacheHitRate).toBeUndefined();
  expect(
    summarizeUsage([call, { ...call, id: 'unknown', usage: undefined }])
      .cacheHitRate,
  ).toBeUndefined();
  for (const usage of [
    { promptTokens: 1000, completionTokens: 0, totalTokens: 1000 },
    { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0 },
    {
      promptTokens: 1000,
      completionTokens: 0,
      totalTokens: 1000,
      cachedTokens: 1001,
    },
    {
      promptTokens: 1000,
      completionTokens: 0,
      totalTokens: 1000,
      cachedTokens: 900,
      cacheWriteTokens: 101,
    },
  ])
    expect(summarizeUsage([{ ...call, usage }]).cacheHitRate).toBeUndefined();
});

it.each([-1, NaN, Infinity])(
  'does not display invalid cache reporting as a percentage: %s',
  (cachedTokens) => {
    expect(
      summarizeUsage([{ ...call, usage: { ...call.usage!, cachedTokens } }])
        .cacheHitRate,
    ).toBeUndefined();
  },
);
