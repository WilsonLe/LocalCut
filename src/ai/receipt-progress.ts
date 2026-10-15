import type { ChatMessage } from './types';

const mutations = new Set([
  'propose_edits',
  'propose_action',
  'write_file',
  'edit_file',
  'bash',
  'execute_code',
  'import_workspace_file',
]);
const kinds = new Set([
  'edit',
  'history',
  'indexing',
  'transcription',
  'library',
  'speech',
  'coding',
  'coding_asset',
  'storyboard_image',
  'storyboard_asset',
  'export',
  'storyboard_export',
  'preparation',
]);
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** A scope-filtered view of completed tool receipts, not another mutable ledger.
 * Historical execution does not prove the current project still has that effect,
 * nor grant approval, asset access or permission to replay a service. */
export function receiptProgress(
  messages: readonly ChatMessage[],
  projectId: string,
  allowedAssets: ReadonlySet<string>,
) {
  const calls = new Map<string, string>();
  const results = new Map<string, Record<string, string | number | boolean>>();
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const call of message.tool_calls ?? [])
        calls.set(call.id, call.function.name);
    }
    if (message.role !== 'tool') continue;
    const name = calls.get(message.tool_call_id);
    calls.delete(message.tool_call_id);
    if (!name || !mutations.has(name)) continue;
    try {
      const envelope = record(JSON.parse(message.content));
      const result = record(envelope?.result);
      if (
        envelope?.status !== 'completed' ||
        envelope.error !== undefined ||
        typeof result?.kind !== 'string' ||
        !kinds.has(result.kind)
      )
        continue;
      if (result.projectId !== undefined && result.projectId !== projectId)
        continue;
      if (
        typeof result.assetId === 'string' &&
        !allowedAssets.has(result.assetId)
      )
        continue;
      const item: Record<string, string | number | boolean> = {
        kind: result.kind,
      };
      const receipt = record(result.receipt);
      if ((result.kind === 'edit' || result.kind === 'history') && !receipt)
        continue;
      if (
        result.kind === 'indexing' &&
        (typeof result.runId !== 'string' ||
          typeof result.assetId !== 'string' ||
          !Number.isSafeInteger(result.sceneCount) ||
          (result.sceneCount as number) < 0)
      )
        continue;
      if (receipt) {
        if (
          receipt.projectId !== projectId ||
          !Number.isSafeInteger(receipt.appliedRevision) ||
          (receipt.appliedRevision as number) < 0 ||
          typeof receipt.requestId !== 'string'
        )
          continue;
        item.revision = receipt.appliedRevision as number;
        item.requestId = receipt.requestId;
      }
      for (const key of [
        'assetId',
        'runId',
        'artifactId',
        'transcriptId',
      ] as const)
        if (typeof result[key] === 'string') item[key] = result[key];
      if (Number.isSafeInteger(result.revision))
        item.revision = result.revision as number;
      const workspace = record(result.workspace);
      if (
        result.kind === 'coding' &&
        Number.isSafeInteger(workspace?.revision)
      ) {
        item.workspaceRevision = workspace!.revision as number;
        if (Number.isSafeInteger(workspace!.exitCode))
          item.exitCode = workspace!.exitCode as number;
      }
      if (result.kind === 'preparation' && result.ready === true)
        item.ready = true;
      // Do not turn a bare kind/assistant assertion into a progress claim.
      if (Object.keys(item).length < 2) continue;
      results.set(JSON.stringify(item), item);
    } catch {
      /* Malformed or non-receipt historical data grants no progress. */
    }
  }
  return {
    source: 'completed_tool_receipts',
    historical: true,
    actions: [...results.values()],
  };
}
