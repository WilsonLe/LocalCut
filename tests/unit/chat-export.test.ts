import { describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import {
  captureChatExport,
  chatExportFile,
  CHAT_EXPORT_TASK,
  registerChatExportTask,
} from '../../src/services/chat-export';
import type { ChatExportSource } from '../../src/services/chat-export';
import type { Editor } from '../../src/editor';
import type { TaskHandler } from '../../src/services/task-queue';

const metadata = {
  title: '../映画: edit\nnotes',
  projectId: 'project-1',
  sessionId: 'session-2',
  exportedAt: '2026-10-12T01:00:00.000Z',
};
const source = (): ChatExportSource => ({
  messages: [
    {
      id: 'user-1',
      role: 'user',
      text: 'Keep **markdown** and tiếng Việt',
      status: 'complete',
      proposalIds: [],
    },
    {
      id: 'assistant-1',
      role: 'assistant',
      text: 'Partial reply',
      status: 'streaming',
      proposalIds: ['proposal-1'],
      tools: [
        {
          callId: 'call-1',
          name: 'inspect_project',
          phase: 'completed',
          input: {},
          result: { text: '```\ncontent\n```' },
        },
      ],
      usage: { promptTokens: 12, completionTokens: 6, totalTokens: 18 },
    },
  ],
  proposals: {
    'proposal-1': {
      id: 'proposal-1',
      turnId: 'assistant-1',
      summary: 'Rename project',
      status: 'pending',
      batch: {
        projectId: 'project-1',
        requestId: 'request-1',
        expectedRevision: 3,
        operations: [{ type: 'renameProject', name: 'Exported edit' }],
      },
    },
  },
  draft: 'Unsent draft\nsecond line',
  attachments: [],
});

describe('chat export', () => {
  it('exports safe terminal response failures in JSON and Markdown without raw error data', async () => {
    const original = source();
    original.messages[1]!.status = 'failed';
    Object.assign(original.messages[1]!, {
      failure: {
        code: 'INVALID_REQUEST',
        message: 'SECRET raw provider message',
        stack: 'SECRET',
        details: {
          status: 400,
          stage: 'assistant_response',
          providerReason: 'context_length_exceeded',
          parameter: 'max_tokens',
          raw: 'SECRET',
        },
      },
    });
    const snapshot = captureChatExport(original, metadata);
    expect(snapshot.messages[1]!.failure).toEqual({
      code: 'INVALID_REQUEST',
      details: {
        status: 400,
        stage: 'assistant_response',
        providerReason: 'context_length_exceeded',
        parameter: 'max_tokens',
      },
    });
    const files = unzipSync(
      new Uint8Array(await chatExportFile(snapshot).arrayBuffer()),
    );
    for (const file of Object.values(files)) {
      expect(strFromU8(file)).toContain('context_length_exceeded');
      expect(strFromU8(file)).not.toContain('SECRET');
    }
    expect(strFromU8(files['chat.md']!)).toContain('### Response failure');
  });

  it('archives a detached complete snapshot with safe names and readable text', async () => {
    const original = source();
    const snapshot = captureChatExport(original, metadata);
    original.messages[1]!.text = 'Later reply';
    original.messages[1]!.tools![0]!.result = { text: 'Later tool' };
    original.draft = '';
    original.proposals['proposal-1']!.status = 'discarded';
    const file = chatExportFile(snapshot);
    expect(file.name).toBe('localcut-chat-映画-edit-notes.zip');
    expect(file.type).toBe('application/zip');
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
    expect(Object.keys(files)).toEqual(['chat.md', 'chat.json']);
    const json = JSON.parse(strFromU8(files['chat.json']!));
    expect(json).toMatchObject({
      version: 1,
      ...metadata,
      draft: { text: 'Unsent draft\nsecond line' },
    });
    expect(json.messages[1]).toMatchObject({
      text: 'Partial reply',
      status: 'streaming',
    });
    expect(json.proposals[0].status).toBe('pending');
    const markdown = strFromU8(files['chat.md']!);
    expect(markdown).toContain('Keep **markdown** and tiếng Việt');
    expect(markdown).toContain('Assistant · streaming');
    expect(markdown).toContain('````json');
    expect(markdown).toContain('## Unsent draft');
    expect(markdown).not.toContain('Later');
  });

  it('exports plain review text verbatim with legacy structured observations', async () => {
    const original = source();
    const observations = [
      '  ## Goal\nMove the clip.\n',
      'FULFILLED\nConfirmed by the receipt.\n',
      {
        conditions: [
          { conditionIndex: 0, status: 'met', evidence: 'Historical receipt' },
        ],
        stopReason: null,
      },
    ];
    original.messages[1]!.tools = observations.map((result, index) => ({
      callId: `review-${index}`,
      name: index === 0 ? 'request_contract' : 'completion_check',
      phase: 'completed',
      result,
    }));
    const file = chatExportFile(captureChatExport(original, metadata));
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const json = JSON.parse(strFromU8(files['chat.json']!));
    expect(
      json.messages[1].tools.map((tool: { result: unknown }) => tool.result),
    ).toEqual(observations);
    expect(strFromU8(files['chat.md']!)).toContain('Confirmed by the receipt.');
  });

  it('excludes session internals and proposal artifacts while keeping status/omission details', () => {
    const original = source();
    Object.assign(original, {
      recovery: {
        prompt: 'private-retry-context',
        assetIds: ['private-retry-asset'],
      },
    });
    Object.assign(original.messages[1]!, {
      connection: { key: 'secret-key' },
      reasoning: 'opaque-reasoning',
    });
    Object.assign(original.proposals['proposal-1']!, {
      result: { file: new Blob(['source-media']) },
      progress: { nativeHandle: 'handle' },
    });
    original.messages[1]!.tools!.push({
      callId: 'call-2',
      name: 'inspect_asset',
      phase: 'failed',
      errorOmitted: true,
    });
    const serialized = JSON.stringify(captureChatExport(original, metadata));
    expect(serialized).not.toMatch(
      /secret-key|opaque-reasoning|source-media|nativeHandle|private-retry-context|private-retry-asset/,
    );
    expect(serialized).toContain('"errorOmitted":true');
    expect(serialized).toContain('"phase":"failed"');
  });

  it('exports drafts with local attachment metadata and all incomplete states', () => {
    const original = source();
    original.messages = ['paused', 'interrupted', 'failed'].map(
      (status, index) => ({
        id: String(index),
        role: 'assistant',
        text: '',
        status: status as 'paused' | 'interrupted' | 'failed',
        proposalIds: [],
      }),
    );
    original.attachments = [
      {
        id: 'image-1',
        name: 'Photo.png',
        kind: 'image',
        file: new Blob(['private-pixels']),
      } as unknown as ChatExportSource['attachments'][number],
    ];
    const snapshot = captureChatExport(original, metadata);
    expect(snapshot.messages.map((message) => message.status)).toEqual([
      'paused',
      'interrupted',
      'failed',
    ]);
    expect(snapshot.draft.attachments).toEqual([
      { id: 'image-1', name: 'Photo.png', kind: 'image' },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('private-pixels');
  });

  it('runs as safe queued local work and honors cancellation before publication', async () => {
    let handler!: TaskHandler;
    const unregister = vi.fn();
    const tasks = {
      register: (kind: string, value: TaskHandler) => {
        expect(kind).toBe(CHAT_EXPORT_TASK);
        handler = value;
        return unregister;
      },
    } as Pick<Editor['tasks'], 'register'>;
    // Registration requires only the existing scheduler interface.
    registerChatExportTask(tasks);
    expect(handler.cache).toMatchObject({ mode: 'fresh' });
    expect(handler.recovery).toBe('safe');
    const abort = new AbortController();
    const pending = handler.execute(captureChatExport(source(), metadata), {
      id: 'export-1',
      signal: abort.signal,
      progress: () => abort.abort(),
    });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const result = (await handler.execute(
      captureChatExport(source(), metadata),
      {
        id: 'export-2',
        signal: new AbortController().signal,
        progress: () => {},
      },
    )) as { file: File };
    expect(
      Object.keys(unzipSync(new Uint8Array(await result.file.arrayBuffer()))),
    ).toEqual(['chat.md', 'chat.json']);
  });
});
