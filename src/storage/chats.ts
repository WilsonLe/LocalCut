import { usageSchema, usageCallSchema } from '../ai/usage';
import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import { z } from 'zod';
import { safeChatFailure } from '../core/error-diagnostics';
import { chatExchangeSchema } from '../ai/chat-context';

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
const sessionGoalSchema = z.object({ goal: z.string(), todos: z.string() });
const messageSchema = z.object({
  id: identity,
  role: z.enum(['user', 'assistant']),
  sessionGoal: sessionGoalSchema.optional(),
  text: z.string(),
  status: z.enum(['complete', 'streaming', 'interrupted', 'paused', 'failed']),
  requestId: z.string().optional(),
  usageCalls: z.array(usageCallSchema).optional(),
  usage: usageSchema.optional(),
  failure: z.unknown().transform(safeChatFailure).optional(),
  // Canonical historical exchange, separate from UI activity and live authority.
  exchange: chatExchangeSchema.optional(),
  continuation: z
    .object({
      user: z.string(),
      assistant: z.string(),
      indexScope: z.string().optional(),
      exchange: chatExchangeSchema.optional(),
    })
    .optional(),
  tools: z.array(toolSchema).optional(),
});
export const chatContentSchema = z.object({
  prompt: z.string(),
  sessionGoal: sessionGoalSchema.optional(),
  attachmentIds: z.array(identity),
  messages: z.array(messageSchema),
  historyTurnIds: z.array(identity).optional(),
  historyIndexScope: z.string().optional(),
  // Captured user request only; never credentials, live proposals or consent.
  recovery: z
    .object({
      kind: z.enum(['paused', 'retry']),
      turnId: identity,
      prompt: z.string().min(1),
      assetIds: z.array(identity),
    })
    .optional(),
});
export type ChatContent = z.infer<typeof chatContentSchema>;
export type SavedChatMessage = ChatContent['messages'][number];
/** Recovery stays scoped with the chat and only targets its latest unfinished
 * assistant turn. It authorizes no execution until the user explicitly submits. */
export function restoredChatRecovery(content: ChatContent) {
  const recovery = content.recovery;
  const latest = content.messages.at(-1);
  return recovery &&
    latest?.id === recovery.turnId &&
    latest.role === 'assistant' &&
    latest.status !== 'complete'
    ? structuredClone(recovery)
    : null;
}
const sessionSchema = z.object({
  version: z.literal(1),
  scope: z.string().min(1),
  id: identity,
  title: z.string(),
  titleLocked: z.boolean().default(false),
  archived: z.boolean().default(false),
  createdAt: z.number().int().nonnegative(),
  content: chatContentSchema,
});
export type SavedChatSession = z.infer<typeof sessionSchema>;
/** Only the obsolete indexing bit is merged; all remaining sharing stays scoped. */
export function legacyIndexChatScopes(scope: string): string[] {
  try {
    const parts: unknown = JSON.parse(scope);
    if (
      !Array.isArray(parts) ||
      (parts.length !== 7 && parts.length !== 8) ||
      typeof parts[0] !== 'string' ||
      !Array.isArray(parts[1]) ||
      !Array.isArray(parts[2]) ||
      typeof parts[3] !== 'string' ||
      !parts.slice(4, 7).every((part) => typeof part === 'boolean') ||
      (parts.length === 8 && parts[7] !== 'capture-metadata')
    )
      return [];
    return [true, false].map((allowed) =>
      JSON.stringify([...parts.slice(0, 7), allowed, ...parts.slice(7)]),
    );
  } catch {
    return [];
  }
}
/** Only an explicitly connection-authorized scope can recover prior sharing variants. */
export function legacyOpenRouterChatScopes(scope: string): string[] {
  try {
    const parts: unknown = JSON.parse(scope);
    if (
      !Array.isArray(parts) ||
      parts.length !== 5 ||
      typeof parts[0] !== 'string' ||
      !Array.isArray(parts[1]) ||
      !Array.isArray(parts[2]) ||
      typeof parts[3] !== 'string' ||
      parts[4] !== 'openrouter-context-v1'
    )
      return [];
    const scopes: string[] = [];
    for (const text of [false, true])
      for (const names of [false, true])
        for (const transcripts of [false, true])
          for (const capture of [false, true]) {
            const previous = JSON.stringify([
              ...parts.slice(0, 4),
              text,
              names,
              transcripts,
              ...(capture ? ['capture-metadata'] : []),
            ]);
            scopes.push(previous, ...legacyIndexChatScopes(previous));
          }
    return scopes;
  } catch {
    return [];
  }
}
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
    titleLocked: false,
    archived: false,
    createdAt: Date.now(),
    content: { prompt: '', attachmentIds: [], messages: [] },
  };
}
export const chatRenameSchema = z.string().trim().min(1);
export function renameChatSession(
  session: SavedChatSession,
  title: string,
): SavedChatSession {
  return {
    ...session,
    title: chatRenameSchema.parse(title),
    titleLocked: true,
  };
}
export function automaticChatTitle(
  session: SavedChatSession,
  title: string,
): SavedChatSession {
  return session.titleLocked ? session : { ...session, title };
}
export function forkChatSession(session: SavedChatSession): SavedChatSession {
  return restoreChatSession({
    ...newChatSession(session.scope),
    title: `Fork of ${session.title}`,
    titleLocked: true,
    content: structuredClone(session.content),
  })!;
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
/** Historical chat sidecar; never enters project JSON, backups or live authority. */
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
  private async migrateLegacyScopes(scope: string) {
    const db = await this.db();
    const legacyScopes = [
      ...legacyIndexChatScopes(scope),
      ...legacyOpenRouterChatScopes(scope),
    ];
    const probe = db.transaction('sessions');
    const legacyRecords = await Promise.all(
      legacyScopes.map((legacyScope) =>
        probe.store.index('scope').getAll(legacyScope),
      ),
    );
    await probe.done;
    const needsMigration = legacyRecords.some((records, index) =>
      records.some((record) => {
        const restored = restoreChatSession(record);
        return restored?.scope === legacyScopes[index];
      }),
    );
    // Once migrated, loading must remain usable even when storage cannot write.
    if (!needsMigration) return;
    const tx = db.transaction(['sessions', 'selection'], 'readwrite');
    const store = tx.objectStore('sessions');
    const selection = tx.objectStore('selection');
    const records = await store.index('scope').getAll(scope);
    let selected = await selection.get(scope);
    const ids = new Set(
      records.flatMap((record) =>
        restoreChatSession(record)?.scope === scope ? [record.id] : [],
      ),
    );
    for (const legacyScope of legacyScopes) {
      const legacyRecords = await store.index('scope').getAll(legacyScope);
      for (const record of legacyRecords) {
        const restored = restoreChatSession(record);
        if (!restored || restored.scope !== legacyScope) continue;
        if (!ids.has(restored.id)) {
          const migrated = { ...restored, scope };
          await store.put(migrated);
          records.push(migrated);
          ids.add(migrated.id);
        }
        await store.delete([legacyScope, restored.id]);
      }
      const previous = await selection.get(legacyScope);
      if (!records.some((record) => record.id === selected && !record.archived))
        if (
          records.some((record) => record.id === previous && !record.archived)
        )
          selected = previous;
      await selection.delete(legacyScope);
    }
    if (selected) await selection.put(selected, scope);
    await tx.done;
  }
  async load(scope: string) {
    await this.migrateLegacyScopes(scope);
    const tx = (await this.db()).transaction(['sessions', 'selection']);
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
