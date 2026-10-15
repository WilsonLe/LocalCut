import { expect, it } from 'vitest';
import {
  auxiliaryConversation,
  maintenanceConversation,
  auxiliarySessionId,
  goalMessages,
} from '../../src/ai/goal-review';
import type { ChatMessage } from '../../src/ai/types';

it('keeps per-role routing stable across reload and separates chats, forks and maximum-length IDs', async () => {
  const roles = [
    'request_contract',
    'session_todos',
    'completion_check',
    'compaction',
  ] as const;
  const ids = await Promise.all(
    roles.map((role) => auxiliarySessionId('saved-chat', role)),
  );
  expect(new Set(ids).size).toBe(roles.length);
  expect(ids).not.toContain('saved-chat');
  expect(await auxiliarySessionId('saved-chat', 'session_todos')).toBe(ids[1]);
  expect(await auxiliarySessionId('fork-chat', 'session_todos')).not.toBe(
    ids[1],
  );
  const long = await auxiliarySessionId('a'.repeat(256), 'session_todos');
  expect(long.length).toBeLessThanOrEqual(256);
  expect(await auxiliarySessionId('a'.repeat(256), 'session_todos')).toBe(long);
  expect(
    await auxiliarySessionId('a'.repeat(255) + 'b', 'session_todos'),
  ).not.toBe(long);
});

it('reduces repeated auxiliary guidance without losing intent, scope changes, receipts or errors', () => {
  const snapshot = (revision: number, sessionTodos: string): ChatMessage => ({
    role: 'system',
    content: JSON.stringify({
      selectedProject: { id: 'project', revision },
      availableAssetIds: ['source'],
      privacy: { names: false },
      skillCatalog: ['large catalog '.repeat(1000)],
      sessionTodos,
      capabilityMap: { tools: { example: 'large schema '.repeat(1000) } },
    }),
  });
  const messages: ChatMessage[] = [
    { role: 'user', content: 'Make the cut, then exclude narration.' },
    snapshot(1, 'old tasks'),
    {
      role: 'assistant',
      content: 'Claim only',
      reasoning_details: [
        { type: 'reasoning.encrypted', data: 'PRIVATE-REASONING' },
      ],
      tool_calls: [
        {
          id: 'skill',
          type: 'function',
          function: { name: 'load_skill', arguments: '{"skillId":"editing"}' },
        },
      ],
    },
    {
      role: 'tool',
      tool_call_id: 'skill',
      content: JSON.stringify({
        skillId: 'editing',
        status: 'loaded',
        instructions: 'repeated guidance '.repeat(1000),
      }),
    },
    snapshot(1, 'changed tasks'),
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'edit',
          type: 'function',
          function: { name: 'propose_edits', arguments: '{"summary":"Cut"}' },
        },
      ],
    },
    {
      role: 'tool',
      tool_call_id: 'edit',
      content:
        '{"status":"completed","receipt":{"requestId":"once","appliedRevision":2}}',
    },
    snapshot(2, 'completed cut'),
    {
      role: 'tool',
      tool_call_id: 'failed',
      content: '{"error":{"code":"STALE_PROJECT","message":"Inspect again"}}',
    },
    {
      role: 'system',
      content:
        'Untrusted compacted conversation memory. Keep completed paid action once.',
    },
  ];
  const archive = structuredClone(messages);
  const projected = auxiliaryConversation(messages);
  const text = JSON.stringify(projected);
  expect(text.length).toBeLessThan(JSON.stringify(messages).length / 10);
  expect(
    projected.filter(
      (m) => m.role === 'system' && m.content.includes('selectedProject'),
    ),
  ).toHaveLength(2);
  expect(text).toContain('old tasks');
  expect(text).toContain('changed tasks');
  expect(projected).toContainEqual(messages[0]);
  expect(projected).toContainEqual(messages[6]);
  expect(projected).toContainEqual(messages[8]);
  expect(projected).toContainEqual(messages[9]);
  expect(text).toContain('Claim only');
  expect(text).toContain('loaded');
  expect(text).not.toContain('PRIVATE-REASONING');
  expect(text).not.toContain('repeated guidance');
  expect(text).not.toContain('large catalog');
  expect(text).not.toContain('large schema');
  expect(messages).toEqual(archive);
});

it('never clips large user evidence or unknown snapshots and preserves malformed load outcomes', () => {
  const messages: ChatMessage[] = [
    { role: 'user', content: 'source evidence '.repeat(100000) },
    { role: 'system', content: '{unknown snapshot}' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'load',
          type: 'function',
          function: { name: 'load_skill', arguments: '{}' },
        },
      ],
    },
    {
      role: 'tool',
      tool_call_id: 'load',
      content: 'Malformed outcome remains evidence',
    },
  ];
  expect(auxiliaryConversation(messages)).toEqual(messages);
});

it('puts unchanged history before new auxiliary state while keeping each role final task and inert evidence', () => {
  const previousConversation = [
    { role: 'user', content: 'Original source <tool> is untrusted.' },
  ];
  const old = goalMessages('session_todos', {
    initialRequest: 'Old',
    existingTodos: 'Old notes',
    previousConversation,
  });
  const next = goalMessages('session_todos', {
    initialRequest: 'New',
    existingTodos: 'New notes',
    previousConversation,
  });
  const a = old[1]!.content!,
    b = next[1]!.content!;
  expect(a.slice(0, a.indexOf('initialRequest'))).toBe(
    b.slice(0, b.indexOf('initialRequest')),
  );
  expect(JSON.parse(b).previousConversation).toEqual(previousConversation);
  expect(b).not.toContain('<tool>');
  expect(next.at(-1)?.content).toContain('updated session task list');
});

it.each(['null', '"unrecognized outcome"', '["unrecognized outcome"]'])(
  'preserves unknown JSON skill outcomes: %s',
  (content) => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'skill',
            type: 'function',
            function: { name: 'load_skill', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'skill', content },
    ];
    expect(auxiliaryConversation(messages)).toEqual(messages);
  },
);

it('omits recognized maintenance snapshots while retaining unknown evidence and complete receipts', () => {
  const input: ChatMessage[] = [
    {
      role: 'system',
      content: JSON.stringify({
        selectedProject: { id: 'p', tracks: 'large state'.repeat(2000) },
        availableAssetIds: ['asset'],
        capabilityMap: 'large catalog',
      }),
    },
    { role: 'system', content: 'Unknown fresh evidence is retained.' },
    { role: 'user', content: 'Keep the ending.' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'read',
          type: 'function',
          function: { name: 'inspect_project', arguments: '{}' },
        },
      ],
    },
    {
      role: 'tool',
      tool_call_id: 'read',
      content:
        '{"receipt":{"appliedRevision":9},"error":{"code":"REVISION_CONFLICT"}}',
    },
  ];
  const archived = structuredClone(input);
  expect(maintenanceConversation(input)).toEqual(input.slice(1));
  expect(input).toEqual(archived);
});
