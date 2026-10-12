import { strToU8, zipSync } from 'fflate';
import type { Asset } from '../core/model';
import type { EditProposal } from '../ai';
import type { SavedChatMessage } from '../storage/chats';
import type { TaskQueue } from './task-queue';
import { freshTask } from './task-cache';

export const CHAT_EXPORT_TASK = 'chat.export.v1';
export interface ChatExportMessage extends SavedChatMessage {
  proposalIds: string[];
}
export interface ChatExportSource {
  messages: ChatExportMessage[];
  proposals: Record<string, EditProposal>;
  draft: string;
  attachments: Asset[];
}

/** Allowlist UI data; never serialize an assistant, connection or live artifact. */
export function captureChatExport(
  source: ChatExportSource,
  metadata: {
    sessionId: string;
    title: string;
    projectId: string;
    exportedAt: string;
  },
) {
  return structuredClone({
    version: 1 as const,
    ...metadata,
    messages: source.messages.map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      status: message.status,
      proposalIds: [...message.proposalIds],
      usage: message.usage && {
        promptTokens: message.usage.promptTokens,
        completionTokens: message.usage.completionTokens,
        totalTokens: message.usage.totalTokens,
        cost: message.usage.cost,
      },
      tools: message.tools?.map((tool) => ({
        callId: tool.callId,
        name: tool.name,
        phase: tool.phase,
        input: tool.input,
        result: tool.result,
        error: tool.error,
        inputOmitted: tool.inputOmitted,
        resultOmitted: tool.resultOmitted,
        errorOmitted: tool.errorOmitted,
      })),
    })),
    proposals: Object.values(source.proposals).map((proposal) => ({
      id: proposal.id,
      summary: proposal.summary,
      status: proposal.status,
      expectedRevision: proposal.batch.expectedRevision,
      appliedRevision: proposal.receipt?.appliedRevision,
      changes: proposal.action ?? proposal.batch.operations,
      dataSharing: proposal.dataSharing,
    })),
    draft: {
      text: source.draft,
      attachments: source.attachments.map((asset) => ({
        id: asset.id,
        name: asset.name,
        kind: asset.kind,
      })),
    },
  });
}
export type ChatExportSnapshot = ReturnType<typeof captureChatExport>;

function jsonBlock(value: unknown) {
  const json = JSON.stringify(value, null, 2);
  // User/tool text can contain fences; use a longer fence to preserve it.
  let fenceLength = 3;
  for (const run of json.matchAll(/`+/g))
    fenceLength = Math.max(fenceLength, run[0].length + 1);
  const fence = '`'.repeat(fenceLength);
  return `${fence}json\n${json}\n${fence}`;
}

export function chatExportMarkdown(snapshot: ChatExportSnapshot) {
  const lines = [
    `# ${snapshot.title.replaceAll(/[\r\n]+/g, ' ')}`,
    '',
    `Exported: ${snapshot.exportedAt}`,
    `Project: ${snapshot.projectId}`,
    `Session: ${snapshot.sessionId}`,
    '',
    'Point-in-time transcript. Statuses describe the captured state; proposals are records only.',
  ];
  for (const message of snapshot.messages) {
    lines.push(
      '',
      `## ${message.role === 'user' ? 'You' : 'Assistant'} · ${message.status}`,
      '',
      message.text,
    );
    if (message.tools?.length)
      lines.push('', '### Tool activity', '', jsonBlock(message.tools));
    if (message.proposalIds.length)
      lines.push('', 'Proposal IDs: ' + message.proposalIds.join(', '));
    if (message.usage)
      lines.push('', '### Usage', '', jsonBlock(message.usage));
  }
  if (snapshot.proposals.length)
    lines.push('', '## Proposals', '', jsonBlock(snapshot.proposals));
  if (snapshot.draft.text || snapshot.draft.attachments.length) {
    lines.push('', '## Unsent draft', '', snapshot.draft.text);
    if (snapshot.draft.attachments.length)
      lines.push(
        '',
        '### Local attachments',
        '',
        jsonBlock(snapshot.draft.attachments),
      );
  }
  return lines.join('\n') + '\n';
}

export function chatExportFile(snapshot: ChatExportSnapshot) {
  const bytes = zipSync(
    {
      'chat.md': strToU8(chatExportMarkdown(snapshot)),
      'chat.json': strToU8(JSON.stringify(snapshot, null, 2) + '\n'),
    },
    { level: 0 },
  );
  const title =
    snapshot.title
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}_-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'chat';
  return new File(
    [bytes as Uint8Array<ArrayBuffer>],
    `localcut-chat-${title}.zip`,
    {
      type: 'application/zip',
    },
  );
}

/** Editor lifetime owns recovery even after a session or provider is retired. */
export function registerChatExportTask(tasks: Pick<TaskQueue, 'register'>) {
  return tasks.register(CHAT_EXPORT_TASK, {
    cache: freshTask(
      'Each click captures a new point-in-time chat archive; the task retains its output for later downloads.',
    ),
    lane: 'chat-export',
    recovery: 'safe',
    execute: async (input, context) => {
      context.signal.throwIfAborted();
      context.progress({ stage: 'Preparing chat archive…' });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      context.signal.throwIfAborted();
      const file = chatExportFile(input as ChatExportSnapshot);
      context.signal.throwIfAborted();
      return { file };
    },
  });
}
