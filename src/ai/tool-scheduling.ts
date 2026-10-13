import type { ToolCall } from './types';
import { parseTool, toolSchedulingGroup } from './tools';

// An in-flight bound, not a tool/round/asset budget. Every call is scheduled.
const concurrency = 4;
export function toolBatches(calls: ToolCall[]) {
  const batches: ToolCall[][] = [];
  let batch: ToolCall[] = [];
  let kind = '';
  const resources = new Set<string>();
  const flush = () => {
    if (batch.length) batches.push(batch);
    batch = [];
    resources.clear();
  };
  for (const call of calls) {
    let group: ReturnType<typeof toolSchedulingGroup>;
    try {
      group = toolSchedulingGroup(
        parseTool(call.function.name, call.function.arguments),
      );
    } catch {
      // The executor reports invalid/unavailable calls through its normal path.
      group = { kind: 'serial' };
    }
    if (
      group.kind === 'serial' ||
      group.kind !== kind ||
      batch.length === concurrency ||
      (group.kind === 'index' && resources.has(group.resource))
    )
      flush();
    kind = group.kind;
    batch.push(call);
    if (group.kind === 'index') resources.add(group.resource);
    if (group.kind === 'serial') flush();
  }
  flush();
  return batches;
}
