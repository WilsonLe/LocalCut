import { z } from 'zod';
import type { OpenRouterModel, Usage } from './types';

export const usageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  cost: z.number().finite().nonnegative().optional(),
  cachedTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  reasoningTokens: z.number().int().nonnegative().optional(),
});
export const usageCallSchema = z.object({
  id: z.string().min(1),
  source: z.enum([
    'main',
    'request_contract',
    'session_todos',
    'completion_check',
    'title',
    'indexing',
    'legacy',
  ]),
  model: z.string(),
  usage: usageSchema.optional(),
  contextLength: z.number().int().positive().optional(),
  pricing: z
    .object({
      prompt: z.string().optional(),
      completion: z.string().optional(),
      input_cache_read: z.string().optional(),
      input_cache_write: z.string().optional(),
    })
    .optional(),
});
export type UsageSource = z.infer<typeof usageCallSchema>['source'];
export type UsageCall = z.infer<typeof usageCallSchema>;
export const usageLabels: Record<UsageSource, string> = {
  main: 'Main agent',
  request_contract: 'Goal agent',
  session_todos: 'To-do agent',
  completion_check: 'Review agent',
  title: 'Chat title',
  indexing: 'Asset indexing',
  legacy: 'Historical aggregate',
};

/** Snapshot rates only for the model that actually supplied this response. */
export function priceUsageCall(
  call: UsageCall,
  model?: OpenRouterModel,
): UsageCall {
  return structuredClone(
    call.model === model?.id
      ? { ...call, pricing: model.pricing, contextLength: model.contextLength }
      : call,
  );
}

export function usageCategories(call: UsageCall) {
  const u = call.usage;
  const cached = u?.cachedTokens;
  const written = u?.cacheWriteTokens ?? 0;
  const input =
    u && cached !== undefined && cached + written <= u.promptTokens
      ? u.promptTokens - cached - written
      : undefined;
  const estimate = (tokens: number | undefined, rate: string | undefined) => {
    if (tokens === undefined) return undefined;
    if (tokens === 0) return 0;
    if (rate === undefined || !rate.trim()) return undefined;
    const price = Number(rate);
    const result = tokens * price;
    return Number.isFinite(result) && price >= 0 ? result : undefined;
  };
  return [
    {
      label: 'Input',
      tokens: input,
      cost: estimate(input, call.pricing?.prompt),
    },
    {
      label: 'Input cache',
      tokens: cached,
      cost: estimate(cached, call.pricing?.input_cache_read),
    },
    {
      label: 'Cache write',
      tokens: u ? written : undefined,
      cost: estimate(u ? written : undefined, call.pricing?.input_cache_write),
    },
    {
      label: 'Output',
      tokens: u?.completionTokens,
      cost: estimate(u?.completionTokens, call.pricing?.completion),
    },
  ];
}

export function summarizeUsage(calls: readonly UsageCall[]) {
  const unique = [...new Map(calls.map((call) => [call.id, call])).values()];
  const reported = unique.filter((call) => call.usage?.cost !== undefined);
  return {
    calls: unique,
    cost: reported.length
      ? reported.reduce((sum, call) => sum + call.usage!.cost!, 0)
      : undefined,
    partial: reported.length !== unique.length,
    tokens: unique.reduce(
      (sum, call) => sum + (call.usage?.totalTokens ?? 0),
      0,
    ),
    categories: ['Input', 'Input cache', 'Cache write', 'Output'].map(
      (label, index) => {
        const rows = unique.map((call) => usageCategories(call)[index]!);
        return {
          label,
          tokens:
            rows.length && rows.every((row) => row.tokens !== undefined)
              ? rows.reduce((sum, row) => sum + row.tokens!, 0)
              : undefined,
          cost:
            rows.length && rows.every((row) => row.cost !== undefined)
              ? rows.reduce((sum, row) => sum + row.cost!, 0)
              : undefined,
        };
      },
    ),
  };
}

export interface UsageMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  requestId?: string;
  usage?: Usage;
  usageCalls?: UsageCall[];
}
/** Recovery attempts share a request; background results remain on their initiating message. */
export function requestUsage(messages: readonly UsageMessage[]) {
  const groups = new Map<
    string,
    { id: string; prompt: string; calls: UsageCall[] }
  >();
  let prompt = '';
  for (const message of messages) {
    if (message.role === 'user') {
      prompt = message.text;
      continue;
    }
    const id = message.requestId ?? message.id;
    const group = groups.get(id) ?? { id, prompt, calls: [] };
    group.calls.push(
      ...(message.usageCalls ??
        (message.usage
          ? [
              {
                id: message.id,
                source: 'legacy' as const,
                model: '',
                usage: message.usage,
              },
            ]
          : [])),
    );
    groups.set(id, group);
  }
  return [...groups.values()];
}
