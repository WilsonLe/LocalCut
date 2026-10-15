import { describe, expect, it } from 'vitest';
import { receiptProgress } from '../../src/ai/receipt-progress';
import type { ChatMessage } from '../../src/ai/types';

function exchange(
  result: unknown,
  name = 'propose_action',
  status = 'completed',
): ChatMessage[] {
  return [
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'call', type: 'function', function: { name, arguments: '{}' } },
      ],
    },
    {
      role: 'tool',
      tool_call_id: 'call',
      content: JSON.stringify({ status, result }),
    },
  ];
}
const edit = {
  kind: 'edit',
  receipt: { projectId: 'film', appliedRevision: 2, requestId: 'request' },
};
describe('receipt-based progress', () => {
  it('records completed receipts once, filters scope and omits labels and raw text', () => {
    const source = [
      ...exchange(edit, 'propose_edits'),
      ...exchange(edit, 'propose_edits'),
      ...exchange({
        kind: 'indexing',
        assetId: 'reference',
        runId: 'run',
        sceneCount: 47,
        label: 'PRIVATE',
      }),
      ...exchange({
        kind: 'indexing',
        assetId: 'hidden',
        runId: 'hidden-run',
        sceneCount: 1,
      }),
      ...exchange({
        kind: 'edit',
        receipt: { ...edit.receipt, projectId: 'other' },
      }),
    ];
    const frozen = structuredClone(source);
    expect(receiptProgress(source, 'film', new Set(['reference']))).toEqual({
      source: 'completed_tool_receipts',
      historical: true,
      actions: [
        { kind: 'edit', revision: 2, requestId: 'request' },
        { kind: 'indexing', assetId: 'reference', runId: 'run' },
      ],
    });
    expect(source).toEqual(frozen);
  });
  it('does not turn notes, pending proposals, inspections or malformed records into progress', () => {
    const source: ChatMessage[] = [
      { role: 'assistant', content: 'Everything completed.' },
      ...exchange(edit, 'update_session_notes'),
      ...exchange(edit, 'inspect_project'),
      ...exchange(edit, 'propose_edits', 'pending'),
      ...exchange({ kind: 'edit' }),
      ...exchange({ kind: 'indexing', assetId: 'reference' }),
    ];
    expect(
      receiptProgress(source, 'film', new Set(['reference'])).actions,
    ).toEqual([]);
  });
  it('retains coding exit status as execution evidence rather than hiding a failed command', () => {
    expect(
      receiptProgress(
        exchange({
          kind: 'coding',
          workspace: { revision: 4, exitCode: 1, stderr: 'PRIVATE' },
        }),
        'film',
        new Set(),
      ).actions,
    ).toEqual([{ kind: 'coding', workspaceRevision: 4, exitCode: 1 }]);
  });
});
