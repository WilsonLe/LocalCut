import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import { z } from 'zod';

const identity = z.string().min(1).max(200);
const toolSchema = z.object({
  callId: identity,
  name: identity,
  phase: z.enum(['started', 'completed', 'failed']),
  input: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown().optional(),
  // Historical error details are display data, never executable authority.
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      details: z.record(z.string(), z.unknown()),
    })
    .optional(),
  inputOmitted: z.literal(true).optional(),
  resultOmitted: z.literal(true).optional(),
  errorOmitted: z.literal(true).optional(),
});
const messageSchema = z.object({
  id: identity,
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  status: z.enum(['complete', 'streaming', 'interrupted', 'paused', 'failed']),
  usage: z
    .object({
      promptTokens: z.number().nonnegative(),
      completionTokens: z.number().nonnegative(),
      totalTokens: z.number().nonnegative(),
      cost: z.number().optional(),
    })
    .optional(),
  tools: z.array(toolSchema).optional(),
});
export const chatContentSchema = z.object({
  prompt: z.string(),
  attachmentIds: z.array(identity).max(1000),
  messages: z.array(messageSchema),
  historyTurnIds: z.array(identity).max(50).optional(),
  historyIndexScope: z.string().optional(),
});
export type ChatContent = z.infer<typeof chatContentSchema>;
export type SavedChatMessage = ChatContent['messages'][number];
const sessionSchema = z.object({
  version: z.literal(1),
  scope: z.string().min(1),
  id: identity,
  title: z.string(),
  createdAt: z.number().int().nonnegative(),
  content: chatContentSchema,
});
export type SavedChatSession = z.infer<typeof sessionSchema>;
interface ChatDatabase extends DBSchema {
  sessions: {
    key: [string, string];
    value: SavedChatSession;
    indexes: { scope: string };
  };
  selection: { key: string; value: string };
}
export function newChatSession(scope: string): SavedChatSession {
  return {
    version: 1,
    scope,
    id: crypto.randomUUID(),
    title: 'New chat',
    createdAt: Date.now(),
    content: { prompt: '', attachmentIds: [], messages: [] },
  };
}
export function restoreChatSession(value: unknown): SavedChatSession | null {
  const parsed = sessionSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    content: {
      ...parsed.data.content,
      messages: parsed.data.content.messages.map((message) => ({
        ...message,
        status:
          message.status === 'streaming' || message.status === 'paused'
            ? 'interrupted'
            : message.status,
        tools: message.tools?.map((tool) =>
          tool.phase === 'started'
            ? {
                ...tool,
                phase: 'failed',
                error: {
                  code: 'CANCELLED',
                  message: 'Response stopped before this activity completed.',
                  details: {},
                },
              }
            : tool,
        ),
      })),
    },
  };
}
/** Display-only sidecar; never enters project JSON, backups or assistant authority. */
export class ChatStore {
  private database?: Promise<IDBPDatabase<ChatDatabase>>;
  constructor(private namespace: string) {}
  private db() {
    return (this.database ??= openDB<ChatDatabase>(
      `${this.namespace}-chats-v1`,
      1,
      {
        upgrade(db) {
          const sessions = db.createObjectStore('sessions', {
            keyPath: ['scope', 'id'],
          });
          sessions.createIndex('scope', 'scope');
          db.createObjectStore('selection');
        },
      },
    ).catch((error) => {
      this.database = undefined;
      throw error;
    }));
  }
  async load(scope: string) {
    const db = await this.db();
    const tx = db.transaction(['sessions', 'selection']);
    const records = await tx
      .objectStore('sessions')
      .index('scope')
      .getAll(scope);
    const selected = await tx.objectStore('selection').get(scope);
    await tx.done;
    const sessions = records
      .map(restoreChatSession)
      .filter(
        (record): record is SavedChatSession =>
          record !== null && record.scope === scope,
      )
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    return {
      sessions,
      selected: sessions.some((session) => session.id === selected)
        ? selected!
        : (sessions[0]?.id ?? ''),
    };
  }
  async save(scope: string, sessions: SavedChatSession[], selected: string) {
    // Patch only changed sessions; another tab's unrelated chats are never replaced.
    const records = sessions.map((session) => sessionSchema.parse(session));
    if (records.some((session) => session.scope !== scope))
      throw new Error('Chat scope does not match.');
    const tx = (await this.db()).transaction(
      ['sessions', 'selection'],
      'readwrite',
    );
    for (const record of records) await tx.objectStore('sessions').put(record);
    await tx.objectStore('selection').put(selected, scope);
    await tx.done;
  }
  async close() {
    (await this.database)?.close();
    this.database = undefined;
  }
}
