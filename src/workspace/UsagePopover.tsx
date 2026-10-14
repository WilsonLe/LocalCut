import { ChartNoAxesColumn } from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '../components/ui/popover';
import { Tooltip } from '../components/ui/tooltip';
import { requestUsage, summarizeUsage, usageLabels } from '../ai/usage';
import type { UsageMessage, UsageCall } from '../ai/usage';

const count = (value?: number) =>
  value === undefined ? 'Unavailable' : value.toLocaleString();
const money = (value?: number) =>
  value === undefined ? 'Unavailable' : `$${value.toFixed(6)}`;
function UsageTable({ calls }: { calls: UsageCall[] }) {
  const summary = summarizeUsage(calls);
  return (
    <table className="w-full text-xs tabular-nums">
      <caption className="sr-only">
        Token counts and estimated costs in USD
      </caption>
      <thead>
        <tr className="text-muted-foreground">
          <th className="py-1 text-left font-normal">Tokens</th>
          <th className="text-right font-normal">Count</th>
          <th className="text-right font-normal">Est. USD</th>
        </tr>
      </thead>
      <tbody>
        {summary.categories
          .filter((row) => row.label !== 'Cache write' || row.tokens !== 0)
          .map((row) => (
            <tr key={row.label}>
              <th className="py-1 text-left font-normal">{row.label}</th>
              <td className="text-right">{count(row.tokens)}</td>
              <td className="text-right">{money(row.cost)}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}
export default function UsagePopover({
  messages,
}: {
  messages: UsageMessage[];
}) {
  const requests = requestUsage(messages);
  const calls = requests.flatMap((request) => request.calls);
  const total = summarizeUsage(calls);
  const latestMain = [...calls]
    .reverse()
    .find((call) => call.source === 'main');
  const prompt = latestMain?.usage?.promptTokens;
  const limit = latestMain?.contextLength;
  return (
    <Popover>
      <Tooltip content="Context and costs">
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Context and costs"
            />
          }
        >
          <ChartNoAxesColumn aria-hidden="true" />
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        side="top"
        align="start"
        className="w-96 space-y-3"
        aria-label="Context and costs"
      >
        <div className="flex items-baseline justify-between gap-2">
          <PopoverTitle className="font-medium">Context and costs</PopoverTitle>
          <span className="text-xs text-muted-foreground">USD</span>
        </div>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between gap-2">
            <span>Last main context</span>
            <span className="tabular-nums">
              {count(prompt)}
              {limit
                ? ` / ${count(limit)}${prompt !== undefined ? ` · ${((prompt / limit) * 100).toFixed(1)}%` : ''}`
                : ''}
            </span>
          </div>
          {prompt !== undefined && limit !== undefined && (
            <meter
              className="h-2 w-full"
              min={0}
              max={limit}
              value={Math.min(prompt, limit)}
              aria-label="Last main context usage"
            />
          )}
        </div>
        <div className="border-t pt-3">
          <div className="flex justify-between gap-2 text-sm">
            <span>Chat total{total.partial ? ' (partial)' : ''}</span>
            <strong className="tabular-nums">{money(total.cost)}</strong>
          </div>
          <UsageTable calls={calls} />
        </div>
        <div className="space-y-2 border-t pt-2" aria-label="Usage by request">
          {!requests.length && (
            <p className="text-xs text-muted-foreground">
              Send a request to see usage.
            </p>
          )}
          {[...requests].reverse().map((request) => {
            const summary = summarizeUsage(request.calls);
            const label = request.prompt || 'Message unavailable';
            return (
              <details
                key={request.id}
                className="text-xs"
                data-usage-request={request.id}
              >
                <Tooltip
                  content={
                    <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                      {label}
                    </span>
                  }
                >
                  <summary className="cursor-pointer rounded-sm py-1 focus-visible:outline-2">
                    <span className="inline-flex w-[calc(100%-1rem)] items-baseline gap-2 align-bottom">
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {label}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {money(summary.cost)}
                        {summary.partial ? ' (partial)' : ''}
                      </span>
                    </span>
                  </summary>
                </Tooltip>
                <UsageTable calls={request.calls} />
                <div
                  className="mt-2 space-y-1 border-l pl-2"
                  aria-label="Agent usage"
                >
                  {Object.entries(usageLabels).map(([source, label]) => {
                    const agentCalls = summary.calls.filter(
                      (call) => call.source === source,
                    );
                    if (!agentCalls.length) return null;
                    const agent = summarizeUsage(agentCalls);
                    return (
                      <details key={source}>
                        <summary className="cursor-pointer py-1">
                          {label} · {agentCalls.length}{' '}
                          {agentCalls.length === 1 ? 'call' : 'calls'}
                          <span className="float-right pl-1 tabular-nums">
                            {money(agent.cost)}
                            {agent.partial ? ' (partial)' : ''}
                          </span>
                        </summary>
                        <UsageTable calls={agentCalls} />
                        <p className="break-words py-1 text-muted-foreground">
                          {[
                            ...new Set(agentCalls.map((call) => call.model)),
                          ].join(', ') || 'Historical model unavailable'}
                        </p>
                      </details>
                    );
                  })}
                  {!summary.calls.length && (
                    <p className="text-muted-foreground">
                      Usage has not been reported.
                    </p>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
